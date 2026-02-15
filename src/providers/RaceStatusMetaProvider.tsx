import React, { createContext, useContext, useMemo } from "react";

import { useRaceStatus, type RaceStatusFlag } from "./RaceStatusProvider";

export type RaceStatusMetaContextValue = {
  // connection / polling meta
  status: "idle" | "loading" | "ok" | "error" | "paused";
  error: string | null;
  /** Timestamp (ms) of the last SUCCESSFUL update */
  updatedAt: number | null;
  url: string;
  pollIntervalMs: number;
  effectivePollIntervalMs: number;
  paused: boolean;
  errorCount: number;

  // race meta (excludes time fields + competitors)
  hasActiveRace: boolean;
  raceID: number | null;
  raceName: string | null;
  flagStatus: RaceStatusFlag | null;
  lapsComplete: number | null;
  lapsToGo: number | null;
};

const RaceStatusMetaContext = createContext<RaceStatusMetaContextValue | null>(null);

type Props = {
  children: React.ReactNode;
};

/**
 * Context with race + connection metadata.
 *
 * Intentionally excludes:
 * - `elapsedTime`, `timeOfDay` (use RaceStatusTimeProvider)
 * - `competitors` / derived bib lists (use RaceStatusCompetitorsProvider / RaceStatusBibProvider)
 *
 * Must be rendered inside {@link RaceStatusProvider}.
 */
export function RaceStatusMetaProvider({ children }: Props) {
  const {
    status,
    error,
    updatedAt,
    url,
    pollIntervalMs,
    effectivePollIntervalMs,
    paused,
    errorCount,
    currentRace,
  } = useRaceStatus();

  // Extract only primitive meta fields so changes in elapsedTime/timeOfDay/competitors
  // don't force meta consumers to re-render.
  const hasActiveRace = currentRace != null;
  const raceID = currentRace?.raceID ?? null;
  const raceName = currentRace?.raceName ?? null;
  const flagStatus = (currentRace?.flagStatus ?? null) as RaceStatusFlag | null;
  const lapsComplete = currentRace?.lapsComplete ?? null;
  const lapsToGo = currentRace?.lapsToGo ?? null;

  const value: RaceStatusMetaContextValue = useMemo(
    () => ({
      status,
      error,
      updatedAt,
      url,
      pollIntervalMs,
      effectivePollIntervalMs,
      paused,
      errorCount,

      hasActiveRace,
      raceID,
      raceName,
      flagStatus,
      lapsComplete,
      lapsToGo,
    }),
    [
      status,
      error,
      updatedAt,
      url,
      pollIntervalMs,
      effectivePollIntervalMs,
      paused,
      errorCount,
      hasActiveRace,
      raceID,
      raceName,
      flagStatus,
      lapsComplete,
      lapsToGo,
    ],
  );

  return <RaceStatusMetaContext.Provider value={value}>{children}</RaceStatusMetaContext.Provider>;
}

export function useRaceStatusMeta() {
  const ctx = useContext(RaceStatusMetaContext);
  if (!ctx) throw new Error("useRaceStatusMeta must be used within RaceStatusMetaProvider");
  return ctx;
}
