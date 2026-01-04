import type { Race } from "./race";
import type { Athlete } from "./athlete";
import type { AgeGroup } from "./agegroup";


export type Event = {
  id: string;
  slug: string;
  name: string;
  ageGroups: AgeGroup[];
  isActive: boolean;
};

export type FullEvent = Event & {
  
  races: Race[];
  athletes: Athlete[];
};

export type EventList = Event[];

