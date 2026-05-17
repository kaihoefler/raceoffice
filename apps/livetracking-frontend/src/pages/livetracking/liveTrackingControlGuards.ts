import { canIssueLiveTrackingCommand, type LiveTrackingRuntimeDocument, type LiveTrackingSessionDocument } from "@raceoffice/domain";

export type LiveTrackingControlGuards = {
  canStartWorker: boolean;
  canPrepareTracking: boolean;
  canStartTracking: boolean;
  canStopTracking: boolean;
  canShutdownWorker: boolean;
  canResetTracking: boolean;
};

/**
 * Computes enable/disable guards for the live-tracking control action bar.
 *
 * Architectural rule:
 * - workerStatus is process lifecycle signal
 * - session state is measurement lifecycle signal
 * - command buttons require both dimensions to be valid
 */
export function getLiveTrackingControlGuards(args: {
  workerStatus: LiveTrackingRuntimeDocument["workerStatus"];
  workerHeartbeatAt?: string | null;
  nowMs?: number;
  heartbeatStaleMs?: number;
  sessionState: LiveTrackingSessionDocument["state"] | null;
  workerControlBusy: boolean;
}): LiveTrackingControlGuards {
  const {
    workerStatus,
    workerHeartbeatAt,
    nowMs = Date.now(),
    heartbeatStaleMs = 30_000,
    sessionState,
    workerControlBusy,
  } = args;

  const heartbeatMs = Number.isFinite(Date.parse(String(workerHeartbeatAt ?? "")))
    ? Date.parse(String(workerHeartbeatAt ?? ""))
    : Number.NaN;

  const effectiveWorkerStatus: LiveTrackingRuntimeDocument["workerStatus"] =
    workerStatus !== "offline" &&
    workerHeartbeatAt !== undefined &&
    (!Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > heartbeatStaleMs)
      ? "offline"
      : workerStatus;

  // Starting the worker is a process-level action and should stay possible
  // even before the session snapshot has loaded.
  if (!sessionState) {
    return {
      canStartWorker: !workerControlBusy && effectiveWorkerStatus === "offline",
      canPrepareTracking: false,
      canStartTracking: false,
      canStopTracking: false,
      canShutdownWorker: false,
      canResetTracking: false,
    };
  }

  const workerReadyForCommands = effectiveWorkerStatus === "ready" || effectiveWorkerStatus === "running";

  return {
    canStartWorker: !workerControlBusy && effectiveWorkerStatus === "offline",
    canPrepareTracking:
      !workerControlBusy && workerReadyForCommands && canIssueLiveTrackingCommand(sessionState, "prepare"),
    canStartTracking: !workerControlBusy && workerReadyForCommands && canIssueLiveTrackingCommand(sessionState, "start"),
    canStopTracking:
      !workerControlBusy && effectiveWorkerStatus !== "offline" && canIssueLiveTrackingCommand(sessionState, "stop"),
    canShutdownWorker:
      !workerControlBusy &&
      effectiveWorkerStatus !== "offline" &&
      (sessionState === "idle" || sessionState === "ready" || sessionState === "error"),
    canResetTracking: !workerControlBusy && canIssueLiveTrackingCommand(sessionState, "reset"),
  };
}
