// src/test/fixtures.ts
//
// Realtime documents for component tests: an active event with races, as the server holds
// them ("eventList" + "Event-<id>"). Only spell out what a test is about; the rest defaults.

import type { Athlete, FullEvent, Race } from "@raceoffice/domain";

export const TEST_EVENT_ID = "e1";
export const TEST_AGE_GROUP_ID = "ag1";

export function athlete(bib: number, overrides: Partial<Athlete> = {}): Athlete {
  return { id: `a${bib}`, bib, firstName: "Rider", lastName: String(bib), ageGroupId: TEST_AGE_GROUP_ID, nation: null, ...overrides };
}

export function race(overrides: Partial<Race> & { starterBibs?: number[] } = {}): Race {
  const { starterBibs = [], ...rest } = overrides;
  return {
    id: "r1",
    name: "Cadet Men 6000 Elim-Final B",
    slug: "cadet_men_6000_elim_final_b",
    racemode: { isPointsRace: false, isEliminationRace: true },
    stage: "final",
    stage_value: "B",
    distance_value: "6000",
    ageGroupId: TEST_AGE_GROUP_ID,
    eventId: TEST_EVENT_ID,
    raceStarters: starterBibs.map((bib) => athlete(bib)),
    raceResults: [],
    raceActivities: [],
    ...rest,
  };
}

/** "eventList" with one active event plus its full "Event-<id>" document. */
export function eventDocs({ races = [race()], activeRaceId = null }: { races?: Race[]; activeRaceId?: string | null } = {}) {
  const fullEvent: FullEvent = {
    id: TEST_EVENT_ID,
    slug: "test-event",
    name: "Test Event",
    activeRaceId,
    races,
    athletes: races.flatMap((r) => r.raceStarters),
    ageGroups: [{ id: TEST_AGE_GROUP_ID, name: "Cadet (men)", gender: "men", slug: "cadet_men", eventId: TEST_EVENT_ID }],
  };

  return {
    eventList: { activeEventId: TEST_EVENT_ID, events: [{ id: TEST_EVENT_ID, slug: fullEvent.slug, name: fullEvent.name }] },
    [`Event-${TEST_EVENT_ID}`]: fullEvent,
  };
}
