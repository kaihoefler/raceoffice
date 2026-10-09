// src/domain/liveScoring.ts
//
// Scoring rules derived from the live race status feed of the timing system.
//
// The timing system knows lap counts and positions on the track; RaceOffice knows the
// officials' decisions (starters, eliminations, DNF/DNS/DSQ, points sprints). This module
// combines both into the hints the scoring UI offers: which lap the race is in, who is
// currently last (elimination candidates), who has been lapped, who never started, and
// the finish order.
//
// How the live feed is split across layers (keep it that way, it is what makes it testable):
//
//   packages/domain/src/raceStatusFeed.ts   Contract of the external feed (types, pickCurrentRace).
//   providers/RaceStatusProvider.tsx        Transport only: polling, errors, backoff, pause.
//                                           Exposes the raw `currentRace`, no scoring rules.
//   domain/liveScoring.ts (this file)       All scoring rules on top of the feed. Pure functions,
//                                           no React, no I/O, no clock -> unit-tested in
//                                           liveScoring.test.ts with feed states from a builder.
//   pages/scoring/ScoringViewModel.tsx      React adapter: calls deriveLiveScoring once per render
//                                           input and keeps Set identities stable for effects.
//   components/*Scoring.tsx                 Apply the hints (prefill, lap sync) and record
//                                           the officials' decisions.
//
// Rule of thumb: a rule that answers "what does the feed mean for scoring?" belongs here;
// a rule that answers "when does the UI react?" belongs in the components.

import { bibToInt } from "@raceoffice/domain";
import type {
  Athlete,
  Race,
  RaceActivity,
  RaceActivityPointsSprint,
  RaceResult,
  RaceStatusCompetitor,
  RaceStatusRace,
} from "@raceoffice/domain";

export type ScoringStandingRow = {
  bib: number;
  points: number;
  /** Rank based on points; ties share the same place (1, 1, 3 …). */
  place: number;
};

export type LiveScoring = {
  /** bibs from race.raceStarters */
  starterBibs: Set<number>;
  /** bibs from live status */
  liveBibs: Set<number>;
  /** bibs seen in live status but not in starters list */
  unknownLiveBibs: Set<number>;
  /** bibs in starters list but not seen in live status (empty while the feed has no competitors) */
  missingInLiveBibs: Set<number>;
  /** Bibs that are not eligible for new scoring entries (DNS, DSQ, DNF, ELIM). */
  blockedBibs: Set<number>;
  /** Current points standings derived from race activities. */
  standings: ScoringStandingRow[];
  /** Current lap from live status (if available). */
  liveLapCount: number | null;
  /** Laps to go from live status (if available). */
  liveLapsToGo: number | null;
  /** Top bibs by live position (ascending). */
  liveTopBibs: { p1Bib: number | null; p2Bib: number | null; p3Bib: number | null };
  /** Worst two live positions that are not blocked (elimination prefill). */
  liveLastEligibleBibs: { lastBib: number | null; secondLastBib: number | null };
  /** Non-blocked bibs that still have 0 lapsComplete (DNS helper), ascending. */
  liveZeroLapBibs: number[];
  /**
   * Positive lap deficit to the live leader per non-blocked bib (leader = most laps, not
   * position 1). Riders on the lead lap are not listed. Input for suggestDnfGroup and for
   * the "+N Laps" marker in the starter list.
   */
  lappedIndicationByBib: Map<number, number>;
  /**
   * Non-blocked bibs at least 2 laps behind the live leader. Only these are marked in the
   * starter list (background + "+N Laps" + tooltip "Lapped Athlete. DNF or Elim?").
   */
  lappedIndicationBibs: Set<number>;
};

function isPointsSprintActivity(a: unknown): a is RaceActivityPointsSprint {
  return (a as any)?.type === "pointsSprint";
}

