// Scoring rules on top of the live feed (see liveScoring.ts). Each describe block is one
// scoring situation; feed states come from the race-status-mock builder.

import { describe, expect, it } from "vitest";
import type { Athlete, Race, RaceActivity, RaceResult } from "@raceoffice/domain";
import { buildRace, competitor, startField } from "@raceoffice/race-status-mock";
import {
  buildFinishResultsFromLive,
  buildStartersForBibs,
  deriveLiveScoring,
  dnfLapForDeficit,
  extractNationFromLastName,
  suggestDnfGroup,
  suggestDnsBibs,
} from "./liveScoring";

function starter(bib: number): Athlete {
  return { id: `a-${bib}`, bib, firstName: "F", lastName: `L${bib}`, ageGroupId: null, nation: null };
}

function result(bib: number, overrides: Partial<RaceResult> = {}): RaceResult {
  return {
    bib, rank: 0, points: 0, dnf: false, dnfLap: 0, dns: false, dsq: false,
    lapsCompleted: 0, finishTime: "", finishRank: 0, ...overrides,
  };
}

function makeRace(bibs: number[], overrides: Partial<Race> = {}): Race {
  return {
    id: "race-1",
    name: "Senior Ladies Elimination",
    slug: "senior_ladies_elimination",
    racemode: { isPointsRace: false, isEliminationRace: true },
    stage: "final",
    stage_value: "A",
    distance_value: "10000",
    ageGroupId: "ag-1",
    eventId: "event-1",
    raceStarters: bibs.map(starter),
    raceResults: [],
    raceActivities: [],
    ...overrides,
  };
}

describe("no active race in the feed", () => {
  it("gives no live hints and does not flag starters as missing", () => {
    const live = deriveLiveScoring(makeRace([1, 2]), null);

    expect(live.liveBibs.size).toBe(0);
    expect(live.missingInLiveBibs.size).toBe(0);
    expect(live.liveLapCount).toBeNull();
    expect(live.liveTopBibs).toEqual({ p1Bib: null, p2Bib: null, p3Bib: null });
  });
});

describe("before the start (everybody at lap 0)", () => {
  it("offers all non-blocked riders as zero-lap (DNS) candidates and nobody as lapped", () => {
    const race = makeRace([3, 1, 2], { raceResults: [result(2, { dsq: true })] });
    const live = deriveLiveScoring(race, buildRace({ lapsComplete: 0, competitors: startField([3, 1, 2]) }));

    expect(live.liveZeroLapBibs).toEqual([1, 3]);
    expect(live.lappedIndicationByBib.size).toBe(0);
  });
});

describe("points race", () => {
  it("takes P1-P3 from live positions, regardless of feed order", () => {
    const feed = buildRace({
      lapsComplete: 12,
      lapsToGo: 8,
      competitors: [
        competitor(30, { position: 3, laps: 12 }),
        competitor(10, { position: 1, laps: 12 }),
        competitor(40, { position: 4, laps: 12 }),
        competitor(20, { position: 2, laps: 12 }),
      ],
    });
    const live = deriveLiveScoring(makeRace([10, 20, 30, 40]), feed);

    expect(live.liveTopBibs).toEqual({ p1Bib: 10, p2Bib: 20, p3Bib: 30 });
    expect(live.liveLapCount).toBe(12);
    expect(live.liveLapsToGo).toBe(8);
  });

  it("builds standings from recorded sprints: ties share a place, deleted sprints are ignored", () => {
    const sprint = (id: string, results: Array<{ bib: number; points: number }>, isDeleted = false) =>
      ({ id, createdAt: "", type: "pointsSprint", data: { lap: 1, isDeleted, results, history: [] } }) as unknown as RaceActivity;

    const race = makeRace([1, 2, 3], {
      raceActivities: [
        sprint("s1", [{ bib: 1, points: 2 }, { bib: 2, points: 1 }]),
        sprint("s2", [{ bib: 2, points: 1 }]),
        sprint("s3", [{ bib: 3, points: 5 }], true),
      ],
    });

    expect(deriveLiveScoring(race, null).standings).toEqual([
      { bib: 1, points: 2, place: 1 },
      { bib: 2, points: 2, place: 1 },
      { bib: 3, points: 0, place: 3 },
    ]);
  });
});

