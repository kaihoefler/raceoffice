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

/**
 * Measurement lifecycle state (doc/timing-architecture.md, section 7).
 *
 * - `idle`: no measurement running (results of a stopped measurement stay visible)
 * - `running`: passings of the setup's decoders count for the measurement
 * - `error`: a command failed; `reset` or `start` leaves it
 *
 * Decoder connections are not part of it: they belong to the timing layer and are
 * connected explicitly. The former stages `preparing`/`ready`/`stopping` had no effect
 * and are migrated to `idle` (normalizeLiveTrackingSessionDocument).
 */
export type LiveTrackingSessionState = "idle" | "running" | "error";

/** States written by older versions; only accepted by the migration. */
type LegacySessionState = "preparing" | "ready" | "stopping";

export type LiveTrackingCommandIntent = "start" | "stop" | "reset";

/**
 * One running period of a measurement, as window on the timing passing store:
 * passings with `fromSeq < seq <= toSeq` (`toSeq` null while running).
 */
export type LiveTrackingMeasurementSegment = {
  fromSeq: number;
  toSeq: number | null;
  startedAt: string;
  stoppedAt: string | null;
};

/**
 * The measurement of this session. Start after Stop continues it with a new segment (the pause
 * does not count); `reset` starts over. Passings themselves are never touched – deleting them is
 * a timing-layer action.
 */
export type LiveTrackingMeasurement = {
  segments: LiveTrackingMeasurementSegment[];
};

export type LiveTrackingCommandStatus = "queued" | "running" | "completed" | "failed" | "rejected";

/** Steady outcome a command should reach. */
export type LiveTrackingCommandTargetState = Exclude<LiveTrackingSessionState, "error">;

/**
 * Session input source.
 *
  * `event_participant_pool`:
 * - participants are sourced from liveTrackingParticipants:{eventId}
 *
 * `setup_participant_pool`:
 * - participants are sourced from a standalone setup-managed pool
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
      kind: "setup_participant_pool";
      /** Optional event context kept for UI filtering and backwards compatibility. */
      eventId: string;
      setupId: string;
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

  /** Measurement window on the timing passing store; absent before the first start. */
  measurement?: LiveTrackingMeasurement | null;

  createdAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
};

/**
 * Canonical session state graph.
 *
 * Architectural rule:
 * - callers must never mutate `state` arbitrarily
 * - every state change must pass through this transition table
 */
const LIVE_TRACKING_ALLOWED_STATE_TRANSITIONS: Record<LiveTrackingSessionState, LiveTrackingSessionState[]> = {
  idle: ["running", "error"],
  running: ["idle", "error"],
  error: ["idle", "running"],
};

/** Desired steady-state per command intent (`desiredState` = operator intent). */
const LIVE_TRACKING_COMMAND_TARGET_STATE: Record<LiveTrackingCommandIntent, LiveTrackingCommandTargetState> = {
  start: "running",
  stop: "idle",
  // Reset keeps a running measurement running (with an empty window); see the worker.
  reset: "idle",
};

/**
 * Command issuance guardrail table.
 *
 * This prevents enqueueing commands that are semantically impossible from the
 * current state and keeps command history auditable (valid commands only).
 */
