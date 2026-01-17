// src/pages/ScoringViewModel.tsx
import { useMemo } from "react";
import type { Athlete } from "../../types/athlete";
import type { Race } from "../../types/race";
import type { RaceStatusRace } from "../../providers/RaceStatusProvider";


export type ScoringViewModel = {
  /** bibs from race.raceStarters */
  starterBibs: Set<number>;
  /** bibs from live status */
  liveBibs: Set<number>;

  /** bibs seen in live status but not in starters list */
  unknownLiveBibs: Set<number>;

  /** bibs in starters list but not seen in live status */
  missingInLiveBibs: Set<number>;

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
  return (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

export function useScoringViewModel(race: Race | null, liveRace: RaceStatusRace | null): ScoringViewModel {

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


    return {
      starterBibs,
      liveBibs,
      unknownLiveBibs,
      missingInLiveBibs,
      getMissingStarterBibsFromLive,
    };
  }, [race?.raceStarters, liveRace?.competitors]);
}