import React, { createContext, useContext, useMemo, useRef } from "react";

import { useRaceStatus, type RaceStatusCompetitor } from "./RaceStatusProvider";

export type RaceStatusCompetitorsContextValue = {
  /**
   * Competitors as received from the live status feed.
   * Uses structural sharing per competitor so unchanged competitors keep the same object reference.
   */
  competitors: RaceStatusCompetitor[];
  /**
   * Fast lookup by competitor number (bib string).
   * The map instance is stable as long as its contents don't change.
   */
  competitorByNumber: ReadonlyMap<string, RaceStatusCompetitor>;
};

const RaceStatusCompetitorsContext = createContext<RaceStatusCompetitorsContextValue | null>(null);

type Props = {
  children: React.ReactNode;
};

function isSameCompetitor(a: RaceStatusCompetitor, b: RaceStatusCompetitor): boolean {
  return (
    a.number === b.number &&
    a.position === b.position &&
    a.lapsComplete === b.lapsComplete &&
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.totalTime === b.totalTime
  );
}

function arraysShallowEqual<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function mapsEqual<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k)) return false;
    if (b.get(k) !== v) return false;
  }
  return true;
}

/**
 * Provides competitors from the live race status with structural sharing.
 *
 * Must be rendered inside {@link RaceStatusProvider}.
 */
export function RaceStatusCompetitorsProvider({ children }: Props) {
  const { currentRace } = useRaceStatus();

  const prevRef = useRef<RaceStatusCompetitorsContextValue>({
    competitors: [],
    competitorByNumber: new Map<string, RaceStatusCompetitor>(),
  });

  const source = currentRace?.competitors ?? [];

  const value = useMemo(() => {
    const prev = prevRef.current;

    // Build a lookup of previous competitors by number for reuse.
    const prevByNumber = prev.competitorByNumber;

    const nextCompetitors: RaceStatusCompetitor[] = [];

    for (const raw of source) {
      const key = String((raw as any)?.number ?? "");
      if (!key.trim()) continue;

      const candidate = raw as RaceStatusCompetitor;
      const prevItem = prevByNumber.get(key);

      if (prevItem && isSameCompetitor(prevItem, candidate)) {
        nextCompetitors.push(prevItem);
      } else {
        // Normalize to ensure we don't keep accidental prototype / extra props from the payload.
        nextCompetitors.push({
          number: String(candidate.number ?? ""),
          position: Number(candidate.position ?? 0),
          lapsComplete: Number(candidate.lapsComplete ?? 0),
          firstName: String(candidate.firstName ?? ""),
          lastName: String(candidate.lastName ?? ""),
          totalTime: String(candidate.totalTime ?? ""),
        });
      }
    }

    // Keep array reference stable when no item references or order changed.
    const competitors = arraysShallowEqual(prev.competitors, nextCompetitors) ? prev.competitors : nextCompetitors;

    // Build next map. Keep reference stable if identical.
    const nextMap = new Map<string, RaceStatusCompetitor>();
    for (const c of competitors) nextMap.set(c.number, c);
    const competitorByNumber = mapsEqual(prev.competitorByNumber, nextMap) ? prev.competitorByNumber : nextMap;

    // If nothing changed, return previous value object to keep context value stable.
    if (competitors === prev.competitors && competitorByNumber === prev.competitorByNumber) return prev;

    const next: RaceStatusCompetitorsContextValue = { competitors, competitorByNumber };
    prevRef.current = next;
    return next;
  }, [source]);

  return <RaceStatusCompetitorsContext.Provider value={value}>{children}</RaceStatusCompetitorsContext.Provider>;
}

export function useRaceStatusCompetitors() {
  const ctx = useContext(RaceStatusCompetitorsContext);
  if (!ctx) throw new Error("useRaceStatusCompetitors must be used within RaceStatusCompetitorsProvider");
  return ctx;
}
