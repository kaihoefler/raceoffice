/**
 * raceResultsActions
 * -----------------
 * Centralized domain logic for keeping `raceResults` consistent.
 *
 * `raceResults` is treated as a materialized view of:
 * - manual fields (e.g. finishRank/finishTime/lapsCompleted) edited in dedicated UIs
 * - derived fields (e.g. points/eliminations/dsq/dns) computed from the event log (`raceActivities`)
 *
 * Whenever activities or manual results change, callers should:
 * 1) applyActivitiesToRaceResults(...)   -> derive activity-based fields
 * 2) recomputeRaceResults(...)          -> compute consolidated rank
 */

import type { Athlete } from "../types/athlete";
import type {
  RaceActivity,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityElimination,
  RaceActivityPointsSprint,
} from "../types/raceactivities";
import type { RaceResult } from "../types/race";

// Small parsing helper: allow bib as number or string; normalize to positive integer.
export function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

// Default RaceResult entry for a bib that exists in starters/activities but not yet in raceResults.
export function makeDefaultRaceResult(bib: number): RaceResult {
  return {
    bib,
    rank: 0,
    points: 0,
    eliminated: false,
    eliminationLap: 0,
    dns: false,
    dsq: false,
    lapsCompleted: 0,
    finishTime: "",
    finishRank: 0,
  };
}

function isPointsSprintActivity(a: RaceActivity | any): a is RaceActivityPointsSprint {
  return a?.type === "pointsSprint";
}

function isEliminationActivity(a: RaceActivity | any): a is RaceActivityElimination {
  return a?.type === "elimination";
}

function isDsqActivity(a: RaceActivity | any): a is RaceActivityDisqualfication {
  return a?.type === "DSQ";
}

function isDnsActivity(a: RaceActivity | any): a is RaceActivityDns {
  return a?.type === "DNS";
}

/**
 * Derive the activity-based fields of RaceResults.
 *
 * Current derived fields:
 * - points: sum of all non-deleted pointsSprint activity results
 * - eliminated/eliminationLap: from non-deleted elimination activities (per bib we keep the max lap)
 * - dsq/dns: from non-deleted DSQ/DNS activities
 *
 * Preserved fields (examples):
 * - finishRank, finishTime, lapsCompleted
 */
export function applyActivitiesToRaceResults(args: {
  prevResults: RaceResult[];
  starters: Athlete[];
  activities: RaceActivity[];
}): RaceResult[] {
  const prevResults = Array.isArray(args.prevResults) ? args.prevResults : [];
  const starters = Array.isArray(args.starters) ? args.starters : [];
  const activities = Array.isArray(args.activities) ? args.activities : [];

  // Collect all bibs we need RaceResult rows for.
  const bibs = new Set<number>();

  for (const r of prevResults) {
    const bib = bibToInt((r as any)?.bib);
    if (bib != null) bibs.add(bib);
  }

  for (const s of starters) {
    const bib = bibToInt((s as any)?.bib);
    if (bib != null) bibs.add(bib);
  }

  for (const a of activities) {
    if (isPointsSprintActivity(a) || isEliminationActivity(a)) {
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        if (bib != null) bibs.add(bib);
      }
      continue;
    }

    if (isDsqActivity(a) || isDnsActivity(a)) {
      const bib = bibToInt(a.data?.bib);
      if (bib != null) bibs.add(bib);
      continue;
    }

    // Fallback for potential future activity shapes.
    const maybeBib = bibToInt((a as any)?.data?.bib);
    if (maybeBib != null) bibs.add(maybeBib);

    const maybeBibs = Array.isArray((a as any)?.data?.bibs) ? ((a as any).data.bibs as any[]) : [];
    for (const b of maybeBibs) {
      const bib = bibToInt(b);
      if (bib != null) bibs.add(bib);
    }
  }

  // Base map: preserve existing RaceResult rows (manual fields live here).
  const byBib = new Map<number, RaceResult>();
  for (const r of prevResults) {
    const bib = bibToInt((r as any)?.bib);
    if (bib == null) continue;
    if (byBib.has(bib)) continue;
    byBib.set(bib, { ...r, bib });
  }

  for (const bib of bibs) {
    if (!byBib.has(bib)) byBib.set(bib, makeDefaultRaceResult(bib));
  }

  // Derive fields from activities.
  const pointsByBib = new Map<number, number>();
  const elimLapByBib = new Map<number, number>();
  const dsqBibs = new Set<number>();
  const dnsBibs = new Set<number>();

  for (const a of activities) {
    if (isPointsSprintActivity(a)) {
      if (a.data?.isDeleted) continue;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        const pts = Number((r as any)?.points);
        if (bib == null || !Number.isFinite(pts)) continue;
        pointsByBib.set(bib, (pointsByBib.get(bib) ?? 0) + pts);
      }
      continue;
    }

    if (isEliminationActivity(a)) {
      if (a.data?.isDeleted) continue;
      const lap = bibToInt((a as any)?.data?.lap) ?? 0;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        if (bib == null) continue;
        const prev = elimLapByBib.get(bib) ?? 0;
        elimLapByBib.set(bib, Math.max(prev, lap));
      }
      continue;
    }

    if (isDsqActivity(a)) {
      if (a.data?.isDeleted) continue;
      const bib = bibToInt(a.data?.bib);
      if (bib != null) dsqBibs.add(bib);
      continue;
    }

    if (isDnsActivity(a)) {
      if (a.data?.isDeleted) continue;
      const bib = bibToInt(a.data?.bib);
      if (bib != null) dnsBibs.add(bib);
      continue;
    }

    // Fallback for potential future activity shapes.
    const t = String((a as any)?.type ?? "");
    const isDeleted = !!(a as any)?.data?.isDeleted;
    if (isDeleted) continue;

    const bib = bibToInt((a as any)?.data?.bib);
    if (bib == null) continue;

    if (t === "DSQ") dsqBibs.add(bib);
    else if (t === "DNS") dnsBibs.add(bib);
  }

  // Build next array in stable order: keep previous ordering first, then append new bibs.
  const used = new Set<number>();

  const applyDerived = (base: RaceResult): RaceResult => {
    const bib = bibToInt(base.bib) ?? base.bib;

    const points = pointsByBib.get(bib) ?? 0;
    const elimLap = elimLapByBib.get(bib) ?? 0;

    return {
      ...base,
      bib,
      points,
      eliminated: elimLap > 0,
      eliminationLap: elimLap,
      dsq: dsqBibs.has(bib),
      dns: dnsBibs.has(bib),
    };
  };

  const next: RaceResult[] = [];
  for (const r of prevResults) {
    const bib = bibToInt((r as any)?.bib);
    if (bib == null) continue;
    const base = byBib.get(bib);
    if (!base) continue;
    next.push(applyDerived(base));
    used.add(bib);
  }

  const missing = Array.from(byBib.keys())
    .filter((b) => !used.has(b))
    .sort((a, b) => a - b);

  for (const bib of missing) {
    const base = byBib.get(bib);
    if (!base) continue;
    next.push(applyDerived(base));
  }

  return next;
}

