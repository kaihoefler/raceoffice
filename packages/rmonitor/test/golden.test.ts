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
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLine, parseRecordingBytes, RaceStateStore, toRaceTO } from "../src/index.js";
import { normalizeRaces, normalizeRaceTO, selectCheckpoints, type GoldenFile } from "../src/testing/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const GOLDEN_DIR = join(FIXTURES, "golden");
const goldenFiles = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".golden.json")) : [];

describe.skipIf(goldenFiles.length === 0)("golden: TS port vs. Java reference", () => {
  it.each(goldenFiles)("%s", (file) => {
    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as GoldenFile;
    const decoder = new TextDecoder(golden.encoding);
    const messages = parseRecordingBytes(readFileSync(join(FIXTURES, "recordings", golden.recording))).map((e) =>
      decoder.decode(e.raw),
    );
    expect(messages.length).toBe(golden.lineCount);
    // The generator and this test must agree on the checkpoints.
    expect(golden.checkpoints.map((c) => c.afterLines)).toEqual(selectCheckpoints(messages));

    const store = new RaceStateStore();
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
