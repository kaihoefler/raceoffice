/**
 * raceResults.test
 * ----------------
 * Focused domain tests for the first migrated shared standings logic.
 *
 * Goal of these tests:
 * - lock down ordering behavior (`sortRaceResultsForStandings`)
 * - lock down rank computation behavior (`recomputeRaceResults`)
 * - lock down activity-materialization behavior (`applyActivitiesToRaceResults`)
 * - document the special tie rule for same DNF lap
 */

import { describe, expect, it } from "vitest";

import {
  applyActivitiesToRaceResults,
  recomputeRaceResults,
  sortRaceResultsForStandings,
  type RaceResult,
} from "./raceResults";

/**
 * Small helper to keep fixtures compact and readable.
 *
 * Every omitted field gets a neutral default, so tests can focus only on the
 * fields relevant to a given scenario.
 */
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

describe("raceResults domain", () => {
  it("sorts by status bucket, dnf lap, points, then finish rank", () => {
    const sorted = sortRaceResultsForStandings([
      raceResult({ bib: 41, dns: true }),
      raceResult({ bib: 31, dsq: true }),
      raceResult({ bib: 21, dnf: "elimination", dnfLap: 8, points: 3 }),
      raceResult({ bib: 22, dnf: "elimination", dnfLap: 12, points: 1 }),
      raceResult({ bib: 12, points: 2, finishRank: 2 }),
      raceResult({ bib: 11, points: 3, finishRank: 4 }),
      raceResult({ bib: 13, points: 3, finishRank: 1 }),
    ]);

    // Expected order reflects current domain sorting rules:
    // normal riders -> elimination/DNF -> DSQ -> DNS,
    // then by lap/points/finish rank.
    expect(sorted.map((r) => r.bib)).toEqual([13, 11, 12, 22, 21, 31, 41]);
  });

  it("derives points and status from activities while preserving manual fields", () => {
    const materialized = applyActivitiesToRaceResults({
      prevResults: [
        raceResult({ bib: 11, finishRank: 3, finishTime: "00:10.000", lapsCompleted: 15 }),
        raceResult({ bib: 12, finishRank: 1, finishTime: "00:09.500", lapsCompleted: 15 }),
        raceResult({ bib: 13 }),
      ],
      starters: [{ bib: 11 }, { bib: 12 }, { bib: 13 }, { bib: 14 }],
      activities: [
        {
          type: "pointsSprint",
          data: {
            lap: 5,
            isDeleted: false,
            results: [
              { bib: 11, points: 3 },
              { bib: 13, points: 2 },
            ],
            history: [],
          },
        },
        {
          type: "DNF",
          data: {
            lap: 9,
            dnfType: "elimination",
            isDeleted: false,
            results: [{ bib: 13 }],
            history: [],
          },
        },
        {
          type: "DSQ",
          data: { bib: 12, isDeleted: false, history: [] },
        },
      ],
    });

    expect(materialized).toEqual([
      raceResult({ bib: 11, points: 3, finishRank: 3, finishTime: "00:10.000", lapsCompleted: 15 }),
      raceResult({ bib: 12, dsq: true, finishRank: 1, finishTime: "00:09.500", lapsCompleted: 15 }),
      raceResult({ bib: 13, points: 0, dnf: "elimination", dnfLap: 9 }),
      raceResult({ bib: 14 }),
    ]);
  });

  it("assigns tied rank for same dnf lap", () => {
    const recomputed = recomputeRaceResults([
      raceResult({ bib: 100, points: 5, finishRank: 1 }),
      raceResult({ bib: 200, points: 2, finishRank: 2 }),
      raceResult({ bib: 601, dnf: "dnf", dnfLap: 20, points: 9, finishRank: 11 }),
      raceResult({ bib: 602, dnf: "dnf", dnfLap: 20, points: 0, finishRank: 12 }),
      raceResult({ bib: 603, dnf: "dnf", dnfLap: 19, points: 0, finishRank: 0 }),
    ]);

    // Riders 601 and 602 share rank 3 because they are DNF in the same lap.
    // Next rider gets rank 5 (competition ranking: 1,2,3,3,5).
    expect(recomputed.map((r) => ({ bib: r.bib, rank: r.rank }))).toEqual([
      { bib: 100, rank: 1 },
      { bib: 200, rank: 2 },
      { bib: 601, rank: 3 },
      { bib: 602, rank: 3 },
      { bib: 603, rank: 5 },
    ]);
  });
});
