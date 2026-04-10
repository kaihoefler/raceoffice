import { describe, expect, it } from "vitest";

import {
  canIssueLiveTrackingCommand,
  completeLiveTrackingCommand,
  createLiveTrackingCommand,
  createLiveTrackingSessionDocument,
  enqueueLiveTrackingCommand,
  failLiveTrackingCommand,
  getLiveTrackingCommandTargetState,
  getNextQueuedLiveTrackingCommand,
  getRunningLiveTrackingCommand,
  startLiveTrackingCommand,
  transitionLiveTrackingSessionState,
} from "./session.js";

describe("livetracking/session command model", () => {
  it("maps command intents to stable target states", () => {
    expect(getLiveTrackingCommandTargetState("prepare")).toBe("ready");
    expect(getLiveTrackingCommandTargetState("start")).toBe("running");
    expect(getLiveTrackingCommandTargetState("stop")).toBe("ready");
    expect(getLiveTrackingCommandTargetState("shutdown")).toBe("idle");
    expect(getLiveTrackingCommandTargetState("reset")).toBe("idle");
  });

  it("enqueues prepare from idle and sets desiredState", () => {
    const session = createLiveTrackingSessionDocument({
      setupId: "setup-1",
      eventId: "event-1",
    });

    expect(canIssueLiveTrackingCommand(session.state, "prepare")).toBe(true);

    const command = createLiveTrackingCommand({
      id: "cmd-1",
      intent: "prepare",
      requestedAt: "2026-01-01T10:00:00.000Z",
    });

    const next = enqueueLiveTrackingCommand(session, command, "2026-01-01T10:00:01.000Z");

    expect(next.desiredState).toBe("ready");
    expect(next.commandQueue).toHaveLength(1);
    expect(next.commandQueue[0].status).toBe("queued");
    expect(next.updatedAt).toBe("2026-01-01T10:00:01.000Z");
  });

  it("allows only one running command and returns next queued only when idle", () => {
    let session = createLiveTrackingSessionDocument({
      setupId: "setup-1",
      eventId: "event-1",
    });

    session = transitionLiveTrackingSessionState(session, "preparing");
    session = transitionLiveTrackingSessionState(session, "ready");

    const startCommand = createLiveTrackingCommand({
      id: "cmd-start",
      intent: "start",
      requestedAt: "2026-01-01T10:01:00.000Z",
    });
    const stopCommand = createLiveTrackingCommand({
      id: "cmd-stop",
      intent: "stop",
      requestedAt: "2026-01-01T10:01:10.000Z",
    });

    session = enqueueLiveTrackingCommand(session, startCommand);
    session = enqueueLiveTrackingCommand(session, stopCommand);

    expect(getNextQueuedLiveTrackingCommand(session)?.id).toBe("cmd-start");

    session = startLiveTrackingCommand(session, "cmd-start");
    expect(getRunningLiveTrackingCommand(session)?.id).toBe("cmd-start");
    expect(getNextQueuedLiveTrackingCommand(session)).toBeNull();

    // Starting another command while one is running is ignored.
    const unchanged = startLiveTrackingCommand(session, "cmd-stop");
    expect(unchanged).toEqual(session);
  });

  it("completes and fails commands with traceable status updates", () => {
    let session = createLiveTrackingSessionDocument({
      setupId: "setup-1",
      eventId: "event-1",
    });

    const prepare = createLiveTrackingCommand({
      id: "cmd-prepare",
      intent: "prepare",
      requestedAt: "2026-01-01T10:02:00.000Z",
    });

    session = enqueueLiveTrackingCommand(session, prepare);
    session = startLiveTrackingCommand(session, "cmd-prepare");
    session = transitionLiveTrackingSessionState(session, "preparing");
    session = completeLiveTrackingCommand(session, {
      commandId: "cmd-prepare",
      processedAt: "2026-01-01T10:02:02.000Z",
      nextState: "ready",
    });

    expect(session.commandQueue[0].status).toBe("completed");
    expect(session.state).toBe("ready");

    const start = createLiveTrackingCommand({
      id: "cmd-start",
      intent: "start",
      requestedAt: "2026-01-01T10:03:00.000Z",
    });

    session = enqueueLiveTrackingCommand(session, start);
    session = startLiveTrackingCommand(session, "cmd-start");
    session = failLiveTrackingCommand(session, {
      commandId: "cmd-start",
      processedAt: "2026-01-01T10:03:02.000Z",
      message: "decoder timeout",
      nextState: "error",
    });

    expect(session.commandQueue[1].status).toBe("failed");
    expect(session.lastError).toBe("decoder timeout");
    expect(session.state).toBe("error");
  });
});
