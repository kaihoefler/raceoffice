/**
 * livetracking/runtime
 * --------------------
 * Technical runtime state written by worker processes.
 *
 * Key separation rule:
 * - Runtime is operational/ephemeral status only.
 * - No persistent setup config and no final sporting ranking should live here.
 */

/**
 * Worker process lifecycle state.
 *
 * Separation rule vs. session state:
 * - workerStatus answers: "is the worker process alive / starting / stopping?"
 * - session.state answers: "is measurement idle / preparing / running / ...?"
 *
 * They are related, but intentionally not a 1:1 mirror.
 */
export type LiveTrackingWorkerStatus = "offline" | "starting" | "ready" | "running" | "stopping" | "error";


export type LiveTrackingRuntimeDecoderState = {
  decoderId: string;
  timingPointId: string;

  processStatus: "stopped" | "starting" | "running" | "error";
  websocketStatus: "disconnected" | "connecting" | "connected" | "error";

  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
};

/**
 * Normalized technical passing event captured from AMM streams.
 *
 * This intentionally mirrors the minimal event identity needed for later
 * timing-engine processing while remaining part of technical runtime debug data.
 */
export type LiveTrackingRuntimePassingEvent = {
  id: string;
  timestamp: string;
  transponderId: string;
  timingPointId: string;
  decoderId: string;
};

/**
 * Last raw AMM payload snapshots for troubleshooting parser/transport issues.
 */
export type LiveTrackingRuntimeRawPayload = {
  receivedAt: string;
  timingPointId: string;
  decoderId: string;
  payload: string;
};

/**
 * Liveness probe request written by clients/server and acknowledged by worker.
 *
 * Protocol intent:
 * - requester writes a new request with unique `requestId`
 * - worker observes the request, writes fresh heartbeat/ack timestamp
 * - worker clears `workerStatusCheck` back to null
 */
export type LiveTrackingWorkerStatusCheck = {
  action: "checkStatus";
  requestId: string;
  requestedAt: string;
};

export type LiveTrackingRuntimeDocument = {
  kind: "liveTrackingRuntime";

  version: 1;

    /** Worker process lifecycle status (not the sporting session lifecycle). */
  workerStatus: LiveTrackingWorkerStatus;

  workerHeartbeatAt: string | null;
  workerProcessId: number | null;
  workerHost: string | null;

  decoders: LiveTrackingRuntimeDecoderState[];

  recentPassings: LiveTrackingRuntimePassingEvent[];

  recentRawPayloads: LiveTrackingRuntimeRawPayload[];
  warnings: string[];

  /** Client/server initiated liveness probe consumed by worker. */
  workerStatusCheck: LiveTrackingWorkerStatusCheck | null;

  /** Last successful liveness-probe acknowledgement time (written by worker). */
  lastCheckAckAt: string | null;

  updatedAt: string | null;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createLiveTrackingRuntimeDocument(): LiveTrackingRuntimeDocument {
  return {
    kind: "liveTrackingRuntime",
    version: 1,
    workerStatus: "offline",
    workerHeartbeatAt: null,
    workerProcessId: null,
    workerHost: null,
        decoders: [],
    recentPassings: [],

    recentRawPayloads: [],
    warnings: [],
    workerStatusCheck: null,
    lastCheckAckAt: null,
    updatedAt: null,
  };
}


export function isLiveTrackingRuntimeDecoderState(value: unknown): value is LiveTrackingRuntimeDecoderState {
  if (!isRecord(value)) return false;

  return (
    typeof value.decoderId === "string" &&
    typeof value.timingPointId === "string" &&
    (value.processStatus === "stopped" ||
      value.processStatus === "starting" ||
      value.processStatus === "running" ||
      value.processStatus === "error") &&
    (value.websocketStatus === "disconnected" ||
      value.websocketStatus === "connecting" ||
      value.websocketStatus === "connected" ||
      value.websocketStatus === "error") &&
    (typeof value.lastConnectedAt === "string" || value.lastConnectedAt === null) &&
    (typeof value.lastMessageAt === "string" || value.lastMessageAt === null) &&
    (typeof value.lastError === "string" || value.lastError === null)
  );
}

export function isLiveTrackingRuntimePassingEvent(value: unknown): value is LiveTrackingRuntimePassingEvent {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.transponderId === "string" &&
    typeof value.timingPointId === "string" &&
    typeof value.decoderId === "string"
  );
}

export function isLiveTrackingRuntimeRawPayload(value: unknown): value is LiveTrackingRuntimeRawPayload {
  if (!isRecord(value)) return false;

  return (
    typeof value.receivedAt === "string" &&
    typeof value.timingPointId === "string" &&
    typeof value.decoderId === "string" &&
    typeof value.payload === "string"
  );
}

export function isLiveTrackingWorkerStatusCheck(value: unknown): value is LiveTrackingWorkerStatusCheck {
  if (!isRecord(value)) return false;

  return (
    value.action === "checkStatus" &&
    typeof value.requestId === "string" &&
    typeof value.requestedAt === "string"
  );
}

export function isLiveTrackingRuntimeDocument(value: unknown): value is LiveTrackingRuntimeDocument {
  if (!isRecord(value)) return false;


  return (
    value.kind === "liveTrackingRuntime" &&
    value.version === 1 &&
    (value.workerStatus === "offline" ||
      value.workerStatus === "starting" ||
      value.workerStatus === "ready" ||
      value.workerStatus === "running" ||
      value.workerStatus === "stopping" ||
      value.workerStatus === "error") &&
    (typeof value.workerHeartbeatAt === "string" || value.workerHeartbeatAt === null) &&
    (typeof value.workerProcessId === "number" || value.workerProcessId === null) &&
    (typeof value.workerHost === "string" || value.workerHost === null) &&
    Array.isArray(value.decoders) &&
    value.decoders.every(isLiveTrackingRuntimeDecoderState) &&
    Array.isArray(value.recentPassings) &&
    value.recentPassings.every(isLiveTrackingRuntimePassingEvent) &&
        Array.isArray(value.recentRawPayloads) &&
    value.recentRawPayloads.every(isLiveTrackingRuntimeRawPayload) &&
    Array.isArray(value.warnings) &&

    value.warnings.every((x) => typeof x === "string") &&
    // Backwards-compatible acceptance: legacy runtime docs may not have these fields yet.
    (value.workerStatusCheck === undefined || value.workerStatusCheck === null || isLiveTrackingWorkerStatusCheck(value.workerStatusCheck)) &&
    (value.lastCheckAckAt === undefined || typeof value.lastCheckAckAt === "string" || value.lastCheckAckAt === null) &&
    (typeof value.updatedAt === "string" || value.updatedAt === null)
  );
}