/**
 * A rider is "blocked" once an official has taken them out of the race (DNF, eliminated,
 * DNS, DSQ). The timing system does not know these decisions and keeps listing such riders,
 * so every live hint must ignore them, otherwise an already eliminated rider would be
 * suggested again.
 */
function isBlockedRaceResult(r: any): boolean {
  const dnf = r?.dnf;
  return dnf === "dnf" || dnf === "elimination" || Boolean(r?.dns) || Boolean(r?.dsq);
}

/**
 * The timing system appends the nation to the last name ("Rojas Gil (COL)"); RaceOffice
 * stores it separately on the athlete. Only a trailing three-letter uppercase code counts.
 */
export function extractNationFromLastName(lastNameRaw: string): { lastName: string; nation: string | null } {
  const s = String(lastNameRaw ?? "").trim();
  const m = s.match(/\(([A-Z]{3})\)\s*$/);
  if (!m) return { lastName: s, nation: null };

  const nation = m[1];
  const lastName = s.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  return { lastName, nation };
}

/**
 * Derives all live-feed based scoring hints for a race.
 *
 * `race` is the RaceOffice race (starters, results, activities); `currentRace` is the active
 * race from the feed, or null when the timing system reports no active race. The function
 * does not check that both describe the same race; the scoring page shows the feed next to
 * the selected race and the official is responsible for matching them.
 */