// -----------------------------------------------------------------------------
// Rank computation
// -----------------------------------------------------------------------------

type SortKey = {
  bucket: number;
  eliminationLap: number;
  points: number;
  finishRankKey: number; // finishRank=0 => Infinity (treated as "no finish" -> last)
};

function toFiniteInt(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.floor(v);
}

function toFiniteNumber(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Status priority (ascending = better):
 * 0: not eliminated, not DSQ, not DNS
 * 1: eliminated
 * 2: DSQ
 * 3: DNS
 */
function statusBucket(r: RaceResult): number {
  if (r.dsq) return 2;
  if (r.dns) return 3;
  return r.eliminated ? 1 : 0;
}

function sortKey(r: RaceResult): SortKey {
  const finishRank = toFiniteInt(r.finishRank, 0);

  return {
    bucket: statusBucket(r),
    eliminationLap: toFiniteInt(r.eliminationLap, 0),
    points: toFiniteNumber(r.points, 0),
    finishRankKey: finishRank > 0 ? finishRank : Number.POSITIVE_INFINITY,
  };
}

function compareRaceResultsForStandings(ra: RaceResult, rb: RaceResult): number {
  const a = sortKey(ra);
  const b = sortKey(rb);

  // 1) status bucket (asc)
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;

  // 2) eliminationLap (desc)
  if (a.eliminationLap !== b.eliminationLap) return b.eliminationLap - a.eliminationLap;

  // 3) points (desc)
  if (a.points !== b.points) return b.points - a.points;

  // 4) finishRank (asc), finishRank=0 => Infinity => end
  if (a.finishRankKey !== b.finishRankKey) return a.finishRankKey - b.finishRankKey;

  // Stable tie-breaker (does NOT affect rank ties)
  return toFiniteInt(ra.bib, 0) - toFiniteInt(rb.bib, 0);
}

function keysEqual(a: SortKey, b: SortKey): boolean {
  return (
    a.bucket === b.bucket &&
    a.eliminationLap === b.eliminationLap &&
    a.points === b.points &&
    a.finishRankKey === b.finishRankKey
  );
}

/**
 * Computes the consolidated `rank` field for each `RaceResult`.
 *
 * IMPORTANT: This helper only sets `rank`. It does not modify points/finishRank/etc.
 */
export function sortRaceResultsForStandings(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];
  return list.sort(compareRaceResultsForStandings);
}

export function recomputeRaceResults(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];

  // Deterministic sort by the configured priority criteria.
  const sorted = [...list].sort(compareRaceResultsForStandings);

  // Assign ranks with ties: 1, 1, 3 ...
  const rankByBib = new Map<number, number>();
  let prevKey: SortKey | null = null;
  let prevRank = 0;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const bib = toFiniteInt(r.bib, 0);
    if (bib <= 0) continue;

    const key = sortKey(r);
    const isTie = prevKey !== null && keysEqual(prevKey, key);

    const rank = isTie ? prevRank : i + 1;

    rankByBib.set(bib, rank);
    prevKey = key;
    prevRank = rank;
  }

  // Return in original order to minimize document churn.
  return list.map((r) => {
    const bib = toFiniteInt(r.bib, 0);
    const nextRank = rankByBib.get(bib);
    return nextRank != null ? { ...r, rank: nextRank } : r;
  });
}

/**
 * Convenience helper for the common "activities changed" flow:
 * derive fields from activities AND recompute rank.
 */
export function materializeRaceResults(args: {
  prevResults: RaceResult[];
  starters: Athlete[];
  activities: RaceActivity[];
}): RaceResult[] {
  return recomputeRaceResults(applyActivitiesToRaceResults(args));
}
