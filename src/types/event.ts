import type { Race } from "./race";
import type { Athlete } from "./athlete";
import type { AgeGroup } from "./agegroup";


export type Event = {
  id: string;
  slug: string;
  name: string;
  ageGroups: AgeGroup[];
};

export type FullEvent = Event & {
  
  races: Race[];
  athletes: Athlete[];
};

/**
 * EventList ist jetzt ein Container:
 * - activeEventId: aktuell aktives Event (oder null)
 * - events: die Event-Liste
 */
export type EventList = {
  activeEventId: string | null;
  events: Event[];
};