export function deriveLiveScoring(race: Race | null, currentRace: RaceStatusRace | null): LiveScoring {
  const competitors: RaceStatusCompetitor[] = Array.isArray(currentRace?.competitors) ? currentRace.competitors : [];

  // ---- Starters ----
  const starterBibs = new Set<number>();
  for (const s of race?.raceStarters ?? []) {
    const bib = bibToInt((s as any)?.bib);
    if (bib != null) starterBibs.add(bib);
  }

  // ---- Live bibs ----
  const liveBibs = new Set<number>();
  for (const c of competitors) {
    const bib = bibToInt((c as any)?.number);
    if (bib != null) liveBibs.add(bib);
  }

  const unknownLiveBibs = new Set<number>();
  for (const bib of liveBibs) {
    if (!starterBibs.has(bib)) unknownLiveBibs.add(bib);
  }

  // Starters the timing system does not list (e.g. not on track, wrong transponder).
  // Only meaningful once the feed lists anybody; an empty feed would flag every starter.
  const missingInLiveBibs = new Set<number>();
  if (liveBibs.size > 0) {
    for (const bib of starterBibs) {
      if (!liveBibs.has(bib)) missingInLiveBibs.add(bib);
    }
  }

  // ---- Top bibs by position ----
  // Points sprint prefill: the first three live positions are the sprint's point candidates.
  // Riders without a position sort last.
  const sortedByPos = [...competitors].sort((a: any, b: any) => (a?.position ?? 9999) - (b?.position ?? 9999));

  const liveTopBibs = {
    p1Bib: bibToInt(sortedByPos[0]?.number),
    p2Bib: bibToInt(sortedByPos[1]?.number),
    p3Bib: bibToInt(sortedByPos[2]?.number),
  };

  // ---- Blocked bibs ----
  // Shared across all scoring tabs: starters with DNS/DSQ/DNF/ELIM are not selectable.
  const blockedBibs = new Set<number>();
  const raceResults = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as any[]) : [];
  for (const r of raceResults) {
    const bib = bibToInt(r?.bib);
    if (bib == null) continue;
    if (isBlockedRaceResult(r)) blockedBibs.add(bib);
  }

  // ---- Last eligible bibs by position (EliminationScoring prefill) ----
  // In an elimination race riders at the back of the field are eliminated. Riders already
  // taken out are skipped, so the hint moves to the next rider still racing. The last and
  // second-last eligible riders are exposed.
  const lastEligible: number[] = [];
  for (let i = sortedByPos.length - 1; i >= 0; i--) {
    const bib = bibToInt((sortedByPos[i] as any)?.number);
    if (bib == null) continue;
    if (blockedBibs.has(bib)) continue;

    lastEligible.push(bib);
    if (lastEligible.length >= 2) break;
  }

  const liveLastEligibleBibs = {
    lastBib: lastEligible[0] ?? null,
    secondLastBib: lastEligible[1] ?? null,
  };

  // ---- Zero-lap bibs (DNS helper) ----
  // Riders that have not completed a single lap are DNS candidates once the race is running.
  // Before the start every rider is at lap 0, so suggestDnsBibs only proposes them from
  // DNS_SUGGESTION_MIN_LIVE_LAP on.
  const zeroLapSet = new Set<number>();
  for (const c of competitors) {
    const bib = bibToInt((c as any)?.number);
    if (bib == null) continue;
    if (blockedBibs.has(bib)) continue;

    const laps = Number((c as any)?.lapsComplete);
    if (!Number.isFinite(laps)) continue;
    if (Math.floor(laps) !== 0) continue;

    zeroLapSet.add(bib);
  }
  const liveZeroLapBibs = Array.from(zeroLapSet).sort((a, b) => a - b);

  // ---- Lapped riders ----
  // The lap gap is measured against the rider with the MOST completed laps (not against
  // live position 1), so it reflects laps actually completed. Blocked riders are excluded,
  // both as leader and as lapped rider.
  // - lappedIndicationByBib: every rider at least one lap down, with the gap
  // - lappedIndicationBibs:  riders two or more laps down (marked in the starter list)
  // The DNF proposal built on top of this is suggestDnfGroup (below).
  const lapsByBib = new Map<number, number>();
  for (const c of competitors) {
    const bib = bibToInt((c as any)?.number);
    if (bib == null) continue;
    if (blockedBibs.has(bib)) continue;

    const lapsRaw = Number((c as any)?.lapsComplete);
    if (!Number.isFinite(lapsRaw)) continue;
    lapsByBib.set(bib, Math.max(0, Math.floor(lapsRaw)));
  }

  const lappedIndicationByBib = new Map<number, number>();
  const lappedIndicationBibs = new Set<number>();

  if (lapsByBib.size > 0) {
    let leaderLap = 0;
    for (const laps of lapsByBib.values()) {
      if (laps > leaderLap) leaderLap = laps;
    }

    for (const [bib, laps] of lapsByBib.entries()) {
      const gap = leaderLap - laps;
      if (gap < 1) continue;

      lappedIndicationByBib.set(bib, gap);
      if (gap >= 2) lappedIndicationBibs.add(bib);
    }
  }

  // ---- Standings (Points) ----
  // Points come from recorded sprint activities (not from the feed); deleted sprints are
  // ignored. Equal points share a place ("1, 1, 3"); within a tie the lower bib is listed first.
  const activities = ((race as any)?.raceActivities ?? []) as RaceActivity[];
  const pointsByBib = new Map<number, number>();

  for (const a of activities) {
    if (!isPointsSprintActivity(a)) continue;
    if ((a as any)?.data?.isDeleted) continue;

    const results = Array.isArray((a as any)?.data?.results) ? ((a as any).data.results as any[]) : [];
    for (const r of results) {
      const bib = bibToInt(r?.bib);
      const pts = Number(r?.points);
      if (bib == null || !Number.isFinite(pts)) continue;
      pointsByBib.set(bib, (pointsByBib.get(bib) ?? 0) + pts);
    }
  }

  const allBibs = new Set<number>(starterBibs);
  for (const bib of pointsByBib.keys()) allBibs.add(bib);

  const sorted = Array.from(allBibs)
    .map((bib) => ({ bib, points: pointsByBib.get(bib) ?? 0 }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.bib - b.bib;
    });

  const standings: ScoringStandingRow[] = [];
  let idx = 0;
  let prevPoints: number | null = null;
  let prevPlace = 0;

  for (const r of sorted) {
    idx += 1;
    const isTie = prevPoints !== null && r.points === prevPoints;
    const place = isTie ? prevPlace : idx;
    if (!isTie) {
      prevPoints = r.points;
      prevPlace = place;
    }
    standings.push({ ...r, place });
  }

  return {
    starterBibs,
    liveBibs,
    unknownLiveBibs,
    missingInLiveBibs,
    blockedBibs,
    standings,
    liveLapCount: currentRace?.lapsComplete ?? null,
    liveLapsToGo: currentRace?.lapsToGo ?? null,
    liveTopBibs,
    liveLastEligibleBibs,
    liveZeroLapBibs,
    lappedIndicationByBib,
    lappedIndicationBibs,
  };
}