const LIVE_TRACKING_ALLOWED_COMMAND_STATES: Record<LiveTrackingCommandIntent, LiveTrackingSessionState[]> = {
  start: ["idle", "error"],
  stop: ["running"],
  reset: ["idle", "running", "error"],
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

/**
 * Immutable queue item updater used by start/complete/fail/reject helpers.
 *
 * Returns original array when nothing changed to preserve cheap identity checks.
 */
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

/**
 * Creates a canonical session document with safe defaults.
 *
 * Domain choice:
 * - default state is fully inactive (`idle` + empty queue)
 * - participant source defaults to event participant pool, because that source
 *   is currently supported end-to-end in worker projection logic.
 */
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
/**
 * Adds a command to FIFO queue and updates desired state to that command target.
 *
 * Important:
 * - this does not execute the command
 * - execution/acknowledgement is worker responsibility
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
  return value === "idle" || value === "running" || value === "error";
}

export function isLiveTrackingCommandIntent(value: unknown): value is LiveTrackingCommandIntent {
  return value === "start" || value === "stop" || value === "reset";
}

function isMeasurement(value: unknown): value is LiveTrackingMeasurement {
  if (!isRecord(value) || !Array.isArray(value.segments)) return false;
  return value.segments.every(
    (seg) =>
      isRecord(seg) &&
      typeof seg.fromSeq === "number" &&
      (seg.toSeq === null || typeof seg.toSeq === "number") &&
      typeof seg.startedAt === "string" &&
      (seg.stoppedAt === null || typeof seg.stoppedAt === "string"),
  );
}

/** True if a passing (by store `seq`) belongs to the measurement. */
export function isSeqInLiveTrackingMeasurement(seq: number, measurement: LiveTrackingMeasurement | null | undefined): boolean {
  for (const seg of measurement?.segments ?? []) {
    if (seq > seg.fromSeq && (seg.toSeq === null || seq <= seg.toSeq)) return true;
  }
  return false;
}

/** Lowest store seq the measurement needs (passings after it), or null without measurement. */
export function getLiveTrackingMeasurementFromSeq(measurement: LiveTrackingMeasurement | null | undefined): number | null {
  const segments = measurement?.segments ?? [];
  return segments.length ? Math.min(...segments.map((s) => s.fromSeq)) : null;
}

/**
 * Migrates session documents written by older versions:
 * - states `preparing`/`ready`/`stopping` → `idle`
 * - queued or running commands `prepare`/`shutdown` → completed (they had no effect)
 * Returns the document unchanged when it is current, null when it is no session at all.
 */
export function normalizeLiveTrackingSessionDocument(value: unknown): LiveTrackingSessionDocument | null {
  if (isLiveTrackingSessionDocument(value)) return value;
  if (!isRecord(value) || value.kind !== "liveTrackingSession") return null;
  const legacy: Record<string, LiveTrackingSessionState> = { preparing: "idle", ready: "idle", stopping: "idle" };
  const mapState = (v: unknown): unknown => (typeof v === "string" && v in legacy ? legacy[v as LegacySessionState] : v);
  const queue = Array.isArray(value.commandQueue) ? value.commandQueue : [];
  const migrated = {
    ...value,
    state: mapState(value.state),
    desiredState: mapState(value.desiredState),
    commandQueue: queue.map((cmd) => {
      if (!isRecord(cmd) || (cmd.intent !== "prepare" && cmd.intent !== "shutdown")) return cmd;
      const done = cmd.status === "queued" || cmd.status === "running";
      return {
        ...cmd,
        intent: cmd.intent === "prepare" ? "start" : "stop",
        status: done ? "completed" : cmd.status,
        message: cmd.message ?? `migrated legacy ${String(cmd.intent)} command`,
      };
    }),
  };
  return isLiveTrackingSessionDocument(migrated) ? migrated : null;
}

export function isLiveTrackingCommandStatus(value: unknown): value is LiveTrackingCommandStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "rejected";
}

export function isLiveTrackingParticipantSource(value: unknown): value is LiveTrackingParticipantSource {
  if (!isRecord(value)) return false;

  if (value.kind === "event_participant_pool") {
    return typeof value.eventId === "string" && typeof value.participantPoolDocId === "string";
  }

    if (value.kind === "setup_participant_pool") {
    return (
      typeof value.eventId === "string" &&
      typeof value.setupId === "string" &&
      typeof value.participantPoolDocId === "string"
    );
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
    (value.measurement === undefined || value.measurement === null || isMeasurement(value.measurement)) &&
    (typeof value.createdAt === "string" || value.createdAt === null) &&
    (typeof value.updatedAt === "string" || value.updatedAt === null) &&
    (typeof value.lastError === "string" || value.lastError === null)
  );
}

/**
 * Measurement window after a command, given the last seq of the timing passing store at that
 * moment:
 * - start: new open segment (a stopped measurement continues; the pause does not count)
 * - stop: closes the open segment
 * - reset: discards all segments; a running measurement starts over immediately
 */
export function applyLiveTrackingMeasurementCommand(
  measurement: LiveTrackingMeasurement | null | undefined,
  intent: LiveTrackingCommandIntent,
  args: { lastSeq: number; at: string; running: boolean },
): LiveTrackingMeasurement | null {
  const open = (): LiveTrackingMeasurementSegment => ({ fromSeq: args.lastSeq, toSeq: null, startedAt: args.at, stoppedAt: null });
  const segments = measurement?.segments ?? [];
  if (intent === "start") {
    const closed = segments.map((s) => (s.toSeq === null ? { ...s, toSeq: args.lastSeq, stoppedAt: args.at } : s));
    return { segments: [...closed, open()] };
  }
  if (intent === "stop") {
    return { segments: segments.map((s) => (s.toSeq === null ? { ...s, toSeq: args.lastSeq, stoppedAt: args.at } : s)) };
  }
  return args.running ? { segments: [open()] } : null;
}
