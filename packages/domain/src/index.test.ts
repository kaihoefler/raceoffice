import { describe, expect, it } from "vitest";

import { sumPoints } from "./index";

describe("@raceoffice/domain (step 1)", () => {
  it("sums numeric point values", () => {
    expect(sumPoints([3, 2, 1])).toBe(6);
  });

  it("treats non-finite values as 0", () => {
    expect(sumPoints([5, Number.NaN, Number.POSITIVE_INFINITY, 1])).toBe(6);
  });
});
