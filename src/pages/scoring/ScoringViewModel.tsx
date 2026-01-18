// src/pages/scoring/ScoringViewModel.tsx
import { useMemo } from "react";

import type { RaceStatusRace } from "../../providers/RaceStatusProvider";
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
  liveBibs: Set<number>;

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
   * Build Athlete objects for competitors that appear in liveRace but are missing in race.raceStarters.
   * Can be used by the page to append them to the race starters list.
   */
  getMissingStarterBibsFromLive: () => Athlete[];
};



function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function newId() {
  return (
    (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function extractNationFromLastName(lastNameRaw: string): { lastName: string; nation: string | null } {
  const s = String(lastNameRaw ?? "").trim();

  // Common pattern from timing feeds: "Lastname (GER)".
  // Accept 3-letter code in parentheses, optionally at the end with whitespace.
  const m = s.match(/\(([A-Z]{3})\)\s*$/);
  if (!m) return { lastName: s, nation: null };

  const nation = m[1];
  const lastName = s.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  return { lastName, nation };
}

function isPointsSprintActivity(a: unknown): a is RaceActivityPointsSprint {
  return (a as any)?.type === "pointsSprint";
}

export function useScoringViewModel(
  race: Race | null,
  liveRace: RaceStatusRace | null,
  syncEnabled: boolean,
): ScoringViewModel {

  return useMemo(() => {
    const starterBibs = new Set<number>();
    const liveBibs = new Set<number>();

    const starters = race?.raceStarters ?? [];
    for (const s of starters) {
      const bib = bibToInt((s as any)?.bib);
      if (bib != null) starterBibs.add(bib);
    }

    const competitors = liveRace?.competitors ?? [];
    for (const c of competitors) {
      const bib = bibToInt((c as any)?.number);
      if (bib != null) liveBibs.add(bib);
    }

    const unknownLiveBibs = new Set<number>();
    for (const bib of liveBibs) {
      if (!starterBibs.has(bib)) unknownLiveBibs.add(bib);
    }

    const missingInLiveBibs = new Set<number>();
    for (const bib of starterBibs) {
      if (!liveBibs.has(bib)) missingInLiveBibs.add(bib);
    }

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

        const liveLapRaw = (liveRace as any)?.lapsComplete;
    const liveLapCount = Number.isFinite(Number(liveLapRaw)) ? Number(liveLapRaw) : null;

        const liveLapsToGoRaw = (liveRace as any)?.lapsToGo;
    const liveLapsToGo = Number.isFinite(Number(liveLapsToGoRaw)) ? Number(liveLapsToGoRaw) : null;

    const sortedByPos = [...competitors].sort((a: any, b: any) => (a?.position ?? 9999) - (b?.position ?? 9999));
    const liveTopBibs = {
      p1Bib: bibToInt(sortedByPos[0]?.number),
      p2Bib: bibToInt(sortedByPos[1]?.number),
      p3Bib: bibToInt(sortedByPos[2]?.number),
    };


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

    // Include all starters (0 points) in the standings.
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
      standings,

            syncEnabled,
      liveLapCount,
      liveLapsToGo,
      liveTopBibs,

      getMissingStarterBibsFromLive,
    };
  }, [
    race?.raceStarters,
    (race as any)?.raceActivities,
    liveRace?.competitors,
    (liveRace as any)?.lapsComplete,
    (liveRace as any)?.lapsToGo,
    syncEnabled,
  ]);
}