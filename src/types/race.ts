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

};


export type RaceResult = {
  bib: number;
  rank: number; // current rank in the race, 0 if not yet ranked
  points: number; // current points in the race
  dnf: false | "dnf" | "elimination";
  dnfLap: number; // 0 if not DNF
  dns: boolean;
  dsq: boolean;
  lapsCompleted: number; // 0 or number of laps completed when the race is finished
  finishTime: string; // e.g. "0:15" or "0:15,032" and "" if not finished
  finishRank: number; // 0 if not finished

};



