// src/pages/scoring/ScoringViewModel.tsx
import { useMemo } from "react";

import { useRaceStatusBibs } from "../../providers/RaceStatusBibProvider";
import { useRaceStatusMeta } from "../../providers/RaceStatusMetaProvider";
import { useRaceStatusCompetitors } from "../../providers/RaceStatusCompetitorsProvider";

import type { Athlete } from "../../types/athlete";
import type { RaceActivity, RaceActivityPointsSprint } from "../../types/raceactivities";
import type { Race } from "../../types/race";

export type ScoringStandingRow = {
  bib: number;
  points: number;
  /** Rank based on points; ties share the same place (1, 1, 3 …). */
  place: number;
};

export type ScoringViewModel = {
  /** bibs from race.raceStarters */
  starterBibs: Set<number>;
  /** bibs from live status */
  liveBibs: ReadonlySet<number>;

  /** bibs seen in live status but not in starters list */
  unknownLiveBibs: Set<number>;

  /** bibs in starters list but not seen in live status */
  missingInLiveBibs: Set<number>;

  /** Current points standings derived from race activities. */
  standings: ScoringStandingRow[];

  /** Live/PointsScoring synchronization toggle state (controlled by the UI). */
  syncEnabled: boolean;

  /** Current lap from live status (if available). */
  liveLapCount: number | null;

  /** Laps to go from live status (if available). */
  liveLapsToGo: number | null;

  /** Top bibs by live position (ascending). Used for PointsScoring prefill when sync is enabled. */
  liveTopBibs: {
    p1Bib: number | null;
    p2Bib: number | null;
    p3Bib: number | null;
  };

      /**
   * Last eligible bibs in live ranking (worst positions).
   * - lastBib: last/worst
   * - secondLastBib: second last
   * Both are filtered to NOT be DNF/DNS/DSQ in current raceResults.
   */
  liveLastEligibleBibs: { lastBib: number | null; secondLastBib: number | null };


  /** Bibs that still have 0 lapsComplete in the live feed (and are not DNF/DNS/DSQ in current raceResults). */
  liveZeroLapBibs: number[];




  /**
   * Build Athlete objects for competitors that appear in liveRace but are missing in race.raceStarters.
   * Can be used by the page to append them to the race starters list.
   */
  getMissingStarterBibsFromLive: () => Athlete[];

  /* create a new starter with the given Bib. 
  * If the bib is in competitors, it will be used to create the starter. If not, it will be created with the bib and empty name.
 */

  buildStartersForBibs: (bibs: number[]) => Athlete[];


};

