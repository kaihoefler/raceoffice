import { describe, expect, it } from "vitest";

import {
  applyLiveTrackingMeasurementCommand,
  canIssueLiveTrackingCommand,
  completeLiveTrackingCommand,
  createLiveTrackingCommand,
  createLiveTrackingSessionDocument,
  enqueueLiveTrackingCommand,
  failLiveTrackingCommand,
  getLiveTrackingCommandTargetState,
  getLiveTrackingMeasurementFromSeq,
  getNextQueuedLiveTrackingCommand,
  getRunningLiveTrackingCommand,
  isSeqInLiveTrackingMeasurement,
  normalizeLiveTrackingSessionDocument,
  startLiveTrackingCommand,
  transitionLiveTrackingSessionState,
} from "./session.js";

const session = () => createLiveTrackingSessionDocument({ setupId: "s1", eventId: "e1" });
const cmd = (id: string, intent: "start" | "stop" | "reset") => createLiveTrackingCommand({ id, intent, requestedAt: "t" });

describe("live tracking session state machine", () => {
  it("allows start from idle/error, stop only while running, reset always", () => {
    expect(canIssueLiveTrackingCommand("idle", "start")).toBe(true);
    expect(canIssueLiveTrackingCommand("error", "start")).toBe(true);
    expect(canIssueLiveTrackingCommand("running", "start")).toBe(false);
    expect(canIssueLiveTrackingCommand("idle", "stop")).toBe(false);
    expect(canIssueLiveTrackingCommand("running", "stop")).toBe(true);
    for (const state of ["idle", "running", "error"] as const) expect(canIssueLiveTrackingCommand(state, "reset")).toBe(true);
    expect(getLiveTrackingCommandTargetState("start")).toBe("running");
    expect(getLiveTrackingCommandTargetState("stop")).toBe("idle");
  });

  it("queues commands FIFO with one running command", () => {
    let s = enqueueLiveTrackingCommand(session(), cmd("a", "start"), "t1");
    expect(s.desiredState).toBe("running");
    // stop is not allowed while still idle
    expect(enqueueLiveTrackingCommand(s, cmd("b", "stop"))).toBe(s);
    s = startLiveTrackingCommand(s, "a", "t2");
    expect(getRunningLiveTrackingCommand(s)?.id).toBe("a");
    expect(getNextQueuedLiveTrackingCommand(s)).toBeNull();
    s = completeLiveTrackingCommand(s, { commandId: "a", processedAt: "t3", nextState: "running" });
    expect(s.state).toBe("running");
    expect(s.commandQueue[0]?.status).toBe("completed");
  });

  it("validates transitions and records failures", () => {
    const s = session();
    expect(transitionLiveTrackingSessionState(s, "running").state).toBe("running");
    const running = startLiveTrackingCommand(enqueueLiveTrackingCommand(s, cmd("a", "start")), "a");
    const failed = failLiveTrackingCommand(running, { commandId: "a", processedAt: "t", message: "no store", nextState: "error" });
    expect(failed).toMatchObject({ state: "error", lastError: "no store" });
  });
});

describe("measurement window", () => {
  const measurement = {
    segments: [
      { fromSeq: 10, toSeq: 20, startedAt: "a", stoppedAt: "b" },
      { fromSeq: 30, toSeq: null, startedAt: "c", stoppedAt: null },
    ],
  };

  it("includes passings of all segments but not the pause", () => {
    expect(isSeqInLiveTrackingMeasurement(10, measurement)).toBe(false);
    expect(isSeqInLiveTrackingMeasurement(11, measurement)).toBe(true);
    expect(isSeqInLiveTrackingMeasurement(20, measurement)).toBe(true);
    expect(isSeqInLiveTrackingMeasurement(25, measurement)).toBe(false);
    expect(isSeqInLiveTrackingMeasurement(999, measurement)).toBe(true);
    expect(isSeqInLiveTrackingMeasurement(5, null)).toBe(false);
    expect(getLiveTrackingMeasurementFromSeq(measurement)).toBe(10);
    expect(getLiveTrackingMeasurementFromSeq(undefined)).toBeNull();
  });
});

describe("migration of old session documents", () => {
  it("maps the former stages to idle and settles old prepare/shutdown commands", () => {
    const legacy = {
      ...session(),
      state: "ready",
      desiredState: "ready",
      commandQueue: [
        { id: "a", intent: "prepare", status: "completed", requestedAt: "t", processedAt: "t", message: null },
        { id: "b", intent: "shutdown", status: "queued", requestedAt: "t", processedAt: null, message: null },
      ],
    };
    const migrated = normalizeLiveTrackingSessionDocument(legacy)!;
    expect(migrated).toMatchObject({ state: "idle", desiredState: "idle" });
    expect(migrated.commandQueue.map((c) => [c.intent, c.status])).toEqual([
      ["start", "completed"],
      ["stop", "completed"],
    ]);
    expect(getNextQueuedLiveTrackingCommand(migrated)).toBeNull();
  });

  it("returns current documents unchanged and rejects non-sessions", () => {
    const s = session();
    expect(normalizeLiveTrackingSessionDocument(s)).toBe(s);
    expect(normalizeLiveTrackingSessionDocument({ kind: "other" })).toBeNull();
  });
});

describe("measurement commands", () => {
  it("start/stop/start keeps segments, reset starts over", () => {
    let m = applyLiveTrackingMeasurementCommand(null, "start", { lastSeq: 10, at: "a", running: false });
    expect(m).toEqual({ segments: [{ fromSeq: 10, toSeq: null, startedAt: "a", stoppedAt: null }] });
    m = applyLiveTrackingMeasurementCommand(m, "stop", { lastSeq: 20, at: "b", running: true });
    m = applyLiveTrackingMeasurementCommand(m, "start", { lastSeq: 30, at: "c", running: false });
    expect(m?.segments.map((s) => [s.fromSeq, s.toSeq])).toEqual([
      [10, 20],
      [30, null],
    ]);
    expect(applyLiveTrackingMeasurementCommand(m, "reset", { lastSeq: 40, at: "d", running: true })?.segments).toEqual([
      { fromSeq: 40, toSeq: null, startedAt: "d", stoppedAt: null },
    ]);
    expect(applyLiveTrackingMeasurementCommand(m, "reset", { lastSeq: 40, at: "d", running: false })).toBeNull();
  });
});
