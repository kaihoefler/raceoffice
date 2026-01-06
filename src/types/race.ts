
export type Race = {
  id: string;
  name: string;
  slug: string;
  ageGroupId: string;
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