export type DnfSuggestion = {
  /** Riders proposed for DNF, ascending; empty when nobody is lapped. */
  bibs: number[];
  /** The lap deficit all proposed riders share; null when there is no proposal. */
  deficit: number | null;
};

/**
 * DNF proposal from the live feed (elimination race, DNF mode with sync on): all riders with
 * the GREATEST lap deficit, i.e. the riders furthest behind. All of them share one deficit,
 * so one DNF lap applies to the whole group (see dnfLapForDeficit).
 *
 * `lapDeficitByBib` is LiveScoring.lappedIndicationByBib. `excludedBibs` are riders that must
 * not be proposed (already taken out, or just recorded and not yet confirmed by the server);
 * the next group is proposed instead.
 */
export function suggestDnfGroup(
  lapDeficitByBib: ReadonlyMap<number, number>,
  excludedBibs: ReadonlySet<number> = new Set(),
): DnfSuggestion {
  const entries = Array.from(lapDeficitByBib.entries()).filter(
    ([bib, deficit]) => bib > 0 && Number.isFinite(deficit) && deficit > 0 && !excludedBibs.has(bib),
  );
  if (!entries.length) return { bibs: [], deficit: null };

  const maxDeficit = entries.reduce((max, [, deficit]) => (deficit > max ? deficit : max), 0);
  const bibs = entries
    .filter(([, deficit]) => deficit === maxDeficit)
    .map(([bib]) => bib)
    .sort((a, b) => a - b);

  return { bibs, deficit: maxDeficit };
}

/**
 * First live race lap from which riders without a completed lap are proposed as DNS.
 * At lap 1 riders who are only a few seconds behind the leader have not crossed the line
 * yet and would briefly appear as DNS; from lap 2 on, 0 laps reliably means "not started".
 */
export const DNS_SUGGESTION_MIN_LIVE_LAP = 2;

/**
 * DNS proposal from the live feed (elimination race, DNS mode with sync on): riders that
 * have not completed a single lap, once the race is at DNS_SUGGESTION_MIN_LIVE_LAP or later.
 *
 * `liveZeroLapBibs` is LiveScoring.liveZeroLapBibs. `excludedBibs` are riders that must not
 * be proposed (already taken out, or just recorded and not yet confirmed by the server).
 */
export function suggestDnsBibs(
  liveZeroLapBibs: readonly number[],
  liveLapCount: number | null,
  excludedBibs: ReadonlySet<number> = new Set(),
): number[] {
  if (liveLapCount == null || Math.floor(Number(liveLapCount)) < DNS_SUGGESTION_MIN_LIVE_LAP) return [];

  return Array.from(new Set(liveZeroLapBibs.map((b) => Math.floor(Number(b)))))
    .filter((bib) => bib > 0 && !excludedBibs.has(bib))
    .sort((a, b) => a - b);
}

/**
 * DNF lap for riders `deficit` laps behind: their own completed laps, i.e. the live race lap
 * minus the deficit (at least lap 1).
 */
export function dnfLapForDeficit(liveLapCount: number, deficit: number): number {
  const liveLap = Math.max(1, Math.floor(Number(liveLapCount)));
  return Math.max(1, liveLap - deficit);
}

