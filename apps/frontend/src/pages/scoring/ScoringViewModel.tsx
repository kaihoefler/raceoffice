// src/pages/scoring/ScoringViewModel.tsx
//
// React adapter between the live feed and the scoring components.
//
// All scoring rules live in domain/liveScoring.ts (pure, unit-tested). This hook only
// - reads the current feed state from RaceStatusProvider,
// - calls deriveLiveScoring for the selected race,
// - keeps Set identities stable (see below) and adds UI state (syncEnabled).
// Do not add scoring rules here; add them to liveScoring.ts so they stay testable.
import { useMemo, useRef } from "react";

import type { Athlete, Race } from "@raceoffice/domain";

import { useRaceStatus } from "../../providers/RaceStatusProvider";
import { buildStartersForBibs, deriveLiveScoring, type LiveScoring } from "../../domain/liveScoring";

export type ScoringViewModel = Omit<
  LiveScoring,
  "liveBibs" | "unknownLiveBibs" | "missingInLiveBibs" | "blockedBibs" | "lappedIndicationByBib" | "lappedIndicationBibs"
> & {
  liveBibs: ReadonlySet<number>;
  unknownLiveBibs: Set<number>;
  missingInLiveBibs: Set<number>;
  blockedBibs: ReadonlySet<number>;
  lappedIndicationByBib: ReadonlyMap<number, number>;
  lappedIndicationBibs: ReadonlySet<number>;

  /** Live/PointsScoring synchronization toggle state (controlled by the UI). */
  syncEnabled: boolean;

  /** Starters for competitors that appear in the live feed but not in race.raceStarters. */
  getMissingStarterBibsFromLive: () => Athlete[];

  /** Starters for the given bibs (names from the live feed when available). */
  buildStartersForBibs: (bibs: number[]) => Athlete[];
};

function setsHaveSameValues(a: ReadonlySet<number>, b: ReadonlySet<number>) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Scoring view model for the scoring page: live-feed derived hints (see deriveLiveScoring)
 * plus UI state. Uses RaceStatusProvider directly.
 */
export function useScoringViewModel(race: Race | null, syncEnabled: boolean): ScoringViewModel {
  const { currentRace } = useRaceStatus();

  // Keep set identities stable while their content is unchanged: the feed delivers a new
  // object every poll, and consumers use these sets as effect/memo dependencies.
  const liveBibsRef = useRef<Set<number>>(new Set());
  const unknownLiveBibsRef = useRef<Set<number>>(new Set());
  const missingInLiveBibsRef = useRef<Set<number>>(new Set());

  return useMemo(() => {
    const derived = deriveLiveScoring(race, currentRace);

    const stabilize = (ref: { current: Set<number> }, next: Set<number>) => {
      if (!setsHaveSameValues(ref.current, next)) ref.current = next;
      return ref.current;
    };

    const unknownLiveBibs = stabilize(unknownLiveBibsRef, derived.unknownLiveBibs);

    return {
      ...derived,
      liveBibs: stabilize(liveBibsRef, derived.liveBibs),
      unknownLiveBibs,
      missingInLiveBibs: stabilize(missingInLiveBibsRef, derived.missingInLiveBibs),
      syncEnabled,
      getMissingStarterBibsFromLive: () => buildStartersForBibs(race, currentRace, Array.from(unknownLiveBibs)),
      buildStartersForBibs: (bibs: number[]) => buildStartersForBibs(race, currentRace, bibs),
    };
  }, [race, currentRace, syncEnabled]);
}
