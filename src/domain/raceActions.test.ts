import { describe, expect, it } from "vitest";

import type { Athlete } from "../types/athlete";
import type { Race, RaceResult } from "../types/race";
import type { RaceActivity, RaceActivityDNF, RaceActivityDns, RaceActivityPointsSprint } from "../types/raceactivities";

import { removeStarterFromRace, replaceRaceStartersInRace, upsertRaceStartersInRace } from "./raceActions";

function athlete(id: string, bib: number | null): Athlete {
  return {
    id,
    bib,
    firstName: `First ${id}`,
    lastName: `Last ${id}`,
    nation: null,
    ageGroupId: "ag-1",
  };
}

function raceResult(overrides: Partial<RaceResult> & Pick<RaceResult, "bib">): RaceResult {
  return {
    bib: overrides.bib,
    rank: overrides.rank ?? 0,
    points: overrides.points ?? 0,
    dnf: overrides.dnf ?? false,
    dnfLap: overrides.dnfLap ?? 0,
    dns: overrides.dns ?? false,
    dsq: overrides.dsq ?? false,
    lapsCompleted: overrides.lapsCompleted ?? 0,
    finishTime: overrides.finishTime ?? "",
    finishRank: overrides.finishRank ?? 0,
  };
}

function pointsSprint(id: string, results: Array<{ bib: number; points: number }>): RaceActivityPointsSprint {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "pointsSprint",
    data: {
      lap: 5,
      isDeleted: false,
      results,
      history: [],
    },
  };
}

function elimination(id: string, lap: number, bibs: number[]): RaceActivityDNF {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DNF",
    data: {
      lap,
      dnfType: "elimination",
      isDeleted: false,
      results: bibs.map((bib) => ({ bib })),
      history: [],
    },
  };
}

function dns(id: string, bib: number): RaceActivityDns {
  return {
    id,
    createdAt: `${id}-createdAt`,
    type: "DNS",
    data: {
      bib,
      isDeleted: false,
      history: [],
    },
  };
}

function raceFixture(): Race {
  const starters = [athlete("a1", 101), athlete("a2", 102), athlete("a3", 103), athlete("a4", 104)];
  const activities: RaceActivity[] = [
    pointsSprint("ps-1", [
      { bib: 101, points: 3 },
      { bib: 102, points: 2 },
    ]),
    elimination("elim-1", 7, [103]),
    elimination("elim-2", 8, [102]),
    dns("dns-1", 104),
  ];

  return {
    id: "race-1",
    eventId: "event-1",
    ageGroupId: "ag-1",
    name: "Race 1",
    slug: "race-1",
    racemode: {
      isPointsRace: true,
      isEliminationRace: true,
    },
    stage: "final",
    stage_value: "A",
    distance_value: "",
    raceStarters: starters,
    raceActivities: activities,
    raceResults: [
      raceResult({ bib: 101, points: 3, finishRank: 1, rank: 1 }),
      raceResult({ bib: 102, points: 2, dnf: "elimination", dnfLap: 8, finishRank: 2, rank: 2 }),
      raceResult({ bib: 103, dnf: "elimination", dnfLap: 7, finishRank: 3, rank: 3 }),
      raceResult({ bib: 104, dns: true, finishRank: 4, rank: 4 }),
      raceResult({ bib: 999, points: 9, finishRank: 99, rank: 5 }),
    ],
  };
}

describe("raceActions", () => {
  describe("replaceRaceStartersInRace", () => {
    it("removes orphaned results and activity references for deleted starters and rematerializes ranks", () => {
      const race = raceFixture();
      const next = replaceRaceStartersInRace(race, [athlete("a1", 101), athlete("a3", 103), athlete("a4", 104)]);

      expect(next.raceStarters.map((a) => a.bib)).toEqual([101, 103, 104]);
      expect(next.raceActivities).toEqual([
        pointsSprint("ps-1", [{ bib: 101, points: 3 }]),
        elimination("elim-1", 7, [103]),
        dns("dns-1", 104),
      ]);
      expect(next.raceResults.map((r) => ({ bib: r.bib, rank: r.rank, points: r.points, dnf: r.dnf, dns: r.dns }))).toEqual([
        { bib: 101, rank: 1, points: 3, dnf: false, dns: false },
        { bib: 103, rank: 2, points: 0, dnf: "elimination", dns: false },
        { bib: 104, rank: 3, points: 0, dnf: false, dns: true },
      ]);
    });
  });

  describe("upsertRaceStartersInRace", () => {
    it("adds new starters and creates default raceResults rows for them", () => {
      const race = raceFixture();
      const next = upsertRaceStartersInRace(race, [athlete("a5", 105)]);

      expect(next.raceStarters.map((a) => a.bib)).toEqual([101, 102, 103, 104, 105]);
      expect(next.raceResults.find((r) => r.bib === 105)).toEqual({
        bib: 105,
        rank: 2,
        points: 0,
        dnf: false,
        dnfLap: 0,
        dns: false,
        dsq: false,
        lapsCompleted: 0,
        finishTime: "",
        finishRank: 0,
      });
    });
  });

  describe("removeStarterFromRace", () => {
    it("removes the starter by athlete id and keeps the race aggregate consistent", () => {
      const race = raceFixture();
      const next = removeStarterFromRace(race, "a2");

      expect(next.raceStarters.some((a) => a.id === "a2")).toBe(false);
      expect(next.raceResults.some((r) => r.bib === 102)).toBe(false);
      expect(next.raceActivities.some((a) => {
        if (a.type === "DNS" || a.type === "DSQ") return a.data.bib === 102;
        return a.data.results.some((row: any) => row.bib === 102);
      })).toBe(false);
    });

    it("returns the unchanged race if the athlete id does not exist", () => {
      const race = raceFixture();
      expect(removeStarterFromRace(race, "missing-id")).toBe(race);
    });
  });
});
