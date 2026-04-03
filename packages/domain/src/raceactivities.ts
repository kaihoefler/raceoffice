/**
 * raceactivities
 * --------------
 * Shared domain activity model for race timelines.
 *
 * Notes:
 * - Activity records are immutable events from the domain perspective.
 * - Some activity kinds contain `history` snapshots for edit tracking.
 */

type GenericRaceActivity<Type extends string, Data = Record<PropertyKey, never>> = {
  id: string;

  /** ISO 8601 timestamp */
  createdAt: string;

  type: Type;
  data: Data;
};

// Points sprint activity.
export type RaceActivityPointsSprint = GenericRaceActivity<
  "pointsSprint",
  {
    lap: number;
    isDeleted: boolean;
    results: { bib: number; points: number }[];
    history: {
      changedAt: string;
      lap: number;
      isDeleted: boolean;
      results: { bib: number; points: number }[];
    }[];
  }
>;

// Points removal activity (removes points collected up to a lap).
export type RaceActivityPointsRemoval = GenericRaceActivity<
  "pointsRemoval",
  {
    lap: number;
    isDeleted: boolean;
    results: { bib: number }[];
    history: {
      changedAt: string;
      lap: number;
      isDeleted: boolean;
      results: { bib: number }[];
    }[];
  }
>;

// Disqualification activity.
// NOTE: `RaceActivityDisqualfication` keeps original project spelling for compatibility.
export type RaceActivityDisqualfication = GenericRaceActivity<
  "DSQ",
  {
    isDeleted: boolean;
    bib: number;
    history: {
      changedAt: string;
      isDeleted: boolean;
    }[];
  }
>;

// Did not start activity.
export type RaceActivityDns = GenericRaceActivity<
  "DNS",
  {
    isDeleted: boolean;
    bib: number;
    history: {
      changedAt: string;
      isDeleted: boolean;
    }[];
  }
>;

// Did not finish activity.
// Lap is relevant because standings depend on elimination/exit sequence.
export type RaceActivityDNF = GenericRaceActivity<
  "DNF",
  {
    lap: number;
    isDeleted: boolean;
    dnfType: "dnf" | "elimination";
    results: { bib: number }[];
    history: {
      changedAt: string;
      lap: number;
      dnfType: "dnf" | "elimination";
      isDeleted: boolean;
      results: { bib: number }[];
    }[];
  }
>;

export type DisqualificationType = "DSQ-TF" | "DSQ-SF" | "DSQ-DF";

/**
 * Currently supported race activities in the application.
 */
export type RaceActivity =
  | RaceActivityDNF
  | RaceActivityPointsSprint
  | RaceActivityDisqualfication
  | RaceActivityDns
  | RaceActivityPointsRemoval;