describe("elimination race", () => {
  it("suggests the last two riders still racing, skipping riders already taken out", () => {
    const race = makeRace([1, 2, 3, 4, 5], {
      raceResults: [result(5, { dnf: "elimination", dnfLap: 3 }), result(4, { dns: true })],
    });
    const live = deriveLiveScoring(race, buildRace({ lapsComplete: 6, competitors: startField([1, 2, 3, 4, 5], { laps: 6 }) }));

    expect(live.blockedBibs).toEqual(new Set([4, 5]));
    expect(live.liveLastEligibleBibs).toEqual({ lastBib: 3, secondLastBib: 2 });
  });
});

describe("lapped riders", () => {
  // Leader by laps is bib 2 (10 laps) although bib 9 is at live position 1 with 8 laps.
  const feed = buildRace({
    lapsComplete: 10,
    competitors: [
      competitor(9, { position: 1, laps: 8 }),
      competitor(2, { position: 2, laps: 10 }),
      competitor(3, { position: 3, laps: 9 }),
      competitor(4, { position: 4, laps: 9 }),
      competitor(5, { position: 5, laps: 7 }),
      competitor(6, { position: 6, laps: 12 }), // already eliminated: must not count as leader
    ],
  });
  const race = makeRace([2, 3, 4, 5, 6, 9], { raceResults: [result(6, { dnf: "elimination", dnfLap: 4 })] });
  const live = deriveLiveScoring(race, feed);

  it("measures the gap against the rider with the most laps, not live position 1", () => {
    expect(live.lappedIndicationByBib).toEqual(new Map([[9, 2], [3, 1], [4, 1], [5, 3]]));
  });

  it("highlights riders two or more laps down", () => {
    expect(live.lappedIndicationBibs).toEqual(new Set([9, 5]));
  });

  it("ignores riders already taken out", () => {
    expect(live.lappedIndicationByBib.has(6)).toBe(false);
  });
});

describe("DNF proposal (elimination race, sync on)", () => {
  // Lap deficits as derived from the feed: 5 is three laps down, 9 two, 3 and 4 one.
  const deficits = new Map([[9, 2], [3, 1], [4, 1], [5, 3], [8, 3]]);

  it("proposes the riders furthest behind, all sharing one deficit", () => {
    expect(suggestDnfGroup(deficits)).toEqual({ bibs: [5, 8], deficit: 3 });
  });

  it("moves on to the next group once riders are excluded (recorded as DNF / taken out)", () => {
    expect(suggestDnfGroup(deficits, new Set([5, 8]))).toEqual({ bibs: [9], deficit: 2 });
    expect(suggestDnfGroup(deficits, new Set([5]))).toEqual({ bibs: [8], deficit: 3 });
  });

  it("proposes nobody when nobody is lapped", () => {
    expect(suggestDnfGroup(new Map())).toEqual({ bibs: [], deficit: null });
  });

  it("works on the lap deficits derived from the feed", () => {
    const feed = buildRace({
      lapsComplete: 10,
      competitors: [
        competitor(1, { position: 1, laps: 10 }),
        competitor(2, { position: 2, laps: 9 }),
        competitor(3, { position: 3, laps: 8 }),
      ],
    });
    const live = deriveLiveScoring(makeRace([1, 2, 3]), feed);
    expect(suggestDnfGroup(live.lappedIndicationByBib)).toEqual({ bibs: [3], deficit: 2 });
  });

  it("sets the DNF lap to the riders' own lap: race lap minus deficit, at least 1", () => {
    expect(dnfLapForDeficit(10, 2)).toBe(8);
    expect(dnfLapForDeficit(10.7, 1)).toBe(9);
    expect(dnfLapForDeficit(2, 3)).toBe(1);
  });
});