function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function newId() {
  return (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function extractNationFromLastName(lastNameRaw: string): { lastName: string; nation: string | null } {
  const s = String(lastNameRaw ?? "").trim();
  const m = s.match(/\(([A-Z]{3})\)\s*$/);
  if (!m) return { lastName: s, nation: null };

  const nation = m[1];
  const lastName = s.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  return { lastName, nation };
}

function isPointsSprintActivity(a: unknown): a is RaceActivityPointsSprint {
  return (a as any)?.type === "pointsSprint";
}

/**
 * Optimized: uses BibProvider + MetaProvider + CompetitorsProvider
 *
 * IMPORTANT provider tree:
 * RaceStatusProvider
 *   -> RaceStatusMetaProvider
 *   -> RaceStatusCompetitorsProvider
 *   -> RaceStatusBibProvider
 */
export function useScoringViewModel(race: Race | null, syncEnabled: boolean): ScoringViewModel {
  const { bibSet } = useRaceStatusBibs(); // live bibs (stable)
  const meta = useRaceStatusMeta(); // lapsComplete/lapsToGo (primitive/stable)
  const { competitors } = useRaceStatusCompetitors(); // competitors with structural sharing (stable)

  return useMemo(() => {
    // ---- Starters ----
    const starterBibs = new Set<number>();
    const starters = race?.raceStarters ?? [];
    for (const s of starters) {
      const bib = bibToInt((s as any)?.bib);
      if (bib != null) starterBibs.add(bib);
    }

    // ---- Live bibs ----
    const liveBibs = bibSet;

    const unknownLiveBibs = new Set<number>();
    for (const bib of liveBibs) {
      if (!starterBibs.has(bib)) unknownLiveBibs.add(bib);
    }

    const missingInLiveBibs = new Set<number>();
    if (liveBibs.size > 0) {
      for (const bib of starterBibs) {
        if (!liveBibs.has(bib)) missingInLiveBibs.add(bib);
      }
    }

    // ---- Competitor lookup (by numeric bib) ----
    const competitorByBib = new Map<number, any>();
    for (const c of competitors) {
      const bib = bibToInt((c as any)?.number);
      if (bib != null && !competitorByBib.has(bib)) competitorByBib.set(bib, c);
    }

    const getMissingStarterBibsFromLive = (): Athlete[] => {
      const ageGroupId = (race as any)?.ageGroupId ?? null;

      return Array.from(unknownLiveBibs)
        .sort((a, b) => a - b)
        .map((bib) => {
          const c = competitorByBib.get(bib);

          const firstName = String(c?.firstName ?? "").trim();
          const { lastName, nation } = extractNationFromLastName(String(c?.lastName ?? ""));

          const athlete: Athlete = {
            id: newId(),
            firstName,
            lastName,
            bib,
            ageGroupId: typeof ageGroupId === "string" ? ageGroupId : null,
            nation,
          };

          return athlete;
        });
    };

    // ---- Meta ----
    const liveLapCount = meta.lapsComplete ?? null;
    const liveLapsToGo = meta.lapsToGo ?? null;

        // ---- Top bibs by position ----
    const sortedByPos = [...competitors].sort((a: any, b: any) => (a?.position ?? 9999) - (b?.position ?? 9999));

    const liveTopBibs = {
      p1Bib: bibToInt(sortedByPos[0]?.number),
      p2Bib: bibToInt(sortedByPos[1]?.number),
      p3Bib: bibToInt(sortedByPos[2]?.number),
    };

    // ---- Last eligible bib by position (used for EliminationScoring prefill) ----
    // "Eligible" means: not DNF, not DNS, not DSQ in current raceResults.
    const ineligible = new Set<number>();
    const raceResults = Array.isArray((race as any)?.raceResults) ? ((race as any).raceResults as any[]) : [];

    for (const r of raceResults) {
      const bib = bibToInt((r as any)?.bib);
      if (bib == null) continue;
      if ((r as any)?.dnf !== false || (r as any)?.dns || (r as any)?.dsq) ineligible.add(bib);
    }

            const lastEligible: number[] = [];
    for (let i = sortedByPos.length - 1; i >= 0; i--) {
      const bib = bibToInt((sortedByPos[i] as any)?.number);
      if (bib == null) continue;
      if (ineligible.has(bib)) continue;
      lastEligible.push(bib);
      if (lastEligible.length >= 2) break;
    }

    const liveLastEligibleBibs = {
      lastBib: lastEligible[0] ?? null,
      secondLastBib: lastEligible[1] ?? null,
    };


    // ---- Zero-lap bibs (used for DNS helper) ----
    const zeroLapSet = new Set<number>();
    for (const c of competitors) {
      const bib = bibToInt((c as any)?.number);
      if (bib == null) continue;
      if (ineligible.has(bib)) continue;

      const laps = Number((c as any)?.lapsComplete);
      if (!Number.isFinite(laps)) continue;
      if (Math.floor(laps) !== 0) continue;

      zeroLapSet.add(bib);
    }

    const liveZeroLapBibs = Array.from(zeroLapSet).sort((a, b) => a - b);


    // ---- Standings (Points) ----
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

        const buildStartersForBibs = (bibs: number[]): Athlete[] => {
      const ageGroupId = (race as any)?.ageGroupId ?? null;

      const uniqueMissing = Array.from(
        new Set(
          (Array.isArray(bibs) ? bibs : [])
            .map((b) => bibToInt(b))
            .filter((b): b is number => b != null),
        ),
      )
        // nur die, die noch nicht in Startern existieren
        .filter((bib) => !starterBibs.has(bib))
        .sort((a, b) => a - b);

      return uniqueMissing.map((bib) => {
        const c = competitorByBib.get(bib);

        const firstName = String(c?.firstName ?? "").trim();
        const { lastName, nation } = extractNationFromLastName(String(c?.lastName ?? ""));

        const athlete: Athlete = {
          id: newId(),
          firstName,
          lastName,
          bib,
          ageGroupId: typeof ageGroupId === "string" ? ageGroupId : null,
          nation,
        };

        return athlete;
      });
    };

        return {
      starterBibs,
      liveBibs,
      unknownLiveBibs,
      missingInLiveBibs,
      standings,
      syncEnabled,
      liveLapCount,
      liveLapsToGo,
                        liveTopBibs,
      liveLastEligibleBibs,
      liveZeroLapBibs,

      getMissingStarterBibsFromLive,
      buildStartersForBibs,
    };
  }, [
        race?.raceStarters,
    (race as any)?.raceActivities,
    (race as any)?.raceResults,

    // optimized providers
    bibSet,
    meta.lapsComplete,
    meta.lapsToGo,
    competitors,

    // ui state
    syncEnabled,
  ]);
}