/**
 * agegroup
 * --------
 * Shared domain type for event age groups.
 */
export type AgeGroup = {
  id: string;
  name: string;
  gender: "men" | "ladies" | "mixed";
  slug: string;
  eventId: string;
};