describe("DNS proposal (elimination race, sync on)", () => {
  it("proposes riders without a completed lap from live lap 2 on", () => {
    expect(suggestDnsBibs([145, 123, 146], 2)).toEqual([123, 145, 146]);
    expect(suggestDnsBibs([145, 123, 146], 6.4)).toEqual([123, 145, 146]);
  });

  it("proposes nobody before lap 2, when riders just behind the leader may not have crossed the line yet", () => {
    expect(suggestDnsBibs([145, 123], null)).toEqual([]);
    expect(suggestDnsBibs([145, 123], 0)).toEqual([]);
    expect(suggestDnsBibs([145, 123], 1)).toEqual([]);
  });

  it("skips riders already taken out or just recorded", () => {
    expect(suggestDnsBibs([145, 123, 146], 3, new Set([145]))).toEqual([123, 146]);
  });

  it("works on the zero-lap riders derived from the feed", () => {
    const feed = buildRace({
      lapsComplete: 6,
      competitors: [
        competitor(148, { position: 1, laps: 6 }),
        competitor(151, { position: 2, laps: 3 }),
        competitor(145, { position: 3, laps: 0 }),
        competitor(123, { position: 4, laps: 0 }),
      ],
    });
    const live = deriveLiveScoring(makeRace([148, 151, 145, 123]), feed);
    expect(suggestDnsBibs(live.liveZeroLapBibs, live.liveLapCount)).toEqual([123, 145]);
  });
});

describe("feed and starter list disagree", () => {
  it("reports riders unknown to the race and starters missing in the feed", () => {
    const live = deriveLiveScoring(makeRace([1, 2, 3]), buildRace({ competitors: startField([1, 3, 77]) }));

    expect(live.unknownLiveBibs).toEqual(new Set([77]));
    expect(live.missingInLiveBibs).toEqual(new Set([2]));
  });

  it("creates starters from the feed for unknown riders, with nation split off", () => {
    const feed = buildRace({
      competitors: [
        competitor(77, { firstName: "Isabella", lastName: "Rojas Gil (COL)" }),
        competitor(1, { firstName: "Known", lastName: "Starter" }),
      ],
    });
    let n = 0;
    const athletes = buildStartersForBibs(makeRace([1]), feed, [77, 1, 88, 77], () => `id-${++n}`);

    expect(athletes).toEqual([
      { id: "id-1", bib: 77, firstName: "Isabella", lastName: "Rojas Gil", nation: "COL", ageGroupId: "ag-1" },
      { id: "id-2", bib: 88, firstName: "", lastName: "", nation: null, ageGroupId: "ag-1" },
    ]);
  });

  it("only splits a trailing three-letter nation code", () => {
    expect(extractNationFromLastName("Muster (GER)")).toEqual({ lastName: "Muster", nation: "GER" });
    expect(extractNationFromLastName("Muster (Team A)")).toEqual({ lastName: "Muster (Team A)", nation: null });
  });
});

describe("finish: fill results from the feed", () => {
  it("takes the live order, ranks only riders with laps, copies times only at full race distance", () => {
    const feed = buildRace({
      flag: "FINISH",
      lapsComplete: 20,
      competitors: [
        competitor(3, { position: 2, laps: 20, totalTime: "15:01.200" }),
        competitor(1, { position: 1, laps: 20, totalTime: "15:00.100" }),
        competitor(4, { position: 3, laps: 19, totalTime: "15:02.000" }),
        competitor(5, { position: 4, laps: 0 }),
        competitor(1, { position: 5, laps: 20 }), // duplicate bib: first occurrence wins
        competitor("x", { position: 6, laps: 20 }), // invalid bib: skipped
      ],
    });

    const results = buildFinishResultsFromLive(feed);
    expect(results.map((r) => [r.bib, r.finishRank, r.lapsCompleted, r.finishTime])).toEqual([
      [1, 1, 20, "15:00.100"],
      [3, 2, 20, "15:01.200"],
      [4, 3, 19, ""],
      [5, 0, 0, ""],
    ]);
  });

  it("returns nothing without an active race", () => {
    expect(buildFinishResultsFromLive(null)).toEqual([]);
  });
});
