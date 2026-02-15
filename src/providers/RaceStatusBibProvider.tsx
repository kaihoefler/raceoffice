import React, { createContext, useContext, useMemo, useRef } from "react";

import { useRaceStatus } from "./RaceStatusProvider";

export type RaceStatusBibContextValue = {
  /** Sorted, unique bibs currently known from live competitors. */
  bibs: number[];
  /** Convenience set (same contents as {@link bibs}). */
  bibSet: ReadonlySet<number>;
};

const RaceStatusBibContext = createContext<RaceStatusBibContextValue | null>(null);

type Props = {
  children: React.ReactNode;
};

function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Provides bibs derived from the live race status.
 *
 * Notes:
 * - Uses stable references (structural sharing) so consumers only re-render when the bib list changes.
 * - Must be rendered inside {@link RaceStatusProvider}.
 */
export function RaceStatusBibProvider({ children }: Props) {
  const { currentRace } = useRaceStatus();

  const prevRef = useRef<RaceStatusBibContextValue>({ bibs: [], bibSet: new Set<number>() });

  const nextBibs = useMemo(() => {
    const competitors = currentRace?.competitors ?? [];
    const set = new Set<number>();
    for (const c of competitors) {
      const bib = bibToInt((c as any)?.number);
      if (bib != null) set.add(bib);
    }
    return Array.from(set).sort((x, y) => x - y);
  }, [currentRace?.competitors]);

  // Structural sharing: keep previous references if nothing changed.
  const value = useMemo(() => {
    const prev = prevRef.current;
    if (arraysEqual(prev.bibs, nextBibs)) return prev;

    const next: RaceStatusBibContextValue = {
      bibs: nextBibs,
      bibSet: new Set(nextBibs),
    };

    prevRef.current = next;
    return next;
  }, [nextBibs]);

  return <RaceStatusBibContext.Provider value={value}>{children}</RaceStatusBibContext.Provider>;
}

export function useRaceStatusBibs() {
  const ctx = useContext(RaceStatusBibContext);
  if (!ctx) throw new Error("useRaceStatusBibs must be used within RaceStatusBibProvider");
  return ctx;
}
