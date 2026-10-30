/**
 * Race state → REST/WS transfer object, identical to Java `RaceTO`/`CompetitorTO`
 * (field names and order as serialized by Gson).
 *
 * Deviation: competitors are sorted by position (position 0 = not yet classified goes last,
 * ties by number). Java returns them in HashMap order, i.e. effectively random; consumers
 * must not rely on the order either way.
 */
import type { RaceStatusCompetitor, RaceStatusRace } from "@raceoffice/domain";
import { formatDuration } from "../duration.js";
import type { CompetitorState, RaceState } from "./model.js";

/** Full transfer object of one race (the domain type with all Java fields present). */
export type RaceTO = Required<Omit<RaceStatusRace, "competitors">> & { competitors: CompetitorTO[] };
export type CompetitorTO = Required<RaceStatusCompetitor>;

export function toCompetitorTO(c: CompetitorState): CompetitorTO {
  return {
    number: c.number,
    position: c.position,
    lapsComplete: c.lapsComplete,
    firstName: c.firstName,
    lastName: c.lastName,
    totalTime: formatDuration(c.totalTimeMs),
    bestLap: formatDuration(c.bestLapMs),
    lastLap: formatDuration(c.lastLapMs),
    qualiPosition: c.qualiPosition,
  };
}

/** Sort key: classified competitors by position, unclassified (position 0) last. */
export function compareCompetitorTO(a: CompetitorTO, b: CompetitorTO): number {
  const pa = a.position > 0 ? a.position : Number.MAX_SAFE_INTEGER;
  const pb = b.position > 0 ? b.position : Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return a.number.localeCompare(b.number, "en", { numeric: true });
}

export function toRaceTO(race: RaceState): RaceTO {
  return {
    raceName: race.name,
    raceID: race.id,
    flagStatus: race.flagStatus,
    elapsedTime: formatDuration(race.elapsedMs),
    timeOfDay: formatDuration(race.timeOfDayMs),
    lapsComplete: race.lapsComplete,
    lapsToGo: race.lapsToGo,
    trackName: race.trackName,
    trackLength: race.trackLength,
    competitors: [...race.competitors.values()].map(toCompetitorTO).sort(compareCompetitorTO),
  };
}
