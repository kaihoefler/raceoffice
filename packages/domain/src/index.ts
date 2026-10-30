/**
 * @raceoffice/domain
 * -----------------
 * Public API entry point for shared, framework-agnostic domain logic.
 *
 * Design intent:
 * - expose a small, stable surface for client and server
 * - keep internals private (consumers import only from this file)
 * - keep all exports deterministic and side-effect free
 */

/**
 * Tiny pure helper retained from step 1 to validate package wiring.
 *
 * Behavior:
 * - accepts an array of numbers
 * - ignores non-finite values (NaN / Infinity) by treating them as 0
 * - returns the deterministic numeric sum
 */
export function sumPoints(points: number[]): number {
  const list = Array.isArray(points) ? points : [];
  return list.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

// Core shared domain types.
export type { AgeGroup } from "./agegroup.js";
export type { Athlete } from "./athlete.js";
export type {
  CsvParseResult,
  SkippedStarterRowInfo,
  StarterImportAnalysis,
  StarterImportRow,
} from "./starterImport.js";

export type { Event, EventList, FullEvent } from "./event.js";
export type { Race } from "./race.js";
export type {
  DisqualificationType,
  RaceActivity,
  RaceActivityDNF,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityPointsRemoval,
  RaceActivityPointsSprint,
} from "./raceactivities.js";
export type { RaceActivityInput, RaceResult, RaceResultDnf } from "./raceResults.js";

// Shared race-results pure functions.
export {
  applyActivitiesToRaceResults,
  bibToInt,
  makeDefaultRaceResult,
  materializeRaceResults,
  recomputeRaceResults,
  sortRaceResultsForStandings,
} from "./raceResults.js";

// Shared race-activities pure functions.
export {
  filterActivitiesByAllowedBibs,
  removeBibFromActivities,
} from "./raceActivitiesActions.js";

// Shared starter-import parsing + mapping helpers.
export {
  analyzeStarterImportCsv,
  buildHeaderIndex,
  parseDelimitedText,
} from "./starterImport.js";

// Realtime document protocol rules and document bootstrap (shared by server and test fakes).
export {
  applyClientWrite,
  parseClientWrite,
  toErrorFrame,
  type ClientWrite,
  type ProtocolRejection,
  type RealtimeDoc,
  type WsErrorCode,
  type WsErrorPayload,
} from "./realtimeProtocol.js";
export { initialDocumentData } from "./documentBootstrap.js";

// External live race status feed (timing system) contract.
export type {
  RaceStatusCompetitor,
  RaceStatusFlag,
  RaceStatusRace,
} from "./raceStatusFeed.js";
export { pickCurrentRace } from "./raceStatusFeed.js";

// Leaderboard service protocol (WebSocket race stream, service status).
export type {
  LeaderboardServiceStatus,
  LeaderboardSource,
  LeaderboardWsClientMessage,
  LeaderboardWsMessage,
} from "./leaderboardProtocol.js";

// LiveTracking domain model (phase 0 baseline).
export * from "./livetracking/index.js";

