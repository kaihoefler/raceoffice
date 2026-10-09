// builder.ts
//
// Builds live feed states (RaceStatusRace) for tests and manual scenarios.
//
// A test should only spell out what its scoring case is about (who is where, how many laps),
// so everything else gets a neutral default. The shape follows the real feed sample in
// examples/race_status.json.

import type { RaceStatusCompetitor, RaceStatusFlag, RaceStatusRace } from "@raceoffice/domain";

export type CompetitorInput = {
  position?: number;
  /** Completed laps (`lapsComplete` in the feed). */
  laps?: number;
  totalTime?: string;
  firstName?: string;
  /** Feed style, may include a nation suffix: "Muster (GER)". */
  lastName?: string;
};

/** One rider in the feed. Defaults: position 0 (none), 0 laps, time "0:00", name "Rider <bib>". */
export function competitor(bib: number | string, input: CompetitorInput = {}): RaceStatusCompetitor {
  return {
    number: String(bib),
    position: input.position ?? 0,
    lapsComplete: input.laps ?? 0,
    firstName: input.firstName ?? "Rider",
    lastName: input.lastName ?? String(bib),
    totalTime: input.totalTime ?? "0:00",
  };
}

/**
 * A field of riders in the given order: positions 1..n, all with the same lap count.
 * Typical start: `startField([12, 7, 31])` = everybody at lap 0, positions as listed.
 */
export function startField(bibs: Array<number | string>, input: Omit<CompetitorInput, "position"> = {}): RaceStatusCompetitor[] {
  return bibs.map((bib, i) => competitor(bib, { ...input, position: i + 1 }));
}

export type RaceInput = {
  raceName?: string;
  raceID?: number;
  /** Default "GREEN" (race running). Use "" for "no active race". */
  flag?: RaceStatusFlag;
  /** Laps completed by the leader (race lap). */
  lapsComplete?: number;
  lapsToGo?: number;
  elapsedTime?: string;
  competitors?: RaceStatusCompetitor[];
};

/** One race as the feed reports it. */
export function buildRace(input: RaceInput = {}): RaceStatusRace {
  const race: RaceStatusRace = {
    raceName: input.raceName ?? "Test Race",
    raceID: input.raceID ?? 1,
    flagStatus: input.flag ?? "GREEN",
    lapsComplete: input.lapsComplete ?? 0,
    competitors: input.competitors ?? [],
  };
  if (input.lapsToGo !== undefined) race.lapsToGo = input.lapsToGo;
  if (input.elapsedTime !== undefined) race.elapsedTime = input.elapsedTime;
  return race;
}

/**
 * The raw HTTP payload of the feed: a JSON array of races.
 * `null` means "no active race" (empty array, which the frontend treats like an empty flag).
 */
export function feedPayload(race: RaceStatusRace | null): RaceStatusRace[] {
  return race ? [race] : [];
}
