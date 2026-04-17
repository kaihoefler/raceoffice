import {
  recomputeRaceResults,
  sortRaceResultsForStandings,
  type Athlete,
  type EventList,
  type FullEvent,
  type Race,
  type RaceActivity,
  type RaceActivityPointsSprint,
  type RaceResult,
} from "@raceoffice/domain";

/**
 * Legacy service payload consumed by external timing/overlay integrations.
 *
 * Notes:
 * - The field names intentionally keep legacy casing/wording.
 * - `Race.ID` uses the internal race UUID (string), replacing historic numeric IDs.
 */
export type ServiceRaceType = "Points" | "Elimination" | "PointsElimination";

export type CurrentRacePointResult = {
  Place: number;
  Startnumber: number;
  FirstName: string;
  LastName: string;
  FinishOrder: number;
  Eliminated: 0 | 1;
  Points: number;
};

export type CurrentRaceEliminationEntry = {
  Startnumber: number;
  FirstName: string;
  LastName: string;
  EliminationNr: number;
};

export type CurrentRaceFinishOrderEntry = {
  Startnumber: number;
  FirstName: string;
  LastName: string;
  FinishOrder: number;
};

export type CurrentRaceEliminationResultEntry = {
  Place: number;
  Startnumber: number;
  FirstName: string;
  LastName: string;
  FinishOrder: number;
  Eliminated: number;
};

export type CurrentRaceResultPayload = {
  Race: {
    Name: string;
    Type: ServiceRaceType;
    ID: string;
  };
  PointResults: CurrentRacePointResult[];
  PointsLapList: Record<string, Record<string, number>> | [];
  Eliminations: CurrentRaceEliminationEntry[];
  FinishOrder: CurrentRaceFinishOrderEntry[];
  EliminationResults: CurrentRaceEliminationResultEntry[];
};

export function toServiceRaceType(race: Race): ServiceRaceType {
  const isPoints = !!race?.racemode?.isPointsRace;
  const isElimination = !!race?.racemode?.isEliminationRace;

  if (isPoints && isElimination) return "PointsElimination";
  if (isElimination) return "Elimination";
  return "Points";
}

function isPointsSprintActivity(activity: RaceActivity): activity is RaceActivityPointsSprint {
  return activity?.type === "pointsSprint";
}

function toDisplayLastName(starter: Athlete | undefined): string {
  const lastName = String(starter?.lastName ?? "");
  const nation = String(starter?.nation ?? "").trim();
  return nation ? `${lastName} (${nation})` : lastName;
}

/**
 * Resolves the currently active race from persisted documents.
 *
 * Domain rule used by the app:
 * - event list document id is always `eventList`
 * - full event documents are stored under `Event-{eventId}`
 * - the active race is `fullEvent.activeRaceId`
 */
export function resolveCurrentRaceContext(loadDoc: (id: string) => { data: unknown }): { eventId: string; fullEvent: FullEvent; race: Race } | null {
  const eventListData = loadDoc("eventList").data as Partial<EventList>;
  const activeEventId = String(eventListData?.activeEventId ?? "").trim();
  if (!activeEventId) return null;

  const eventData = loadDoc(`Event-${activeEventId}`).data as Partial<FullEvent>;
  const races: Race[] = Array.isArray(eventData?.races) ? (eventData.races as Race[]) : [];
  const activeRaceId = String(eventData?.activeRaceId ?? "").trim();
  if (!activeRaceId) return null;

  const race = races.find((r: Race) => r?.id === activeRaceId) ?? null;
  if (!race) return null;

  return {
    eventId: activeEventId,
    fullEvent: eventData as FullEvent,
    race,
  };
}

/**
 * Builds `/current_race_result` payload from one race aggregate.
 *
 * Non-obvious decisions:
 * - PointResults are always emitted in standings order (domain sort + recompute).
 * - Eliminations are derived from raceResults (`dnf === "elimination"`, `dnfLap`).
 * - FinishOrder is derived from positive finishRank values (ascending).
 */
