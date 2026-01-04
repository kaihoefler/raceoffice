import type { AgeGroup } from "./agegroup";

export type Athlete = {
  id: string;

  firstName: string;
  lastName: string;
  bib: number | null;
  ageGroup: AgeGroup | null;
  nation: string | null;

};