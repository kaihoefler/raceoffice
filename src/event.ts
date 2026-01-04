import type { Race } from "./race";
import type { Athlete } from "./athlete";
import type { AgeGroup } from "./agegroup";


export type Event = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
};

export type FullEvent = Event & {
  
  races: Race[];
  ageGroups: AgeGroup[];
  athletes: Athlete[];
};

export type EventList = Event[];

