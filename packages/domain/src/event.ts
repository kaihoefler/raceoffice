import type { AgeGroup } from "./agegroup.js";
import type { Athlete } from "./athlete.js";
import type { Race } from "./race.js";

/**
 * event
 * -----
 * Shared event types.
 */
export type Event = {
  id: string;
  slug: string;
  name: string;
};

export type FullEvent = Event & {
  /** Currently active race inside this event (or null). */
  activeRaceId: string | null;

  races: Race[];
  athletes: Athlete[];
  ageGroups: AgeGroup[];
};

/**
 * Event list document shape.
 */
export type EventList = {
  activeEventId: string | null;
  events: Event[];
};