export function buildCurrentRaceResultPayload(race: Race): CurrentRaceResultPayload {
  const starters = Array.isArray(race?.raceStarters) ? race.raceStarters : [];
  const starterByBib = new Map<number, Athlete>();

  for (const starter of starters) {
    const bib = Number(starter?.bib);
    if (!Number.isFinite(bib)) continue;
    starterByBib.set(bib, starter);
  }

  const rawResults: RaceResult[] = Array.isArray(race?.raceResults) ? race.raceResults : [];
  const ranked = recomputeRaceResults(rawResults);
  const sorted = sortRaceResultsForStandings(ranked);

  const pointResults: CurrentRacePointResult[] = sorted.map((result: RaceResult, index: number) => {
    const bib = Number(result?.bib);
    const starter = starterByBib.get(bib);

    const rank = Number(result?.rank);
    const finishRank = Number(result?.finishRank);
    const points = Number(result?.points);

    return {
      Place: Number.isFinite(rank) && rank > 0 ? rank : index + 1,
      Startnumber: bib,
      FirstName: String(starter?.firstName ?? ""),
      LastName: toDisplayLastName(starter),
      FinishOrder: Number.isFinite(finishRank) && finishRank > 0 ? finishRank : 999,
      Eliminated: result?.dnf === "elimination" ? 1 : 0,
      Points: Number.isFinite(points) ? points : 0,
    };
  });

  const pointsLapList: Record<string, Record<string, number>> = {};
  const activities: RaceActivity[] = Array.isArray(race?.raceActivities) ? race.raceActivities : [];

  for (const activity of activities) {
    if (!isPointsSprintActivity(activity)) continue;
    if (activity.data?.isDeleted) continue;

    const lap = Number(activity.data?.lap);
    if (!Number.isFinite(lap) || lap <= 0) continue;

    const lapKey = String(Math.floor(lap));
    if (!pointsLapList[lapKey]) pointsLapList[lapKey] = {};

    const sprintResults = Array.isArray(activity.data?.results) ? activity.data.results : [];
    for (const sprintResult of sprintResults) {
      const bib = Number(sprintResult?.bib);
      const pts = Number(sprintResult?.points);
      if (!Number.isFinite(bib) || !Number.isFinite(pts)) continue;

      pointsLapList[lapKey][String(Math.floor(bib))] = pts;
    }
  }

  const eliminatedResults = ranked
    .filter((result: RaceResult) => result.dnf === "elimination")
    .filter((result: RaceResult) => Number.isFinite(Number(result.dnfLap)) && Number(result.dnfLap) > 0);

  const eliminationLapsAsc = Array.from(new Set(eliminatedResults.map((result: RaceResult) => Number(result.dnfLap)))).sort((a, b) => a - b);
  const eliminationNrByLap = new Map<number, number>(eliminationLapsAsc.map((lap, idx) => [lap, idx + 1]));

  const eliminations = eliminatedResults
    .map((result: RaceResult) => {
      const bib = Number(result.bib);
      const lap = Number(result.dnfLap);
      const eliminationNr = eliminationNrByLap.get(lap);
      if (!Number.isFinite(bib) || eliminationNr == null) return null;

      const starter = starterByBib.get(bib);
      return {
        Startnumber: bib,
        FirstName: String(starter?.firstName ?? ""),
        LastName: toDisplayLastName(starter),
        EliminationNr: eliminationNr,
      };
    })
    .filter((row): row is CurrentRaceEliminationEntry => row !== null)
    .sort((a, b) => b.EliminationNr - a.EliminationNr || a.Startnumber - b.Startnumber);

  const finishOrder = ranked
    .filter((result: RaceResult) => Number(result?.finishRank) > 0 && result.dnf !== "elimination")
    .sort((a: RaceResult, b: RaceResult) => Number(a.finishRank) - Number(b.finishRank))
    .map((result: RaceResult) => {
      const bib = Number(result.bib);
      const starter = starterByBib.get(bib);
      return {
        Startnumber: bib,
        FirstName: String(starter?.firstName ?? ""),
        LastName: toDisplayLastName(starter),
        FinishOrder: Number(result.finishRank),
      };
    });

  const eliminationResults: CurrentRaceEliminationResultEntry[] = [];
  if (finishOrder.length > 0) {
    const eliminationNrByBib = new Map<number, number>();
    for (const row of eliminations) {
      eliminationNrByBib.set(row.Startnumber, row.EliminationNr);
    }

    for (const result of sorted) {
      const bib = Number(result.bib);
      if (!Number.isFinite(bib)) continue;

      const starter = starterByBib.get(bib);
      const eliminationNr = eliminationNrByBib.get(bib) ?? 0;
      const isEliminated = eliminationNr > 0 || result.dnf === "elimination";
      const rank = Number(result.rank);

      eliminationResults.push({
        Place: Number.isFinite(rank) && rank > 0 ? rank : eliminationResults.length + 1,
        Startnumber: bib,
        FirstName: String(starter?.firstName ?? ""),
        LastName: toDisplayLastName(starter),
        FinishOrder: !isEliminated && Number(result.finishRank) > 0 ? Number(result.finishRank) : 999,
        Eliminated: eliminationNr,
      });
    }
  }

  const raceType = toServiceRaceType(race);

  return {
    Race: {
      Name: String(race?.name ?? ""),
      Type: raceType,
      ID: String(race?.id ?? ""),
    },
    PointResults: raceType === "Elimination" ? [] : pointResults,
    PointsLapList: raceType === "Elimination" ? [] : pointsLapList,
    Eliminations: eliminations,
    FinishOrder: finishOrder,
    EliminationResults: eliminationResults,
  };
}
