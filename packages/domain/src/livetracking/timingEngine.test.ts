import { describe, expect, it } from "vitest";

import { buildLiveTrackingResultsProjection } from "./timingEngine.js";
import type { LiveTrackingAthlete } from "./participantPool.js";
import type { LiveTrackingPassingEvent } from "./results.js";
import type { LiveTrackingTrack } from "./setup.js";

const track: LiveTrackingTrack = {
  id: "track-1",
  name: "Test Track",
  lengthM: 400,
  timingPoints: [
    {
      id: "sf",
      name: "Start/Finish",
      decoderId: "dec-sf",
      decoderIp: "127.0.0.1",
      websocketPortAMM: 19010,
      order: 1,
      distanceFromPreviousM: 0,
      absolutePositionM: 0,
      role: "start_finish",
      enabled: true,
    },
    {
      id: "s1",
      name: "Sector 1",
      decoderId: "dec-s1",
      decoderIp: "127.0.0.1",
      websocketPortAMM: 19011,
      order: 2,
      distanceFromPreviousM: 150,
      absolutePositionM: 150,
      role: "split",
      enabled: true,
    },
    {
      id: "s2",
      name: "Sector 2",
      decoderId: "dec-s2",
      decoderIp: "127.0.0.1",
      websocketPortAMM: 19012,
      order: 3,
      distanceFromPreviousM: 250,
      absolutePositionM: 400,
      role: "split",
      enabled: true,
    },
  ],
};

const athletes: LiveTrackingAthlete[] = [
  {
    id: "a1",
    bib: 11,
    firstName: "A",
    lastName: "One",
    nation: null,
    ageGroupId: null,
    transponderIds: ["12345"],
  },
];

function p(id: string, timestamp: string, transponderId: string, timingPointId: string): LiveTrackingPassingEvent {
  return { id, timestamp, transponderId, timingPointId, decoderId: `dec-${timingPointId}` };
}

describe("livetracking/timingEngine", () => {
  it("derives splits + last/best lap and filters invalid events", () => {
    const passings: LiveTrackingPassingEvent[] = [
      p("1", "2026-01-01T10:00:00.000Z", "12345", "sf"),
      p("2", "2026-01-01T10:00:10.000Z", "12345", "s1"),
      p("3", "2026-01-01T10:00:10.400Z", "12345", "s1"), // debounce
      p("4", "2026-01-01T10:00:20.000Z", "12345", "s2"),
      p("5", "2026-01-01T10:00:30.000Z", "12345", "sf"), // lap 30s valid
      p("6", "2026-01-01T10:00:35.000Z", "12345", "s1"),
      p("7", "2026-01-01T10:00:39.000Z", "12345", "s2"),
      p("8", "2026-01-01T10:00:40.000Z", "12345", "sf"), // lap 10s invalid (min lap)
      p("9", "2026-01-01T10:00:50.000Z", "99999", "sf"), // unknown transponder
    ];

    const results = buildLiveTrackingResultsProjection({
      passings,
      track,
      athletes,
      generatedAt: "2026-01-01T10:00:35.000Z",
      options: {
        debounceMs: 1_000,
        minLapTimeMs: 20_000,
      },
    });

    const state = results.athleteLiveStates.find((x) => x.athleteId === "a1");
    expect(state).toBeTruthy();
    expect(state?.lapsCompleted).toBe(1);
    expect(state?.lastLapTimeMs).toBe(30_000);
    expect(state?.bestLapTimeMs).toBe(30_000);
    expect(state?.activityStatus).toBe("active");

    expect(results.qualifyingRanking).toHaveLength(1);
    expect(results.qualifyingRanking[0]?.bestLapTimeMs).toBe(30_000);

    expect(results.unknownTransponders).toContain("99999");
    expect(results.invalidEvents.some((x) => x.reason === "debounce")).toBe(true);
    expect(results.invalidEvents.some((x) => x.reason === "min_lap_time")).toBe(true);

    const synthetic = results.athleteLiveStates.find((x) => x.athleteId === "unknown:transponder:99999");
    expect(synthetic?.firstName).toBe("");
    expect(synthetic?.lastName).toBe("99999");
  });

  it("uses transponder as fallback participant surname when participant pool is empty", () => {
    const results = buildLiveTrackingResultsProjection({
      passings: [
        p("1", "2026-01-01T10:00:00.000Z", "445566", "sf"),
        p("2", "2026-01-01T10:00:12.000Z", "445566", "s1"),
      ],
      track,
      athletes: [],
      generatedAt: "2026-01-01T10:00:15.000Z",
    });

    expect(results.athleteLiveStates).toHaveLength(1);
    expect(results.athleteLiveStates[0]?.athleteId).toBe("unknown:transponder:445566");
    expect(results.athleteLiveStates[0]?.lastName).toBe("445566");
    expect(results.invalidEvents.some((x) => x.reason === "unknown_transponder")).toBe(false);
  });

  it("validates timing-point sequence", () => {
    const passings: LiveTrackingPassingEvent[] = [
      p("1", "2026-01-01T10:00:00.000Z", "12345", "sf"),
      p("2", "2026-01-01T10:00:05.000Z", "12345", "s2"), // wrong sequence (expect s1)
    ];

    const results = buildLiveTrackingResultsProjection({
      passings,
      track,
      athletes,
      generatedAt: "2026-01-01T10:00:10.000Z",
    });

    expect(results.invalidEvents.some((x) => x.reason === "sequence")).toBe(true);
  });
});
