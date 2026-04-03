import type { AgeGroup } from "./agegroup";
import type { Athlete } from "./athlete";
import type { Race } from "./race";

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
