import { describe, expect, it } from "vitest";
import { PassingSequenceTracker, toRanges } from "./passingSequenceTracker.js";

describe("PassingSequenceTracker", () => {
  it("requests a live gap and counts what comes back", () => {
    const t = new PassingSequenceTracker();
    expect(t.onPassing(41, 0)).toEqual([]);
    expect(t.onPassing(44, 0)).toEqual([{ from: 42, to: 43 }]);
    expect(t.snapshot).toEqual({ requested: 2, recovered: 0, open: 2 });
    // Resent passings arrive (lower numbers): recovered, nothing new requested.
    expect(t.onPassing(42, 100)).toEqual([]);
    expect(t.onPassing(43, 100)).toEqual([]);
    expect(t.snapshot).toEqual({ requested: 2, recovered: 2, open: 0 });
    expect(t.onPassing(45, 100)).toEqual([]);
  });

  it("retries after the timeout and gives up after the maximum attempts", () => {
    const t = new PassingSequenceTracker({ retryMs: 1000, maxAttempts: 2 });
    t.onPassing(1, 0);
    t.onPassing(4, 0);
    expect(t.due(500)).toEqual([]);
    expect(t.due(1000)).toEqual([{ from: 2, to: 3 }]);
    expect(t.due(2000)).toEqual([]); // second attempt was the last one
    expect(t.snapshot).toEqual({ requested: 2, recovered: 0, open: 2 });
    t.onPassing(3, 2500); // late arrival still counts
    expect(t.snapshot).toEqual({ requested: 2, recovered: 1, open: 1 });
  });

  it("catches up after reconnecting from the highest stored number", () => {
    const t = new PassingSequenceTracker();
    t.resumeFrom(100);
    expect(t.onSession(105, 0)).toEqual([{ from: 101, to: 105 }]);
  });

  it("does not pull the decoder memory on first contact, caps the catch-up and detects resets", () => {
    const fresh = new PassingSequenceTracker();
    expect(fresh.onSession(5000, 0)).toEqual([]);
    expect(fresh.onPassing(5001, 0)).toEqual([]);

    const capped = new PassingSequenceTracker({ maxCatchUp: 10 });
    capped.resumeFrom(100);
    expect(capped.onSession(500, 0)).toEqual([{ from: 491, to: 500 }]);

    const reset = new PassingSequenceTracker();
    reset.resumeFrom(800);
    expect(reset.onSession(12, 0)).toEqual([]);
    expect(reset.onPassing(13, 0)).toEqual([]);
  });

  it("ignores implausible jumps (foreign numbering)", () => {
    const t = new PassingSequenceTracker({ maxGap: 100 });
    t.onPassing(10, 0);
    expect(t.onPassing(5000, 0)).toEqual([]);
    expect(t.onPassing(5002, 0)).toEqual([{ from: 5001, to: 5001 }]);
  });

  it("merges numbers into ranges", () => {
    expect(toRanges([7, 3, 4, 5, 9])).toEqual([
      { from: 3, to: 5 },
      { from: 7, to: 7 },
      { from: 9, to: 9 },
    ]);
  });
});
