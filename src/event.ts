import type { Race } from "./race";
import type { Athlete } from "./athlete";


export type Event = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
};

export type FullEvent = Event & {
  
  races: Race[];
  athletes: Athlete[];
};

export type EventList = Event[];

