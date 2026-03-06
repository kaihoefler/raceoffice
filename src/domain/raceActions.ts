import type { Athlete } from "../types/athlete";
import type { Race } from "../types/race";

import { filterActivitiesByAllowedBibs } from "./raceActivitiesActions";
import { bibToInt, materializeRaceResults } from "./raceResultsActions";
import { removeStarterById, upsertStarters } from "./startersActions";

function collectStarterBibs(starters: Athlete[]): Set<number> {
  const bibs = new Set<number>();

  for (const starter of Array.isArray(starters) ? starters : []) {
    const bib = bibToInt(starter?.bib);
    if (bib != null) bibs.add(bib);
  }

  return bibs;
}

/**
 * Replaces the starter list of a race and rebuilds all starter-dependent structures.
 *
 * Consistency rules:
 * - remove raceResults for bibs that are no longer part of the starters list
 * - remove activity references for bibs that are no longer part of the starters list
 * - rematerialize raceResults from the cleaned starters + activities
 */
export function replaceRaceStartersInRace(race: Race, nextStarters: Athlete[]): Race {
  const safeStarters = Array.isArray(nextStarters) ? nextStarters : [];
  const allowedBibs = collectStarterBibs(safeStarters);

  const nextActivities = filterActivitiesByAllowedBibs(Array.isArray(race.raceActivities) ? race.raceActivities : [], allowedBibs);
  const nextPrevResults = (Array.isArray(race.raceResults) ? race.raceResults : []).filter((result) => {
    const bib = bibToInt(result?.bib);
    return bib != null && allowedBibs.has(bib);
  });

  const nextResults = materializeRaceResults({
    prevResults: nextPrevResults,
    starters: safeStarters,
    activities: nextActivities,
  });

  return {
    ...race,
    raceStarters: safeStarters,
    raceActivities: nextActivities,
    raceResults: nextResults,
  };
}

/**
 * Adds or merges starters into a race and rebuilds raceResults afterwards.
 *
 * This is the aggregate-aware counterpart to `upsertStarters(...)` and should be used
 * whenever new starters are imported from live data or merged from other sources.
 */
export function upsertRaceStartersInRace(race: Race, incoming: Athlete[]): Race {
  const nextStarters = upsertStarters(Array.isArray(race.raceStarters) ? race.raceStarters : [], incoming ?? []);
  return replaceRaceStartersInRace(race, nextStarters);
}

/**
 * Removes one starter from a race and keeps raceStarters / raceResults / raceActivities consistent.
 */
export function removeStarterFromRace(race: Race, athleteId: string): Race {
  const nextStarters = removeStarterById(Array.isArray(race.raceStarters) ? race.raceStarters : [], athleteId);

  if (nextStarters.length === (Array.isArray(race.raceStarters) ? race.raceStarters.length : 0)) {
    return race;
  }

  return replaceRaceStartersInRace(race, nextStarters);
}
