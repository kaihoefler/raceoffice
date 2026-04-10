/**
 * livetracking/session
 * --------------------
 * Session lifecycle + command queue model for LiveTracking.
 *
 * Design goals:
 * - Keep state-machine and queue semantics in pure functions.
 * - Make worker behavior deterministic and auditable.
 * - Avoid hidden side effects in server or UI layers.
 */

import { makeLiveTrackingParticipantPoolDocId } from "./ids.js";

export type LiveTrackingMode = "training" | "qualifying";

export type LiveTrackingSessionState =
  | "idle"
  | "preparing"
  | "ready"
  | "running"
  | "stopping"
  | "error";

export type LiveTrackingCommandIntent = "prepare" | "start" | "stop" | "shutdown" | "reset";

export type LiveTrackingCommandStatus = "queued" | "running" | "completed" | "failed" | "rejected";

/**
 * Stable command targets.
 *
 * Important distinction:
 * - `preparing` and `stopping` are transient execution states.
 * - command target states are steady outcomes a worker should reach.
 */
export type LiveTrackingCommandTargetState = Exclude<LiveTrackingSessionState, "preparing" | "stopping" | "error">;

/**
 * Session input source.
 *
 * `event_participant_pool`:
 * - participants are sourced from liveTrackingParticipants:{eventId}
 *
 * `race`:
 * - participants are sourced from a Race in Event-{eventId}
 */
export type LiveTrackingParticipantSource =
  | {
      kind: "event_participant_pool";
      eventId: string;
      participantPoolDocId: string;
    }
  | {
      kind: "race";
      eventId: string;
      raceId: string;
      eventDocId: string;
    };

export type LiveTrackingCommand = {
  id: string;
  intent: LiveTrackingCommandIntent;
  status: LiveTrackingCommandStatus;
  requestedAt: string;
  processedAt: string | null;
  message: string | null;
};

export type LiveTrackingSessionDocument = {
  kind: "liveTrackingSession";
  version: 1;
  setupId: string;
  mode: LiveTrackingMode;
  participantSource: LiveTrackingParticipantSource;

  desiredState: LiveTrackingSessionState;
  state: LiveTrackingSessionState;

  /** FIFO command queue. One running command max, remaining commands queued. */
  commandQueue: LiveTrackingCommand[];

  createdAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
};

const LIVE_TRACKING_ALLOWED_STATE_TRANSITIONS: Record<LiveTrackingSessionState, LiveTrackingSessionState[]> = {
  idle: ["preparing"],
  preparing: ["ready", "error"],
  ready: ["running", "idle", "error"],
  running: ["stopping", "error"],
  stopping: ["ready", "error"],
  error: ["idle", "preparing", "ready"],
};

const LIVE_TRACKING_COMMAND_TARGET_STATE: Record<LiveTrackingCommandIntent, LiveTrackingCommandTargetState> = {
  prepare: "ready",
  start: "running",
  stop: "ready",
  shutdown: "idle",
  reset: "idle",
};

