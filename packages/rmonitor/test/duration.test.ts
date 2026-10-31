import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, parseJavaFloat, parseJavaInt } from "../src/index.js";

describe("parseDuration (LocalTime.parse)", () => {
  it.each([
    ["00:00:00", 0],
    ["00:00:19.701", 19_701],
    ["01:42:17.672", 6_137_672],
    ["13:34", 48_840_000],
    ["00:01:47.3105", 107_310.5],
    ["23:59:59.999999999", 86_399_999.999999],
  ])("%s → %d ms", (text, ms) => {
    expect(parseDuration(text)).toBeCloseTo(ms, 6);
  });

  it.each(["", "0:00:01", "24:00:00", "00:60:00", "00:00:60", "00:00:00.", "00:00:00.1234567890", " 00:00:00"])(
    "rejects %j",
    (text) => {
      expect(() => parseDuration(text)).toThrow();
    },
  );
});

describe("formatDuration (DurationUtil.format)", () => {
  it.each([
    [0, "0:00"],
    [15_000, "0:15"],
    [15_032, "0:15.032"],
    [3_723_004, "1:02:03.004"],
    [36_000_000, "10:00:00"],
    [107_310.5, "1:47.310"],
    [48_840_000, "13:34:00"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("Java number parsing", () => {
  it("parseJavaInt follows Integer.parseInt", () => {
    expect(parseJavaInt("9999")).toBe(9999);
    expect(parseJavaInt("+5")).toBe(5);
    expect(parseJavaInt("-1")).toBe(-1);
    expect(() => parseJavaInt("")).toThrow();
    expect(() => parseJavaInt(" 5")).toThrow();
    expect(() => parseJavaInt("2147483648")).toThrow();
  });

  it("parseJavaFloat follows Float.parseFloat for decimals", () => {
    expect(parseJavaFloat("0.200")).toBe(0.2);
    expect(parseJavaFloat(" 2.5 ")).toBe(2.5);
    expect(parseJavaFloat("1f")).toBe(1);
    expect(() => parseJavaFloat("")).toThrow();
    expect(() => parseJavaFloat("0,2")).toThrow();
  });
});
