import type { Athlete } from "./athlete";
import type { RaceActivity } from "./raceactivities";
import type { RaceResult } from "./raceResults";

/**
 * race
 * ----
 * Shared race aggregate type.
 */
export type Race = {
  id: string;
  name: string;
  slug: string;
  racemode: {
    isPointsRace: boolean;
    isEliminationRace: boolean;
  };
  stage: "" | "heat" | "final" | "qualifying";
  stage_value: string;
  distance_value: string;
  ageGroupId: string;
  eventId: string;
  raceResults: RaceResult[];
  raceStarters: Athlete[];
  raceActivities: RaceActivity[];
};

export type { RaceResult } from "./raceResults";
