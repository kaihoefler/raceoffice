import type { AgeGroup } from "./agegroup";

export type Race = {
  id: string;
  name: string;
  slug: string;
  ageGroup: AgeGroup;
  eventId: string;
  resutls: RaceResults[];


};


export type RaceResults = {
  bib: string;
  rank: number;
  points: number;
  eliminated: boolean;
  dns: boolean;
  dsq: boolean;
  time: string;
  raceId: string;
};



