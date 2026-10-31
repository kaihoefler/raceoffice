/**
 * RecordingPlayer: gap skipping. Pauses > 10 s play as 1 s; position, duration and seek refer to
 * the shortened timeline, and switching while playing continues at the same recorded line.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingPlayer } from "../src/sources/playerSource.js";

// Heartbeats at 0..2 s, a 1-hour pause, heartbeats again, a 5 s pause (kept), one more line.
const LINES: Array<[number, string]> = [
  [0, "$F,0,a"],
  [1000, "$F,0,b"],
  [2000, "$F,0,c"],
  [3_602_000, "$F,0,d"],
  [3_603_000, "$F,0,e"],
  [3_608_000, "$F,0,f"],
];

let file: string;
let played: string[];

function player(skipGaps?: boolean) {
  const p = new RecordingPlayer({ onLine: (_raw, text) => played.push(text), onReset: () => (played = []) });
  return { p, load: () => p.load(file, "auto", skipGaps === undefined ? {} : { skipGaps }) };
}

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "lb-player-"));
  file = join(dir, "gaps.txt");
  await writeFile(file, LINES.map(([ms, line]) => `${ms} ${line}\n`).join(""));
  played = [];
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => vi.useRealTimers());

describe("gap skipping", () => {
  it("is on by default and plays a long pause as one second", async () => {
    const { p, load } = player();
    await load();
    expect(p.status().durationMs).toBe(2000 + 1000 + 1000 + 5000);
    p.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(played).toEqual(["$F,0,a", "$F,0,b", "$F,0,c"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(played.at(-1)).toBe("$F,0,d");
    expect(p.status().positionMs).toBe(3000);
    // Pauses up to 10 s stay as they are.
    await vi.advanceTimersByTimeAsync(1000 + 4999);
    expect(played.at(-1)).toBe("$F,0,e");
    await vi.advanceTimersByTimeAsync(1);
    expect(played.at(-1)).toBe("$F,0,f");
  });

  it("keeps the recorded timing when switched off", async () => {
    const { p, load } = player(false);
    await load();
    expect(p.status()).toMatchObject({ skipGaps: false, durationMs: 3_608_000 });
    p.start({ speedup: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(played).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(601);
    expect(played).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(played.at(-1)).toBe("$F,0,d");
  });

  it("seeks on the shortened timeline", async () => {
    const { p, load } = player(true);
    await load();
    p.seek(3500);
    expect(played.at(-1)).toBe("$F,0,d");
    expect(p.status()).toMatchObject({ state: "paused", positionMs: 3500 });
  });

  it("switching while playing continues at the same point of the recording", async () => {
    const { p, load } = player(false);
    await load();
    p.start();
    await vi.advanceTimersByTimeAsync(10_000); // 8 s into the 1-hour pause
    expect(played).toHaveLength(3);

    p.setSkipGaps(true);
    // Already past the 1 s replacement: the next line is due immediately, nothing is replayed twice.
    expect(p.status().positionMs).toBe(3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(played).toEqual(["$F,0,a", "$F,0,b", "$F,0,c", "$F,0,d"]);

    p.setSkipGaps(false);
    expect(p.status().positionMs).toBe(3_602_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(played.at(-1)).toBe("$F,0,e");
  });
});
