import { describe, expect, it } from "vitest";
import {
  anonymizePayload,
  buildRace,
  compactRecording,
  compactRecordingPerLap,
  competitor,
  findRace,
  parseRecording,
  relevantStateKey,
  serializeFrame,
} from "../src/index";

const lap = (n: number) => [buildRace({ lapsComplete: n, competitors: [competitor(12, { position: 1, laps: n })] })];

describe("recordings", () => {
  it("round-trips frames and finds a recorded state", () => {
    const text = [lap(0), lap(1), lap(2)].map((payload, i) => serializeFrame({ t: i * 1000, payload })).join("\n") + "\n";
    const frames = parseRecording(text);

    expect(frames.map((f) => f.t)).toEqual([0, 1000, 2000]);
    expect(findRace(frames, (r) => r.lapsComplete === 2).lapsComplete).toBe(2);
    expect(() => findRace(frames, (r) => r.lapsComplete === 99)).toThrow(/No recorded race state/);
  });

  describe("relevant state (what the recorder keeps)", () => {
    const base = () => ({
      ...buildRace({
        lapsComplete: 6,
        lapsToGo: 24,
        elapsedTime: "2:17",
        competitors: [
          { ...competitor(148, { position: 1, laps: 6, totalTime: "2:01.914" }), bestLap: "0:19.1", lastLap: "0:20.0", qualiPosition: 3 },
          { ...competitor(143, { position: 2, laps: 6, totalTime: "2:01.991" }), bestLap: "0:19.4", lastLap: "0:20.1", qualiPosition: 1 },
        ],
      }),
      timeOfDay: "14:03:12",
    });
    const key = (race: unknown) => relevantStateKey([race]);

    it("ignores the running clock and fields RaceOffice does not use", () => {
      const ticked = { ...base(), elapsedTime: "2:18", timeOfDay: "14:03:13" };
      ticked.competitors = ticked.competitors.map((c) => ({ ...c, bestLap: "0:18.9", lastLap: "0:19.9", qualiPosition: 9 }));
      expect(key(ticked)).toBe(key(base()));
    });

    it.each([
      ["flag", (r: any) => ({ ...r, flagStatus: "FINISH" })],
      ["race lap counter", (r: any) => ({ ...r, lapsComplete: 7, lapsToGo: 23 })],
      ["rider position", (r: any) => ({ ...r, competitors: [{ ...r.competitors[0], position: 2 }, { ...r.competitors[1], position: 1 }] })],
      ["rider laps", (r: any) => ({ ...r, competitors: [{ ...r.competitors[0], lapsComplete: 7 }, r.competitors[1]] })],
      ["rider total time", (r: any) => ({ ...r, competitors: [{ ...r.competitors[0], totalTime: "2:21.000" }, r.competitors[1]] })],
      ["rider leaving the feed", (r: any) => ({ ...r, competitors: [r.competitors[0]] })],
      ["another race", (r: any) => ({ ...r, raceID: 2, raceName: "Next Race" })],
    ])("detects a change of the %s", (_label, change) => {
      expect(key(change(base()))).not.toBe(key(base()));
    });

    it("compacts a recording to the relevant states", () => {
      const tick = (s: string) => ({ ...base(), elapsedTime: s });
      const frames = [tick("2:17"), tick("2:18"), { ...base(), lapsComplete: 7 }, { ...base(), lapsComplete: 7, elapsedTime: "2:40" }].map(
        (race, i) => ({ t: i * 1000, payload: [race] }),
      );
      expect(compactRecording(frames).map((f) => f.t)).toEqual([0, 2000]);
    });
  });

  describe("one state per lap (--per-lap)", () => {
    // Race lap counter + leader position: each change is a relevant state.
    const state = (t: number, lap: number, leader: number, extra: Partial<Parameters<typeof buildRace>[0]> = {}) => ({
      t,
      payload: [
        buildRace({
          lapsComplete: lap,
          competitors: [competitor(leader, { position: 1, laps: lap }), competitor(leader === 1 ? 2 : 1, { position: 2, laps: lap })],
          ...extra,
        }),
      ],
    });

    it("keeps the last state of each lap (the last position change before the next lap)", () => {
      const frames = [state(0, 0, 1), state(1, 1, 1), state(2, 1, 2), state(3, 2, 2), state(4, 2, 1), state(5, 2, 1), state(6, 3, 1)];
      expect(compactRecordingPerLap(frames).map((f) => f.t)).toEqual([0, 2, 4, 6]);
    });

    it("keeps a lap counter correction as its own states (passing at the start deleted by the timekeepers)", () => {
      const frames = [state(0, 0, 1), state(1, 1, 1), state(2, 0, 1), state(3, 1, 2), state(4, 2, 2)];
      expect(compactRecordingPerLap(frames).map((f) => f.t)).toEqual([0, 1, 2, 3, 4]);
    });

    it("separates races and 'no active race' phases", () => {
      const frames = [state(0, 5, 1), state(1, 5, 1, { raceID: 2 }), { t: 2, payload: [] }, { t: 3, payload: [] }];
      expect(compactRecordingPerLap(frames).map((f) => f.t)).toEqual([0, 1, 2]);
    });
  });

  it("rejects lines that are not recording frames", () => {
    expect(() => parseRecording('{"foo": 1}')).toThrow(/Invalid recording line 1/);
  });

  it("anonymizes rider names but keeps bib, nation, laps and times", () => {
    const payload = [
      buildRace({
        competitors: [
          competitor(691, { firstName: "Isabella", lastName: "Rojas Gil (COL)", laps: 4, totalTime: "1:02.3" }),
          competitor(7, { firstName: "Max", lastName: "Muster" }),
        ],
      }),
    ];

    const [race] = anonymizePayload(payload) as typeof payload;
    expect(race!.competitors).toEqual([
      { number: "691", position: 0, lapsComplete: 4, firstName: "Rider", lastName: "691 (COL)", totalTime: "1:02.3" },
      { number: "7", position: 0, lapsComplete: 0, firstName: "Rider", lastName: "7", totalTime: "0:00" },
    ]);
  });
});
