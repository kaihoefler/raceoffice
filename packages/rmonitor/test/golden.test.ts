/**
 * Golden tests: the TypeScript port must publish exactly what the Java app RMonitorLeaderboard
 * publishes, at the same recording line.
 *
 * Reference data: test/fixtures/golden/*.golden.json, generated with
 * `npm run golden:generate --workspace=@raceoffice/rmonitor` (Java app in Docker, fed line by
 * line by FakeOrbitsFeeder). Here the same recording runs through RaceStateStore without timing.
 *
 * Compared after normalization: competitor order (Java HashMap order) and race order.
 * Every other field must be identical.
 *
 * Two sets of fixtures:
 * - golden/ + recordings/: committed, run everywhere (CI)
 * - golden-local/ + recordings-local/: full competition days, git-ignored (size, personal data);
 *   generated with `npm run golden:generate:local` and only run where present
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine, parseRecordingBytes, RaceStateStore, toRaceTO } from "../src/index.js";
import { normalizeRaces, normalizeRaceTO, selectCheckpoints, type GoldenFile } from "../src/testing/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

const SETS = [
  { name: "committed", golden: "golden", recordings: "recordings" },
  { name: "local full days", golden: "golden-local", recordings: "recordings-local" },
].map((set) => {
  const dir = join(FIXTURES, set.golden);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".golden.json")).sort() : [];
  return { ...set, dir, files };
});

describe.each(SETS)("golden ($name): TS port vs. Java reference", ({ dir, recordings, files }) => {
  if (files.length === 0) {
    it.skip(`no golden files in ${dir}`, () => {});
    return;
  }
  it.each(files)("%s", { timeout: 120_000 }, (file) => {
    const golden = JSON.parse(readFileSync(join(dir, file), "utf8")) as GoldenFile;
    const decoder = new TextDecoder(golden.encoding);
    const messages = parseRecordingBytes(readFileSync(join(FIXTURES, recordings, golden.recording))).map((e) =>
      decoder.decode(e.raw),
    );
    expect(messages.length).toBe(golden.lineCount);
    // The generator and this test must agree on the checkpoints.
    expect(golden.checkpoints.map((c) => c.afterLines)).toEqual(selectCheckpoints(messages));

    // Java keeps every race and ignores $COR; both deviations must not affect the comparison.
    const store = new RaceStateStore({ maxRaces: Number.POSITIVE_INFINITY, corrections: "ignore" });
    let applied = 0;
    for (const checkpoint of golden.checkpoints) {
      while (applied < checkpoint.afterLines) store.apply(parseLine(messages[applied++] as string));

      const where = `${golden.recording} after line ${checkpoint.afterLines}: ${checkpoint.lastLine}`;
      expect(normalizeRaceTO(toRaceTO(store.displayRace)), where).toEqual(normalizeRaceTO(checkpoint.current));
      if (checkpoint.races) {
        expect(normalizeRaces(store.all.map(toRaceTO)), `${where} (all races)`).toEqual(
          normalizeRaces(checkpoint.races),
        );
      }
    }
  });
});

describe("selectCheckpoints", () => {
  it("picks race changes, flag changes, intervals and the end", () => {
    const lines = [
      '$F,0,"00:00:00","12:00:00","00:00:00","      "',
      '$B,1,"R"',
      '$F,0,"00:00:00","12:00:01","00:00:00","      "',
      '$F,0,"00:00:00","12:00:02","00:00:01","Green "',
      '$G,1,"1",1,"00:00:10"',
      '$F,0,"00:00:00","12:00:03","00:00:02","Green "',
      '$I,"12:00:04","1 jan 20"',
    ];
    expect(selectCheckpoints(lines, { interval: 5 })).toEqual([2, 4, 5, 7]);
  });
});
