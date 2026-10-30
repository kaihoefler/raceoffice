import { describe, expect, it } from "vitest";
import { computeStandings, formatDeltaSeconds, nationOf, parseTimeToSeconds, stripIocSuffix } from "./liveTime.js";
import type { RaceStatusCompetitor } from "./raceStatusFeed.js";

const c = (number: string, position: number, lapsComplete: number, totalTime: string): RaceStatusCompetitor => ({
  number,
  position,
  lapsComplete,
  totalTime,
  firstName: "F",
  lastName: `L${number} (GER)`,
});

describe("liveTime", () => {
  it("parses and formats feed times", () => {
    expect(parseTimeToSeconds("1:02:03.004")).toBeCloseTo(3723.004);
    expect(parseTimeToSeconds("0:15,032")).toBeCloseTo(15.032);
    expect(parseTimeToSeconds("")).toBeNull();
    expect(formatDeltaSeconds(0.032)).toBe("+0,032");
    expect(formatDeltaSeconds(62.5)).toBe("+1:02,500");
  });

  it("splits IOC suffix and nation", () => {
    expect(stripIocSuffix("Rojas Gil (COL)")).toBe("Rojas Gil");
    expect(nationOf({ lastName: "Rojas Gil (COL)" })).toBe("COL");
    expect(nationOf({ lastName: "Muster" })).toBe("");
  });

  it("computes gap and interval like the scoring (laps first, then time), unclassified last", () => {
    const rows = computeStandings({
      competitors: [c("3", 3, 6, "4:20.000"), c("9", 0, 0, "0:00"), c("1", 1, 7, "4:11.532"), c("2", 2, 7, "4:11.564")],
    });
    expect(rows.map((r) => [r.competitor.number, r.gap, r.interval])).toEqual([
      ["1", "4:11.532", ""],
      ["2", "+0,032", "+0,032"],
      ["3", "+1 Lap", "+1 Lap"],
      ["9", "", ""],
    ]);
  });
});
