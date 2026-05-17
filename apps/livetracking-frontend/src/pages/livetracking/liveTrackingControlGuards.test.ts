import { describe, expect, it } from "vitest";

import { getLiveTrackingControlGuards } from "./liveTrackingControlGuards";

describe("liveTrackingControlGuards", () => {
  it("enables start worker only when worker is offline and not busy", () => {
    expect(
      getLiveTrackingControlGuards({
        workerStatus: "offline",
        sessionState: "idle",
        workerControlBusy: false,
      }).canStartWorker,
    ).toBe(true);

    expect(
      getLiveTrackingControlGuards({
        workerStatus: "ready",
        sessionState: "idle",
        workerControlBusy: false,
      }).canStartWorker,
    ).toBe(false);

    expect(
      getLiveTrackingControlGuards({
        workerStatus: "offline",
        sessionState: "idle",
        workerControlBusy: true,
      }).canStartWorker,
    ).toBe(false);
  });

  it("treats stale heartbeat as offline for guard decisions", () => {
    const guards = getLiveTrackingControlGuards({
      workerStatus: "ready",
      workerHeartbeatAt: "2026-01-01T10:00:00.000Z",
      nowMs: Date.parse("2026-01-01T10:01:00.000Z"),
      sessionState: "idle",
      workerControlBusy: false,
    });

    expect(guards.canStartWorker).toBe(true);
    expect(guards.canPrepareTracking).toBe(false);
  });

  it("requires ready/running worker for prepare/start actions", () => {
    const withReadyWorker = getLiveTrackingControlGuards({
      workerStatus: "ready",
      sessionState: "idle",
      workerControlBusy: false,
    });
    expect(withReadyWorker.canPrepareTracking).toBe(true);
    expect(withReadyWorker.canStartTracking).toBe(false);

    const withOfflineWorker = getLiveTrackingControlGuards({
      workerStatus: "offline",
      sessionState: "idle",
      workerControlBusy: false,
    });
    expect(withOfflineWorker.canPrepareTracking).toBe(false);

    const runningAndReadyToStart = getLiveTrackingControlGuards({
      workerStatus: "running",
      sessionState: "ready",
      workerControlBusy: false,
    });
    expect(runningAndReadyToStart.canStartTracking).toBe(true);
  });

  it("allows shutdown only from idle/ready/error while worker is online", () => {
    expect(
      getLiveTrackingControlGuards({
        workerStatus: "ready",
        sessionState: "ready",
        workerControlBusy: false,
      }).canShutdownWorker,
    ).toBe(true);

    expect(
      getLiveTrackingControlGuards({
        workerStatus: "ready",
        sessionState: "running",
        workerControlBusy: false,
      }).canShutdownWorker,
    ).toBe(false);

    expect(
      getLiveTrackingControlGuards({
        workerStatus: "offline",
        sessionState: "idle",
        workerControlBusy: false,
      }).canShutdownWorker,
    ).toBe(false);
  });

  it("keeps only start-worker enabled when session snapshot is missing", () => {
    const guards = getLiveTrackingControlGuards({
      workerStatus: "offline",
      sessionState: null,
      workerControlBusy: false,
    });

    expect(guards.canStartWorker).toBe(true);
    expect(guards.canPrepareTracking).toBe(false);
    expect(guards.canStartTracking).toBe(false);
    expect(guards.canStopTracking).toBe(false);
    expect(guards.canShutdownWorker).toBe(false);
    expect(guards.canResetTracking).toBe(false);
  });
});
