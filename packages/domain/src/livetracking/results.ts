/**
 * livetracking/results
 * --------------------
 * LiveTracking sporting result projection (read model).
 *
 * Scope in phase 0:
 * - define output document shapes for live board and qualifying ranking.
 * - keep this as pure type/schema layer (no timing engine here yet).
 */

export type LiveTrackingPassingEvent = {
  id: string;
  timestamp: string;
  transponderId: string;
  timingPointId: string;
  decoderId: string;
};

export type LiveTrackingCurrentSplit = {
  timingPointId: string;
  splitTimeMs: number;
};

export type LiveTrackingCompletedLap = {
  lapNumber: number;
  lapTimeMs: number;
  valid: boolean;
  completedAt: string;
};

export type LiveTrackingActivityStatus = "active" | "inactive";

export type LiveTrackingAthleteLiveState = {
  athleteId: string;
  firstName: string;
  lastName: string;

  /** Start number if known in participant pool; null for unknown/synthetic participants. */
  bib: number | null;

  /** IOC/nation code if known in participant pool; null otherwise. */
  nation: string | null;

  transponderId: string | null;


  /**
   * Derived activity state used by UI/ops views.
   * - active: recent passing seen within configured activity window
   * - inactive: no recent passing
   */
  activityStatus: LiveTrackingActivityStatus;
  isActive: boolean;
  lastPassingAt: string | null;

  lapsCompleted: number;
  currentLapSplits: LiveTrackingCurrentSplit[];
  recentLapTimesMs: number[];
  completedLaps: LiveTrackingCompletedLap[];

  lastLapTimeMs: number | null;
  bestLapTimeMs: number | null;
};

export type LiveTrackingQualifyingEntry = {
  athleteId: string;
  bestLapTimeMs: number;
  rank: number;
};

export type LiveTrackingInvalidEvent = {
  passingEventId: string;
  reason: string;
};

export type LiveTrackingResultsDocument = {
  kind: "liveTrackingResults";
  version: 1;

  recentPassings: LiveTrackingPassingEvent[];
  athleteLiveStates: LiveTrackingAthleteLiveState[];
  qualifyingRanking: LiveTrackingQualifyingEntry[];

  unknownTransponders: string[];
  invalidEvents: LiveTrackingInvalidEvent[];
  warnings: string[];

  generatedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createLiveTrackingResultsDocument(): LiveTrackingResultsDocument {
  return {
    kind: "liveTrackingResults",
    version: 1,
    recentPassings: [],
    athleteLiveStates: [],
    qualifyingRanking: [],
    unknownTransponders: [],
    invalidEvents: [],
    warnings: [],
    generatedAt: null,
  };
}

export function isLiveTrackingPassingEvent(value: unknown): value is LiveTrackingPassingEvent {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.transponderId === "string" &&
    typeof value.timingPointId === "string" &&
    typeof value.decoderId === "string"
  );
}

export function isLiveTrackingAthleteLiveState(value: unknown): value is LiveTrackingAthleteLiveState {
  if (!isRecord(value)) return false;

  const splits = Array.isArray(value.currentLapSplits) ? value.currentLapSplits : [];

  const splitShapeOk = splits.every((split) => {
    if (!isRecord(split)) return false;
    return typeof split.timingPointId === "string" && typeof split.splitTimeMs === "number";
  });

  return (
    typeof value.athleteId === "string" &&
        typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    (typeof value.bib === "number" || value.bib === null) &&
    (typeof value.nation === "string" || value.nation === null) &&
    (typeof value.transponderId === "string" || value.transponderId === null) &&

    (value.activityStatus === "active" || value.activityStatus === "inactive") &&
    typeof value.isActive === "boolean" &&
    (typeof value.lastPassingAt === "string" || value.lastPassingAt === null) &&
    typeof value.lapsCompleted === "number" &&
    splitShapeOk &&
    Array.isArray(value.recentLapTimesMs) &&
    value.recentLapTimesMs.every((t) => typeof t === "number") &&
    Array.isArray(value.completedLaps) &&
    value.completedLaps.every((lap) => {
      if (!isRecord(lap)) return false;
      return (
        typeof lap.lapNumber === "number" &&
        typeof lap.lapTimeMs === "number" &&
        typeof lap.valid === "boolean" &&
        typeof lap.completedAt === "string"
      );
    }) &&
    (typeof value.lastLapTimeMs === "number" || value.lastLapTimeMs === null) &&
    (typeof value.bestLapTimeMs === "number" || value.bestLapTimeMs === null)
  );
}

export function isLiveTrackingResultsDocument(value: unknown): value is LiveTrackingResultsDocument {
  if (!isRecord(value)) return false;

  const qualifying = Array.isArray(value.qualifyingRanking) ? value.qualifyingRanking : [];
  const invalidEvents = Array.isArray(value.invalidEvents) ? value.invalidEvents : [];

  return (
    value.kind === "liveTrackingResults" &&
    value.version === 1 &&
    Array.isArray(value.recentPassings) &&
    value.recentPassings.every(isLiveTrackingPassingEvent) &&
    Array.isArray(value.athleteLiveStates) &&
    value.athleteLiveStates.every(isLiveTrackingAthleteLiveState) &&
    qualifying.every((entry) => {
      if (!isRecord(entry)) return false;
      return (
        typeof entry.athleteId === "string" &&
        typeof entry.bestLapTimeMs === "number" &&
        typeof entry.rank === "number"
      );
    }) &&
    Array.isArray(value.unknownTransponders) &&
    value.unknownTransponders.every((x) => typeof x === "string") &&
    invalidEvents.every((entry) => {
      if (!isRecord(entry)) return false;
      return typeof entry.passingEventId === "string" && typeof entry.reason === "string";
    }) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((x) => typeof x === "string") &&
    (typeof value.generatedAt === "string" || value.generatedAt === null)
  );
}
