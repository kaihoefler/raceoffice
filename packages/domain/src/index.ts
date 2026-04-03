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
