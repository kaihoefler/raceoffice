import { describe, expect, it } from "vitest";
import type { Race } from "@raceoffice/domain";
import {
  buildCurrentRaceResultPayload,
  resolveCurrentRaceContext,
  toServiceRaceType,
} from "../src/services/currentRaceResultService";

function makeRace(overrides?: Partial<Race>): Race {
  return {
    id: "race-1",
    name: "Senior Men 10000 Points-Final A",
    slug: "senior_men_10000_points_final_a",
    racemode: { isPointsRace: true, isEliminationRace: false },
    stage: "final",
    stage_value: "A",
    distance_value: "10000",
    ageGroupId: "ag-1",
    eventId: "event-1",
    raceResults: [],
    raceStarters: [],
    raceActivities: [],
    ...overrides,
  };
}

describe("currentRaceResultService", () => {
  it("maps race mode to service type", () => {
    expect(toServiceRaceType(makeRace({ racemode: { isPointsRace: true, isEliminationRace: false } }))).toBe("Points");
    expect(toServiceRaceType(makeRace({ racemode: { isPointsRace: false, isEliminationRace: true } }))).toBe("Elimination");
    expect(toServiceRaceType(makeRace({ racemode: { isPointsRace: true, isEliminationRace: true } }))).toBe("PointsElimination");
  });

  it("builds legacy payload with standings-sorted PointResults, eliminations and finish order", () => {
    const race = makeRace({
      racemode: { isPointsRace: true, isEliminationRace: true },
      raceResults: [
        { bib: 102, rank: 2, points: 6, dnf: false, dnfLap: 0, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 2 },
        { bib: 101, rank: 1, points: 2, dnf: false, dnfLap: 0, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 1 },
        { bib: 103, rank: 3, points: 0, dnf: "elimination", dnfLap: 3, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 0 },
      ],
      raceStarters: [
        { id: "a-101", bib: 101, firstName: "Bart", lastName: "Swings", ageGroupId: null, nation: null },
        { id: "a-102", bib: 102, firstName: "Jason", lastName: "Suttels", ageGroupId: null, nation: null },
        { id: "a-103", bib: 103, firstName: "Livio", lastName: "Wenger", ageGroupId: null, nation: null },
      ],
      raceActivities: [
        {
          id: "ps-1",
          createdAt: "2026-01-01T10:00:00.000Z",
          type: "pointsSprint",
          data: {
            lap: 1,
            isDeleted: false,
            results: [
              { bib: 101, points: 2 },
              { bib: 102, points: 1 },
            ],
            history: [],
          },
        },
        {
          id: "dnf-1",
          createdAt: "2026-01-01T10:01:00.000Z",
          type: "DNF",
          data: {
            lap: 3,
            dnfType: "elimination",
            isDeleted: false,
            results: [{ bib: 103 }],
            history: [],
          },
        },
      ],
    });

    const payload = buildCurrentRaceResultPayload(race);

    expect(payload.Race).toEqual({
      Name: "Senior Men 10000 Points-Final A",
      Type: "PointsElimination",
      ID: "race-1",
    });

    expect(payload.PointResults).toEqual([
      {
        Place: 1,
        Startnumber: 102,
        FirstName: "Jason",
        LastName: "Suttels",
        FinishOrder: 2,
        Eliminated: 0,
        Points: 6,
      },
      {
        Place: 2,
        Startnumber: 101,
        FirstName: "Bart",
        LastName: "Swings",
        FinishOrder: 1,
        Eliminated: 0,
        Points: 2,
      },
      {
        Place: 3,
        Startnumber: 103,
        FirstName: "Livio",
        LastName: "Wenger",
        FinishOrder: 999,
        Eliminated: 1,
        Points: 0,
      },
    ]);

    expect(payload.PointsLapList).toEqual({
      "1": {
        "101": 2,
        "102": 1,
      },
    });

    expect(payload.Eliminations).toEqual([
      {
        Startnumber: 103,
        FirstName: "Livio",
        LastName: "Wenger",
        EliminationNr: 1,
      },
    ]);

    expect(payload.FinishOrder).toEqual([
      {
        Startnumber: 101,
        FirstName: "Bart",
        LastName: "Swings",
        FinishOrder: 1,
      },
      {
        Startnumber: 102,
        FirstName: "Jason",
        LastName: "Suttels",
        FinishOrder: 2,
      },
    ]);

    expect(payload.EliminationResults).toEqual([
      {
        Place: 1,
        Startnumber: 102,
        FirstName: "Jason",
        LastName: "Suttels",
        FinishOrder: 2,
        Eliminated: 0,
      },
      {
        Place: 2,
        Startnumber: 101,
        FirstName: "Bart",
        LastName: "Swings",
        FinishOrder: 1,
        Eliminated: 0,
      },
      {
        Place: 3,
        Startnumber: 103,
        FirstName: "Livio",
        LastName: "Wenger",
        FinishOrder: 999,
        Eliminated: 1,
      },
    ]);
  });

  it("returns elimination-specific format for pure elimination races (derived from raceResults)", () => {
    const race = makeRace({
      racemode: { isPointsRace: false, isEliminationRace: true },
      raceResults: [
        { bib: 201, rank: 0, points: 0, dnf: "elimination", dnfLap: 2, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 0 },
        { bib: 202, rank: 0, points: 0, dnf: "elimination", dnfLap: 1, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 0 },
      ],
      raceStarters: [
        { id: "a-201", bib: 201, firstName: "Anna", lastName: "A", ageGroupId: null, nation: "GER" },
        { id: "a-202", bib: 202, firstName: "Berta", lastName: "B", ageGroupId: null, nation: "ITA" },
      ],
      raceActivities: [],
    });

    const payload = buildCurrentRaceResultPayload(race);

    expect(payload.PointResults).toEqual([]);
    expect(payload.PointsLapList).toEqual([]);
    expect(payload.FinishOrder).toEqual([]);
    expect(payload.EliminationResults).toEqual([]);

    expect(payload.Eliminations).toEqual([
      { Startnumber: 201, FirstName: "Anna", LastName: "A (GER)", EliminationNr: 2 },
      { Startnumber: 202, FirstName: "Berta", LastName: "B (ITA)", EliminationNr: 1 },
    ]);
  });

  it("uses domain-computed rank for EliminationResults places (including ties)", () => {
    const race = makeRace({
      racemode: { isPointsRace: true, isEliminationRace: true },
      raceResults: [
        { bib: 11, rank: 0, points: 5, dnf: false, dnfLap: 0, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 1 },
        { bib: 12, rank: 0, points: 5, dnf: false, dnfLap: 0, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 1 },
        { bib: 13, rank: 0, points: 0, dnf: "elimination", dnfLap: 2, dns: false, dsq: false, lapsCompleted: 0, finishTime: "", finishRank: 0 },
      ],
      raceStarters: [
        { id: "a-11", bib: 11, firstName: "A", lastName: "One", ageGroupId: null, nation: null },
        { id: "a-12", bib: 12, firstName: "B", lastName: "Two", ageGroupId: null, nation: null },
        { id: "a-13", bib: 13, firstName: "C", lastName: "Three", ageGroupId: null, nation: null },
      ],
      raceActivities: [
        {
          id: "dnf-1",
          createdAt: "2026-01-01T10:01:00.000Z",
          type: "DNF",
          data: { lap: 2, dnfType: "elimination", isDeleted: false, results: [{ bib: 13 }], history: [] },
        },
      ],
    });

    const payload = buildCurrentRaceResultPayload(race);

    expect(payload.EliminationResults.map((row) => row.Place)).toEqual([1, 1, 3]);
  });

  it("resolves current race context from eventList and active event docs", () => {
    const docs = new Map<string, { data: unknown }>([
      ["eventList", { data: { activeEventId: "event-1", events: [] } }],
      [
        "Event-event-1",
        {
          data: {
            id: "event-1",
            slug: "event-1",
            name: "Event 1",
            activeRaceId: "race-1",
            races: [makeRace()],
            athletes: [],
            ageGroups: [],
          },
        },
      ],
    ]);

    const ctx = resolveCurrentRaceContext((id) => docs.get(id) ?? { data: {} });

    expect(ctx?.eventId).toBe("event-1");
    expect(ctx?.race.id).toBe("race-1");
  });
});
