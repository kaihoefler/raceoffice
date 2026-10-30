/**
 * `$COR` time corrections (photo finish), an Orbits extension the Java app ignores.
 * The sequence is taken from a real 500 m sprint (AGI 2026, rider 193, 3 laps).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseLine,
  parseRecording,
  parseSignedDuration,
  RaceStateStore,
  toRaceTO,
  type CompetitorState,
} from "../src/index.js";

const SPRINT = [
  '$B,26,"Cadets Ladies 500 m + D Sprint Q1"',
  '$A,"193","193",193,"Rider","Name193 (GER)","GER",1',
  '$G,1,"193",,"00:00:00"',
  '$J,"193","00:00:00.000","00:00:13.776"',
  '$G,1,"193",1,"00:00:13.776"',
  '$J,"193","00:00:15.957","00:00:29.733"',
  '$G,1,"193",2,"00:00:29.733"',
  '$H,1,"193",2,"00:00:15.957"',
  '$J,"193","00:00:16.833","00:00:46.566"',
  '$G,1,"193",3,"00:00:46.566"',
  '$H,1,"193",2,"00:00:15.957"',
];
const COR = '$COR,"193","193",3,"00:00:46.517","-0:00:00.048"';
const G_AFTER = '$G,1,"193",3,"00:00:46.517"';

function run(lines: string[], corrections?: "apply" | "ignore") {
  const store = new RaceStateStore(corrections ? { corrections } : {});
  for (const line of lines) store.apply(parseLine(line));
  return { store, rider: store.current.competitors.get("193") as CompetitorState };
}

describe("$COR", () => {
  it("parses the correction", () => {
    expect(parseLine(COR)).toEqual({
      kind: "correction",
      regNumber: "193",
      number: "193",
      lap: 3,
      correctedTotalTimeMs: 46_517,
      deltaMs: -48,
    });
    expect(parseSignedDuration("+0:00:00.001")).toBe(1);
    expect(parseSignedDuration("-1:02:03.5")).toBe(-3_723_500);
    expect(parseLine('$COR,"1","1",3,"00:00:46.517","0:00:00.048"').kind).toBe("invalid");
  });

  it("corrects total and last lap (finish lap = corrected total − previous total)", () => {
    const { store, rider } = run([...SPRINT, COR, G_AFTER]);
    expect(rider.totalTimeMs).toBe(46_517);
    expect(rider.lastLapMs).toBe(16_784);
    expect(rider.bestLapMs).toBe(15_957);
    expect(rider.corrections).toEqual([{ lap: 3, deltaMs: -48, correctedTotalTimeMs: 46_517 }]);
    // The following $G finds the corrected lap: no duplicate lap 3.
    expect(rider.lapList.filter((l) => l.lapNumber === 3)).toHaveLength(1);
    expect(toRaceTO(store.current).competitors[0]).toMatchObject({ totalTime: "0:46.517", lastLap: "0:16.784" });
  });

  it("ignore mode reproduces the Java result (total via $G, last lap uncorrected)", () => {
    const { rider } = run([...SPRINT, COR, G_AFTER], "ignore");
    expect(rider.totalTimeMs).toBe(46_517);
    expect(rider.lastLapMs).toBe(16_833);
    expect(rider.lapList.filter((l) => l.lapNumber === 3)).toHaveLength(2);
  });

  it("updates the best lap when the corrected lap becomes the fastest", () => {
    const { rider } = run([...SPRINT, '$COR,"193","193",3,"00:00:45.000","-0:00:01.566"']);
    expect(rider.lastLapMs).toBe(15_267);
    expect(rider.bestLapMs).toBe(15_267);
  });

  it("recomputes the best lap when the corrected best lap gets slower", () => {
    const { rider } = run([...SPRINT, '$COR,"193","193",2,"00:00:31.000","+0:00:01.267"']);
    // Lap 2 was the best lap (15.957) → 31.000 − 13.776 = 17.224; best is now lap 3 (16.833).
    expect(rider.lapList.find((l) => l.lapNumber === 2)?.lapTimeMs).toBe(17_224);
    expect(rider.bestLapMs).toBe(16_833);
    // Not the current lap: total and last lap stay.
    expect(rider.totalTimeMs).toBe(46_566);
    expect(rider.lastLapMs).toBe(16_833);
  });

  it("corrects all finishers of a real sprint (excerpt), totals equal to Java, last laps corrected", () => {
    const text = readFileSync(join(import.meta.dirname, "fixtures/recordings/excerpt_sprint-correction.txt"), "latin1");
    const lines = parseRecording(text).map((e) => e.raw);
    const applied = run(lines).store.current;
    const java = run(lines, "ignore").store.current;

    const corrected = [...applied.competitors.values()].filter((c) => c.corrections.length > 0);
    expect(corrected).toHaveLength(5);
    for (const c of corrected) {
      const j = java.competitors.get(c.regNumber) as CompetitorState;
      expect(c.totalTimeMs).toBe(j.totalTimeMs);
      expect(c.lastLapMs).toBeLessThan(j.lastLapMs);
      expect(Math.abs(c.lastLapMs - j.lastLapMs - (c.corrections[0]?.deltaMs ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it("handles a correction for an unknown competitor without crashing", () => {
    const { store } = run(['$B,1,"R"', COR]);
    expect(store.current.competitors.get("193")?.totalTimeMs).toBe(0);
  });
});
