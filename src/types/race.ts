
export type Race = {
  id: string;
  name: string;
  slug: string;
  isPointsRace: boolean; // if true, the race is a points race
  isEliminationRace: boolean; // if true, the race is an elimination race
  ageGroupId: string;
  eventId: string;
  raceResutls: RaceResult[];

};


export type RaceResult = {
  bib: string;
  rank: number;
  points: number;
  eliminated: boolean;
  dns: boolean;
  dsq: boolean;
  time: string;
};



