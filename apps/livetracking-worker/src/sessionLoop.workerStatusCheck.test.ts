import { describe, expect, it } from "vitest";

import {
  createLiveTrackingRuntimeDocument,
  createLiveTrackingSessionDocument,
  type LiveTrackingRuntimeDocument,
} from "@raceoffice/domain";
import { SessionLoop } from "./sessionLoop.js";

describe("SessionLoop workerStatusCheck handshake", () => {
  it("acknowledges new check request and clears workerStatusCheck", () => {
    const loop = new SessionLoop("http://127.0.0.1:8787", "active") as any;

    let runtimeDoc: LiveTrackingRuntimeDocument = {
      ...createLiveTrackingRuntimeDocument(),
      workerStatusCheck: {
        action: "checkStatus",
        requestId: "req-1",
        requestedAt: "2026-01-01T10:00:00.000Z",
      },
    };

    let updateCount = 0;

    loop.runtimeClient = {
      data: runtimeDoc,
      update: (updater: (doc: LiveTrackingRuntimeDocument) => LiveTrackingRuntimeDocument) => {
        runtimeDoc = updater(runtimeDoc);
        (loop.runtimeClient as any).data = runtimeDoc;
        updateCount += 1;
      },
    };

    loop.sessionClient = {
      data: createLiveTrackingSessionDocument({ setupId: "setup-a", eventId: "event-a" }),
    };

    loop.handleWorkerStatusCheck();

    expect(updateCount).toBe(1);
    expect(runtimeDoc.workerStatusCheck).toBeNull();
    expect(runtimeDoc.lastCheckAckAt).toEqual(expect.any(String));
    expect(runtimeDoc.workerHeartbeatAt).toEqual(expect.any(String));
    expect(runtimeDoc.workerStatus).toBe("ready");
  });

  it("does not process the same requestId twice", () => {
    const loop = new SessionLoop("http://127.0.0.1:8787", "active") as any;

    let runtimeDoc: LiveTrackingRuntimeDocument = {
      ...createLiveTrackingRuntimeDocument(),
      workerStatusCheck: {
        action: "checkStatus",
        requestId: "req-1",
        requestedAt: "2026-01-01T10:00:00.000Z",
      },
    };

    let updateCount = 0;

    loop.runtimeClient = {
      data: runtimeDoc,
      update: (updater: (doc: LiveTrackingRuntimeDocument) => LiveTrackingRuntimeDocument) => {
        runtimeDoc = updater(runtimeDoc);
        (loop.runtimeClient as any).data = runtimeDoc;
        updateCount += 1;
      },
    };

    loop.sessionClient = {
      data: createLiveTrackingSessionDocument({ setupId: "setup-a", eventId: "event-a" }),
    };

    loop.handleWorkerStatusCheck();

    // Simulate stale duplicate message from transport replay.
    runtimeDoc = {
      ...runtimeDoc,
      workerStatusCheck: {
        action: "checkStatus",
        requestId: "req-1",
        requestedAt: "2026-01-01T10:00:01.000Z",
      },
    };
    (loop.runtimeClient as any).data = runtimeDoc;

    loop.handleWorkerStatusCheck();

    expect(updateCount).toBe(1);
  });
});
