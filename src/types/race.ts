import type { Athlete } from "./athlete";
import type { RaceActivity } from "./raceactivities";

export type Race = {
  id: string;
  name: string;
  slug: string;
  racemode: {
    isPointsRace: boolean; // if true, the race is a points race
    isEliminationRace: boolean; // if true, the race is an elimination race
  }
  stage: "" | "heat" | "final" | "qualifying",
  stage_value: string, // e.g. "1", "2", "3" for heats or qualifying, "A", "B" for final
  distance_value: string, // e.g. "200m", "1k", "5k"
  ageGroupId: string;
  eventId: string;
  raceResults: RaceResult[];
  raceStarters: Athlete[];
  raceActivities: RaceActivity[];
  finishLineResults: FinishLineResult[];

};

export type FinishLineResult = {
  bib: number;
  rank: number;
  lapsComplete: number;
  totalTime: string; // e.g. "0:15" or "0:15.032"
};

export type RaceResult = {
  bib: number;
  rank: number;
  points: number;
  eliminated: boolean;
  dns: boolean;
  dsq: boolean;
  time: string;
};



