import React, { createContext, useContext, useMemo } from "react";

import { useRaceStatus } from "./RaceStatusProvider";

export type RaceStatusTimeContextValue = {
  /** e.g. "0:15" or "0:15.032" */
  elapsedTime: string | null;
  /** usually a wall clock time */
  timeOfDay: string | null;
};

const RaceStatusTimeContext = createContext<RaceStatusTimeContextValue | null>(null);

type Props = {
  children: React.ReactNode;
};

/**
 * Lightweight context focused only on time fields.
 * Must be rendered inside {@link RaceStatusProvider}.
 */
export function RaceStatusTimeProvider({ children }: Props) {
  const { currentRace } = useRaceStatus();

  const elapsedTime = (currentRace?.elapsedTime ?? null) as string | null;
  const timeOfDay = (currentRace?.timeOfDay ?? null) as string | null;

  // Depend only on the primitive values so the context value doesn't change
  // when other race fields update.
  const value = useMemo(
    () => ({
      elapsedTime,
      timeOfDay,
    }),
    [elapsedTime, timeOfDay],
  );

  return <RaceStatusTimeContext.Provider value={value}>{children}</RaceStatusTimeContext.Provider>;
}

export function useRaceStatusTime() {
  const ctx = useContext(RaceStatusTimeContext);
  if (!ctx) throw new Error("useRaceStatusTime must be used within RaceStatusTimeProvider");
  return ctx;
}
