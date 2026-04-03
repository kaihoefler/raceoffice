/**
 * athlete
 * -------
 * Shared domain type for race participants.
 *
 * This shape is intentionally kept minimal and transport-neutral so both client
 * and server can use it without UI or persistence coupling.
 */
export type Athlete = {
  id: string;
  firstName: string;
  lastName: string;
  bib: number | null;
  ageGroupId: string | null;
  nation: string | null;
};
