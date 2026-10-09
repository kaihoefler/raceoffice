import { describe, expect, it } from "vitest";
import { formatDeltaSeconds, parseTimeToSeconds } from "./liveTime";

describe("parseTimeToSeconds", () => {
  it.each([
    ["15.032", 15.032],
    ["0:15.032", 15.032],
    ["0:15,032", 15.032],
    ["2:05", 125],
    ["1:02:03.5", 3723.5],
  ])("parses %s", (input, seconds) => {
    expect(parseTimeToSeconds(input)).toBeCloseTo(seconds, 6);
  });

  it.each(["", "  ", "abc", "1:2:3:4", "x:10"])("returns null for %j", (input) => {
    expect(parseTimeToSeconds(input)).toBeNull();
  });
});

describe("formatDeltaSeconds", () => {
  it("formats gaps to the leader in German notation", () => {
    expect(formatDeltaSeconds(0.032)).toBe("+0,032");
    expect(formatDeltaSeconds(62.5)).toBe("+1:02,500");
    expect(formatDeltaSeconds(-1.25)).toBe("-1,250");
  });

  it("rounds float noise to milliseconds", () => {
    expect(formatDeltaSeconds(0.1 + 0.2)).toBe("+0,300");
  });
});