function defaultNewId(): string {
  return (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Builds starters for the given bibs that are not yet race starters (deduplicated, ascending).
 *
 * Used when the timing system reports riders the race does not know yet: instead of typing
 * them in, the official creates them from the feed. Names and nation come from the feed when
 * the bib is present there, otherwise they stay empty. `newId` is injectable for tests.
 */
export function buildStartersForBibs(
  race: Race | null,
  currentRace: RaceStatusRace | null,
  bibs: number[],
  newId: () => string = defaultNewId,
): Athlete[] {
  const ageGroupId = (race as any)?.ageGroupId ?? null;

  const starterBibs = new Set<number>();
  for (const s of race?.raceStarters ?? []) {
    const bib = bibToInt((s as any)?.bib);
    if (bib != null) starterBibs.add(bib);
  }

  const competitorByBib = new Map<number, RaceStatusCompetitor>();
  for (const c of Array.isArray(currentRace?.competitors) ? currentRace.competitors : []) {
    const bib = bibToInt((c as any)?.number);
    if (bib != null && !competitorByBib.has(bib)) competitorByBib.set(bib, c);
  }

  const uniqueMissing = Array.from(
    new Set((Array.isArray(bibs) ? bibs : []).map((b) => bibToInt(b)).filter((b): b is number => b != null)),
  )
    .filter((bib) => !starterBibs.has(bib))
    .sort((a, b) => a - b);

  return uniqueMissing.map((bib) => {
    const c = competitorByBib.get(bib);
    const firstName = String(c?.firstName ?? "").trim();
    const { lastName, nation } = extractNationFromLastName(String(c?.lastName ?? ""));

    return {
      id: newId(),
      firstName,
      lastName,
      bib,
      ageGroupId: typeof ageGroupId === "string" ? ageGroupId : null,
      nation,
    };
  });
}

/**
 * Builds a full RaceResults replacement from the live feed ("fill from live" at the finish).
 *
 * At the finish the official can take the timing system's order as the starting point and
 * then correct it in FinishLineScoring. The returned list REPLACES all existing results.
 *
 * Rules:
 * - processed in live position order; invalid and duplicate bibs are skipped
 * - finishRank = live position, but 0 when the rider has no completed lap or no valid position
 * - finishTime is copied only when the rider's laps equal the race's `lapsComplete`
 */
export function buildFinishResultsFromLive(currentRace: RaceStatusRace | null): RaceResult[] {
  const raceLap = currentRace?.lapsComplete ?? null;
  const competitors = Array.isArray(currentRace?.competitors) ? currentRace.competitors : [];

  const sorted = [...competitors].sort(
    (a, b) => (Number(a.position ?? 9999) || 9999) - (Number(b.position ?? 9999) || 9999),
  );

  const seen = new Set<number>();
  const results: RaceResult[] = [];

  for (const c of sorted) {
    const bib = bibToInt(String(c.number ?? ""));
    if (bib == null) continue;
    if (seen.has(bib)) continue;
    seen.add(bib);

    const lapsCompleted = Number.isFinite(Number(c.lapsComplete)) ? Number(c.lapsComplete) : 0;

    const hasCompletedLaps = lapsCompleted > 0;
    const hasLivePosition = Number(c.position ?? 0) > 0;
    const finishRank = hasCompletedLaps && hasLivePosition ? Number(c.position) : 0;

    const shouldCopyTime = raceLap != null && Number.isFinite(Number(raceLap)) && lapsCompleted === Number(raceLap);
    const finishTime = shouldCopyTime ? String(c.totalTime ?? "") : "";

    results.push({
      bib,
      rank: 0,
      points: 0,
      dnf: false,
      dnfLap: 0,
      dns: false,
      dsq: false,
      lapsCompleted,
      finishTime,
      finishRank,
    });
  }

  return results;
}
