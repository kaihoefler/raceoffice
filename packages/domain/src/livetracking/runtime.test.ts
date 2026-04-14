import { describe, expect, it } from "vitest";

import {
  createLiveTrackingRuntimeDocument,
  isLiveTrackingRuntimeDocument,
  isLiveTrackingWorkerStatusCheck,
} from "./runtime.js";

describe("livetracking/runtime", () => {
  it("accepts runtime status-check payloads", () => {
    expect(
      isLiveTrackingWorkerStatusCheck({
        action: "checkStatus",
        requestId: "req-1",
        requestedAt: "2026-01-01T10:00:00.000Z",
      }),
    ).toBe(true);

    expect(isLiveTrackingWorkerStatusCheck({ action: "checkStatus", requestId: "x" })).toBe(false);
    expect(isLiveTrackingWorkerStatusCheck({ action: "other", requestId: "x", requestedAt: "now" })).toBe(false);
  });

  it("creates and validates default runtime document with check fields", () => {
    const doc = createLiveTrackingRuntimeDocument();

    expect(doc.workerStatusCheck).toBeNull();
    expect(doc.lastCheckAckAt).toBeNull();
    expect(isLiveTrackingRuntimeDocument(doc)).toBe(true);
  });

  it("keeps backward compatibility for legacy docs without check fields", () => {
    const doc = createLiveTrackingRuntimeDocument();
    const legacy = { ...doc } as Record<string, unknown>;
    delete legacy.workerStatusCheck;
    delete legacy.lastCheckAckAt;

    expect(isLiveTrackingRuntimeDocument(legacy)).toBe(true);
  });
});