const LIVE_TRACKING_ALLOWED_COMMAND_STATES: Record<LiveTrackingCommandIntent, LiveTrackingSessionState[]> = {
  prepare: ["idle", "ready", "error"],
  start: ["ready"],
  stop: ["running"],
  shutdown: ["ready", "error", "idle"],
  reset: ["idle", "preparing", "ready", "stopping", "error"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function defaultParticipantSource(eventId: string): LiveTrackingParticipantSource {
  const cleanedEventId = String(eventId ?? "").trim();
  return {
    kind: "event_participant_pool",
    eventId: cleanedEventId,
    participantPoolDocId: makeLiveTrackingParticipantPoolDocId(cleanedEventId),
  };
}

function updateCommandInQueue(
  queue: LiveTrackingCommand[],
  commandId: string,
  updater: (command: LiveTrackingCommand) => LiveTrackingCommand,
): LiveTrackingCommand[] {
  const id = String(commandId ?? "").trim();
  if (!id) return queue;

  let changed = false;
  const next = queue.map((cmd) => {
    if (cmd.id !== id) return cmd;
    const updated = updater(cmd);
    if (updated !== cmd) changed = true;
    return updated;
  });

  return changed ? next : queue;
}

export function createLiveTrackingSessionDocument(args: {
  setupId: string;
  eventId: string;
  mode?: LiveTrackingMode;
  participantSource?: LiveTrackingParticipantSource;
}): LiveTrackingSessionDocument {
  return {
    kind: "liveTrackingSession",
    version: 1,
    setupId: String(args.setupId ?? "").trim(),
    mode: args.mode ?? "training",
    participantSource: args.participantSource ?? defaultParticipantSource(args.eventId),
    desiredState: "idle",
    state: "idle",
    commandQueue: [],
    createdAt: null,
    updatedAt: null,
    lastError: null,
  };
}

/**
 * Validates one state transition against canonical session rules.
 */
export function canTransitionLiveTrackingSessionState(
  from: LiveTrackingSessionState,
  to: LiveTrackingSessionState,
): boolean {
  if (from === to) return true;
  const allowed = LIVE_TRACKING_ALLOWED_STATE_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/**
 * Returns the target steady-state for a command intent.
 */
export function getLiveTrackingCommandTargetState(intent: LiveTrackingCommandIntent): LiveTrackingCommandTargetState {
  return LIVE_TRACKING_COMMAND_TARGET_STATE[intent];
}

/**
 * Checks if issuing a command from the current state is valid.
 */
export function canIssueLiveTrackingCommand(state: LiveTrackingSessionState, intent: LiveTrackingCommandIntent): boolean {
  const allowedStates = LIVE_TRACKING_ALLOWED_COMMAND_STATES[intent] ?? [];
  return allowedStates.includes(state);
}

/**
 * Creates one queue entry in `queued` status.
 */
export function createLiveTrackingCommand(args: {
  id: string;
  intent: LiveTrackingCommandIntent;
  requestedAt: string;
  message?: string | null;
}): LiveTrackingCommand {
  return {
    id: String(args.id ?? "").trim(),
    intent: args.intent,
    status: "queued",
    requestedAt: String(args.requestedAt ?? "").trim(),
    processedAt: null,
    message: args.message ?? null,
  };
}

/**
 * Enqueues a command and updates desiredState to the command target.
 *
 * Returns the unmodified session when command issuance is not allowed.
 */
export function enqueueLiveTrackingCommand(
  session: LiveTrackingSessionDocument,
  command: LiveTrackingCommand,
  updatedAt?: string | null,
): LiveTrackingSessionDocument {
  if (!canIssueLiveTrackingCommand(session.state, command.intent)) return session;

  return {
    ...session,
    desiredState: getLiveTrackingCommandTargetState(command.intent),
    commandQueue: [...session.commandQueue, command],
    updatedAt: updatedAt ?? session.updatedAt,
  };
}

/** Returns the currently running command, if any. */
export function getRunningLiveTrackingCommand(session: LiveTrackingSessionDocument): LiveTrackingCommand | null {
  return session.commandQueue.find((cmd) => cmd.status === "running") ?? null;
}

/**
 * Returns the next startable command.
 * Domain rule: only one running command is allowed.
 */
export function getNextQueuedLiveTrackingCommand(session: LiveTrackingSessionDocument): LiveTrackingCommand | null {
  if (getRunningLiveTrackingCommand(session)) return null;
  return session.commandQueue.find((cmd) => cmd.status === "queued") ?? null;
}

/**
 * Marks a queued command as running.
 * Returns unchanged session when command is missing/invalid or another command already runs.
 */
export function startLiveTrackingCommand(
  session: LiveTrackingSessionDocument,
  commandId: string,
  updatedAt?: string | null,
): LiveTrackingSessionDocument {
  if (getRunningLiveTrackingCommand(session)) return session;

  const nextQueue = updateCommandInQueue(session.commandQueue, commandId, (cmd) =>
    cmd.status === "queued" ? { ...cmd, status: "running" } : cmd,
  );
  if (nextQueue === session.commandQueue) return session;

  return {
    ...session,
    commandQueue: nextQueue,
    updatedAt: updatedAt ?? session.updatedAt,
  };
}

/**
 * Applies one validated session-state transition.
 * Returns unchanged session when transition is not allowed.
 */
export function transitionLiveTrackingSessionState(
  session: LiveTrackingSessionDocument,
  nextState: LiveTrackingSessionState,
  updatedAt?: string | null,
): LiveTrackingSessionDocument {
  if (!canTransitionLiveTrackingSessionState(session.state, nextState)) return session;

  return {
    ...session,
    state: nextState,
    updatedAt: updatedAt ?? session.updatedAt,
  };
}

/**
 * Marks a running command as completed.
 *
 * Optional `nextState` allows explicit coupling of command acknowledgement
 * with a validated state transition in one pure update.
 */
export function completeLiveTrackingCommand(
  session: LiveTrackingSessionDocument,
  args: {
    commandId: string;
    processedAt: string;
    message?: string | null;
    nextState?: LiveTrackingSessionState;
    updatedAt?: string | null;
  },
): LiveTrackingSessionDocument {
  const nextQueue = updateCommandInQueue(session.commandQueue, args.commandId, (cmd) =>
    cmd.status === "running"
      ? {
          ...cmd,
          status: "completed",
          processedAt: String(args.processedAt ?? "").trim(),
          message: args.message ?? cmd.message,
        }
      : cmd,
  );
  if (nextQueue === session.commandQueue) return session;

  const withCommand = {
    ...session,
    commandQueue: nextQueue,
    updatedAt: args.updatedAt ?? session.updatedAt,
    lastError: null,
  };

  return args.nextState
    ? transitionLiveTrackingSessionState(withCommand, args.nextState, args.updatedAt)
    : withCommand;
}

/**
 * Marks a running command as failed.
 *
 * Optional `nextState` is typically `error`, but left explicit for caller control.
 */
export function failLiveTrackingCommand(
  session: LiveTrackingSessionDocument,
  args: {
    commandId: string;
    processedAt: string;
    message: string;
    nextState?: LiveTrackingSessionState;
    updatedAt?: string | null;
  },
): LiveTrackingSessionDocument {
  const errorMessage = String(args.message ?? "").trim() || "Command failed";

  const nextQueue = updateCommandInQueue(session.commandQueue, args.commandId, (cmd) =>
    cmd.status === "running"
      ? {
          ...cmd,
          status: "failed",
          processedAt: String(args.processedAt ?? "").trim(),
          message: errorMessage,
        }
      : cmd,
  );
  if (nextQueue === session.commandQueue) return session;

  const withFailure = {
    ...session,
    commandQueue: nextQueue,
    updatedAt: args.updatedAt ?? session.updatedAt,
    lastError: errorMessage,
  };

  return args.nextState
    ? transitionLiveTrackingSessionState(withFailure, args.nextState, args.updatedAt)
    : withFailure;
}

/**
 * Rejects a queued command without running it.
 */
export function rejectLiveTrackingCommand(
  session: LiveTrackingSessionDocument,
  args: {
    commandId: string;
    processedAt: string;
    message: string;
    updatedAt?: string | null;
  },
): LiveTrackingSessionDocument {
  const reason = String(args.message ?? "").trim() || "Command rejected";

  const nextQueue = updateCommandInQueue(session.commandQueue, args.commandId, (cmd) =>
    cmd.status === "queued"
      ? {
          ...cmd,
          status: "rejected",
          processedAt: String(args.processedAt ?? "").trim(),
          message: reason,
        }
      : cmd,
  );
  if (nextQueue === session.commandQueue) return session;

  return {
    ...session,
    commandQueue: nextQueue,
    updatedAt: args.updatedAt ?? session.updatedAt,
  };
}

export function isLiveTrackingSessionState(value: unknown): value is LiveTrackingSessionState {
  return (
    value === "idle" ||
    value === "preparing" ||
    value === "ready" ||
    value === "running" ||
    value === "stopping" ||
    value === "error"
  );
}

export function isLiveTrackingCommandIntent(value: unknown): value is LiveTrackingCommandIntent {
  return value === "prepare" || value === "start" || value === "stop" || value === "shutdown" || value === "reset";
}

export function isLiveTrackingCommandStatus(value: unknown): value is LiveTrackingCommandStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "rejected";
}

export function isLiveTrackingParticipantSource(value: unknown): value is LiveTrackingParticipantSource {
  if (!isRecord(value)) return false;

  if (value.kind === "event_participant_pool") {
    return typeof value.eventId === "string" && typeof value.participantPoolDocId === "string";
  }

  if (value.kind === "race") {
    return (
      typeof value.eventId === "string" &&
      typeof value.raceId === "string" &&
      typeof value.eventDocId === "string"
    );
  }

  return false;
}

export function isLiveTrackingCommand(value: unknown): value is LiveTrackingCommand {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    isLiveTrackingCommandIntent(value.intent) &&
    isLiveTrackingCommandStatus(value.status) &&
    typeof value.requestedAt === "string" &&
    (typeof value.processedAt === "string" || value.processedAt === null) &&
    (typeof value.message === "string" || value.message === null)
  );
}

export function isLiveTrackingSessionDocument(value: unknown): value is LiveTrackingSessionDocument {
  if (!isRecord(value)) return false;

  return (
    value.kind === "liveTrackingSession" &&
    value.version === 1 &&
    typeof value.setupId === "string" &&
    (value.mode === "training" || value.mode === "qualifying") &&
    isLiveTrackingParticipantSource(value.participantSource) &&
    isLiveTrackingSessionState(value.desiredState) &&
    isLiveTrackingSessionState(value.state) &&
    Array.isArray(value.commandQueue) &&
    value.commandQueue.every(isLiveTrackingCommand) &&
    (typeof value.createdAt === "string" || value.createdAt === null) &&
    (typeof value.updatedAt === "string" || value.updatedAt === null) &&
    (typeof value.lastError === "string" || value.lastError === null)
  );
}
