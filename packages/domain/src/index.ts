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
export type { AgeGroup } from "./agegroup";
export type { Athlete } from "./athlete";
export type { Event, EventList, FullEvent } from "./event";
export type { Race } from "./race";
export type {
  DisqualificationType,
  RaceActivity,
  RaceActivityDNF,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityPointsRemoval,
  RaceActivityPointsSprint,
} from "./raceactivities";
export type { RaceActivityInput, RaceResult, RaceResultDnf } from "./raceResults";

// Shared race-results pure functions.
export {
  applyActivitiesToRaceResults,
  bibToInt,
  makeDefaultRaceResult,
  materializeRaceResults,
  recomputeRaceResults,
  sortRaceResultsForStandings,
} from "./raceResults";

// Shared race-activities pure functions.
export {
  filterActivitiesByAllowedBibs,
  removeBibFromActivities,
} from "./raceActivitiesActions";
