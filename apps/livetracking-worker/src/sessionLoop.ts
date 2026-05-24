/**
 * Session loop for the LiveTracking worker.
 *
 * Responsibilities (single orchestration point):
 * - keep live subscriptions to session/runtime/results/setup/participants documents
 * - execute session command queue transitions (prepare/start/stop/shutdown/reset)
 * - manage AMMC process lifecycle + websocket connections per timing point
 * - persist runtime telemetry (decoder status, raw payloads, normalized passings)
 * - continuously project sporting results from runtime passings + setup + participant pool
 *
 * Important design rule:
 * This class intentionally keeps business rules delegated to domain helpers.
 * It orchestrates *when* things happen, while domain modules define *what is valid*.
 */
import os from "node:os";
import {
  completeLiveTrackingCommand,
  failLiveTrackingCommand,
  getNextQueuedLiveTrackingCommand,
  getRunningLiveTrackingCommand,
  buildLiveTrackingResultsProjection,
    isLiveTrackingParticipantPoolDocument,
  isLiveTrackingSessionDocument,
  isLiveTrackingSetupDocument,
  isLiveTrackingWorkerStatusCheck,

  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  startLiveTrackingCommand,
  transitionLiveTrackingSessionState,
  type LiveTrackingAthlete,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingResultsDocument,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type LiveTrackingTimingPoint,
} from "@raceoffice/domain";
import WebSocket from "ws";
import { explodeAmmPayloads, normalizeAmmPayloadToPassing } from "./ammParser.js";
import { AmmcProcessManager } from "./ammcProcessManager.js";
import { RealtimeDocClient } from "./realtimeDocClient.js";

function nowIso(): string {
  return new Date().toISOString();
}

function appendBounded<T>(items: T[], value: T, max: number): T[] {
  const next = [...items, value];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Extracts athletes from a pool doc defensively, tolerating legacy docs that predate
 * the `kind`/`version` requirement or that stored `bib` as a string instead of a number.
 *
 * Why this exists instead of just relying on `isLiveTrackingParticipantPoolDocument`:
 * - Pools created before the kind/version fields were introduced pass the guard, but
 *   athletes with string bibs cause the per-athlete check to fail, silently dropping
 *   the entire pool. This coercion layer makes the worker operational without requiring
 *   a UI-driven migration run first.
 */
function extractAthletesFromPoolDoc(pool: unknown): LiveTrackingAthlete[] {
  if (!pool || typeof pool !== "object" || Array.isArray(pool)) return [];

  // Fast path: valid doc passes the full guard.
  if (isLiveTrackingParticipantPoolDocument(pool)) {
    return (pool as { athletes: LiveTrackingAthlete[] }).athletes ?? [];
  }

  // Legacy path: attempt per-athlete coercion.
  const raw = pool as Record<string, unknown>;
  if (!Array.isArray(raw.athletes)) return [];

  const result: LiveTrackingAthlete[] = [];
  for (const entry of raw.athletes) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const v = entry as Record<string, unknown>;
    if (typeof v.id !== "string" || typeof v.firstName !== "string" || typeof v.lastName !== "string") continue;

    let bib: number | null = null;
    if (typeof v.bib === "number") bib = v.bib;
    else if (typeof v.bib === "string" && v.bib.trim()) {
      const n = Number(v.bib.trim());
      if (Number.isFinite(n)) bib = n;
    }

    result.push({
      id: v.id,
      bib,
      firstName: v.firstName,
      lastName: v.lastName,
      nation: typeof v.nation === "string" ? v.nation : null,
      ageGroupId: typeof v.ageGroupId === "string" ? v.ageGroupId : null,
      transponderIds: Array.isArray(v.transponderIds)
        ? v.transponderIds.filter((x): x is string => typeof x === "string")
        : [],
    });
  }

  if (result.length > 0) {
    console.warn(
      `[livetracking-worker] Pool doc missing kind/version or had type mismatches — coerced ${result.length} athlete(s). Navigate to Participants page to persist the migration.`,
    );
  }

  return result;
}

function deriveTimingOptions(setup: { minLapTimeSecs?: number; track: { timingPoints: Array<{ enabled: boolean }> } }): {
  minLapTimeMs: number;
  minSectorTimeMs: number;
} {
  const minLapTimeMs = Math.max(1_000, (setup.minLapTimeSecs ?? 8) * 1_000);
  const enabledCount = setup.track.timingPoints.filter((p) => p.enabled).length;
  const minSectorTimeMs = enabledCount > 1 ? Math.max(500, Math.floor(minLapTimeMs / enabledCount)) : 500;
  return { minLapTimeMs, minSectorTimeMs };
}

type AmmConnection = {
  timingPoint: LiveTrackingTimingPoint;
  socket: WebSocket;
};

export class SessionLoop {
  readonly sessionDocId: string;
  readonly runtimeDocId: string;
  readonly resultsDocId: string;
  readonly sessionClient: RealtimeDocClient<LiveTrackingSessionDocument>;
  readonly runtimeClient: RealtimeDocClient<LiveTrackingRuntimeDocument>;
  readonly resultsClient: RealtimeDocClient<LiveTrackingResultsDocument>;

  private setupClient: RealtimeDocClient<LiveTrackingSetupDocument> | null = null;
  private activeSetupDocId: string | null = null;
  // Keyed by pool doc ID; tracks all currently active pool subscriptions.
  private readonly participantPoolClients = new Map<string, RealtimeDocClient<LiveTrackingParticipantPoolDocument>>();
  private readonly unsubscribeParticipantPools = new Map<string, () => void>();

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private commandTimer: NodeJS.Timeout | null = null;
  private ammSyncTimer: NodeJS.Timeout | null = null;
  private resultsTimer: NodeJS.Timeout | null = null;

  private unsubscribeSession: (() => void) | null = null;
  private unsubscribeRuntime: (() => void) | null = null;
  private unsubscribeSetup: (() => void) | null = null;

  private readonly workerHost = os.hostname();
  private readonly workerProcessId = process.pid;

    private lastSessionState: LiveTrackingSessionDocument["state"] | null = null;
  private lastWorkerStatus: LiveTrackingRuntimeDocument["workerStatus"] | null = null;
  private lastHandledWorkerStatusCheckRequestId: string | null = null;


  private readonly ammConnections = new Map<string, AmmConnection>();
  private readonly pendingAmmConnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly ammcProcessManager: AmmcProcessManager;

  constructor(
    private readonly baseHttpUrl: string,
    readonly sessionId: string,
    private readonly options?: { heartbeatMs?: number; commandTickMs?: number },
  ) {
    this.sessionDocId = makeLiveTrackingSessionDocId(sessionId);
    this.runtimeDocId = makeLiveTrackingRuntimeDocId(sessionId);
    this.resultsDocId = makeLiveTrackingResultsDocId(sessionId);
    this.sessionClient = new RealtimeDocClient<LiveTrackingSessionDocument>(this.sessionDocId, baseHttpUrl);
    this.runtimeClient = new RealtimeDocClient<LiveTrackingRuntimeDocument>(this.runtimeDocId, baseHttpUrl);
    this.resultsClient = new RealtimeDocClient<LiveTrackingResultsDocument>(this.resultsDocId, baseHttpUrl);
    this.ammcProcessManager = new AmmcProcessManager({
      onStatus: (timingPoint, patch) => {
        if (patch.processStatus === "error") {
          console.error(
            `[livetracking-worker] AMMC status error for timingPoint=${timingPoint.id}: ${patch.lastError ?? "unknown error"}`,
          );
        }

        this.upsertRuntimeDecoder(timingPoint, patch);
        this.scheduleSyncAmmConnections();

        if (patch.processStatus === "error" || patch.processStatus === "stopped") {
          setTimeout(() => this.scheduleSyncAmmConnections(), 2500);
        }
      },
      onWarning: (warning) => {
        console.warn(`[livetracking-worker] ${warning}`);
        this.appendRuntimeWarning(warning);
      },
    });
  }

  start() {
    this.sessionClient.connect();
    this.runtimeClient.connect();
    this.resultsClient.connect();

    this.unsubscribeSession = this.sessionClient.onData(() => {
      this.logSessionStateTransition();
      this.syncHeartbeatLifecycle();
      this.scheduleTickCommands();
      this.scheduleSyncAmmConnections();
      this.scheduleUpdateResultsProjection();
    });

        this.unsubscribeRuntime = this.runtimeClient.onData(() => {
      this.handleWorkerStatusCheck();
      this.scheduleUpdateResultsProjection();
    });


    console.log(
      `[livetracking-worker] session loop started (pid=${this.workerProcessId}, host=${this.workerHost}, sessionDocId=${this.sessionDocId})`,
    );

    this.syncHeartbeatLifecycle();
    this.scheduleTickCommands();
    this.scheduleSyncAmmConnections();
    this.scheduleUpdateResultsProjection();
  }

  stop() {
    this.clearScheduledTimers();

    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = null;
    this.unsubscribeSetup?.();
    this.unsubscribeSetup = null;
    for (const unsub of this.unsubscribeParticipantPools.values()) unsub();
    this.unsubscribeParticipantPools.clear();

    for (const [timingPointId] of this.pendingAmmConnectTimers) {
      this.clearPendingAmmConnect(timingPointId);
    }

    for (const [timingPointId] of this.ammConnections) {
      this.disconnectAmm(timingPointId);
    }
    this.ammcProcessManager.stopAll();

    this.logWorkerStatusTransition("offline");

    const t = nowIso();
    this.commitRuntimeUpdate((doc) => ({
      ...doc,
      workerStatus: "offline",
      workerHeartbeatAt: null,
      workerProcessId: null,
      workerHost: null,
      workerStatusCheck: null,
      updatedAt: t,
    }));


    this.setupClient?.close();
    this.setupClient = null;
    for (const client of this.participantPoolClients.values()) client.close();
    this.participantPoolClients.clear();

    this.sessionClient.close();
    this.runtimeClient.close();
    this.resultsClient.close();
  }

  private clearScheduledTimers() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
    if (this.ammSyncTimer) {
      clearTimeout(this.ammSyncTimer);
      this.ammSyncTimer = null;
    }
    if (this.resultsTimer) {
      clearTimeout(this.resultsTimer);
      this.resultsTimer = null;
    }
    for (const [timingPointId] of this.pendingAmmConnectTimers) {
      this.clearPendingAmmConnect(timingPointId);
    }
  }

  private scheduleTickCommands() {
    if (this.commandTimer) return;
    this.commandTimer = setTimeout(() => {
      this.commandTimer = null;
      this.tickCommands();
    }, 0);
  }

  private scheduleSyncAmmConnections() {
    if (this.ammSyncTimer) return;
    this.ammSyncTimer = setTimeout(() => {
      this.ammSyncTimer = null;
      this.syncAmmConnections();
    }, 0);
  }

    private scheduleUpdateResultsProjection() {
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = null;
      this.updateResultsProjection();
    }, 250);
  }

  /**
   * Keeps runtime decoder list aligned to currently configured enabled timing points.
   *
   * Without this reconciliation, stale decoder entries from older setup revisions can
   * remain visible in runtime debug output even after points were removed.
   */
  private pruneRuntimeDecoders(enabledTimingPointIds: Set<string>) {
    this.commitRuntimeUpdate((doc) => ({
      ...doc,
      decoders: (doc.decoders ?? []).filter((decoder) => enabledTimingPointIds.has(decoder.timingPointId)),
      updatedAt: nowIso(),
    }));
  }


  /**
   * Runtime updates are very frequent (heartbeats + decoder events).
   *
   * To reduce patch noise, we ignore pure `updatedAt` differences and only publish
   * when meaningful runtime fields changed.
   */
  private hasRuntimeContentChanged(previous: LiveTrackingRuntimeDocument, next: LiveTrackingRuntimeDocument): boolean {
    const previousComparable = JSON.stringify({ ...previous, updatedAt: null });
    const nextComparable = JSON.stringify({ ...next, updatedAt: null });
    return previousComparable !== nextComparable;
  }

  /**
   * Atomic runtime write helper.
   *
   * Why this exists:
   * - several runtime fields must often change together (decoder status + raw payload + passings)
   * - one atomic mutation avoids revision races caused by multiple back-to-back updates
   */
  private commitRuntimeUpdate(buildNext: (doc: LiveTrackingRuntimeDocument) => LiveTrackingRuntimeDocument) {
    this.runtimeClient.update((doc) => {
      const next = buildNext(doc);
      return this.hasRuntimeContentChanged(doc, next) ? next : doc;
    });
  }

      private syncHeartbeatLifecycle(sessionOverride?: LiveTrackingSessionDocument | null) {
    if (!this.heartbeatTimer) {
      const heartbeatMs = Math.max(5_000, this.options?.heartbeatMs ?? 5_000);
      this.heartbeatTimer = setInterval(() => this.writeHeartbeat(), heartbeatMs);
    }

    this.writeHeartbeat(sessionOverride);
  }

  private writeHeartbeat(sessionOverride?: LiveTrackingSessionDocument | null) {
    const workerStatus = this.mapWorkerStatus(sessionOverride);

    this.logWorkerStatusTransition(workerStatus);

    this.commitRuntimeUpdate((doc) => {
      const t = nowIso();
      return {
        ...doc,
        workerStatus,
        workerHeartbeatAt: t,
        workerProcessId: this.workerProcessId,
        workerHost: this.workerHost,
        updatedAt: t,
      };
    });
  }


  private logSessionStateTransition() {
    const session = this.sessionClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return;

    if (this.lastSessionState === session.state) return;
    const from = this.lastSessionState ?? "unknown";
    this.lastSessionState = session.state;
    console.log(`[livetracking-worker] session state changed: ${from} -> ${session.state}`);
  }

  private logWorkerStatusTransition(nextStatus: LiveTrackingRuntimeDocument["workerStatus"]) {
    if (this.lastWorkerStatus === nextStatus) return;
    const from = this.lastWorkerStatus ?? "unknown";
    this.lastWorkerStatus = nextStatus;
    console.log(`[livetracking-worker] worker status changed: ${from} -> ${nextStatus}`);
  }

        /**
   * Maps current activity into worker process status signal.
   *
   * Important: this is intentionally not a 1:1 mirror of session.state.
   * Session tracks measurement lifecycle, while workerStatus tracks process lifecycle.
   */
  private mapWorkerStatus(sessionOverride?: LiveTrackingSessionDocument | null): LiveTrackingRuntimeDocument["workerStatus"] {
    const session = sessionOverride ?? this.sessionClient.data;

    if (!session || !isLiveTrackingSessionDocument(session)) return "ready";

    if (session.state === "running") return "running";
    if (session.state === "stopping") return "stopping";
    if (session.state === "error") return "error";
    return "ready";
  }

  /**
   * Consumes one pending worker-status probe request from runtime document.
   *
   * Protocol:
   * - requester writes `{ action: "checkStatus", requestId, requestedAt }`
   * - worker acknowledges exactly once per requestId
   * - worker heartbeat + ack timestamp are refreshed and the request is cleared
   */
  private handleWorkerStatusCheck() {
    const runtime = this.runtimeClient.data;
    if (!runtime) return;

    const check = runtime.workerStatusCheck;
    if (!isLiveTrackingWorkerStatusCheck(check)) return;
    if (this.lastHandledWorkerStatusCheckRequestId === check.requestId) return;

    this.lastHandledWorkerStatusCheckRequestId = check.requestId;
    this.acknowledgeWorkerStatusCheck(check.requestId);
  }

  private acknowledgeWorkerStatusCheck(requestId: string) {
    const workerStatus = this.mapWorkerStatus();
    this.logWorkerStatusTransition(workerStatus);

    this.commitRuntimeUpdate((doc) => {
      const t = nowIso();
      const matchesRequest =
        isLiveTrackingWorkerStatusCheck(doc.workerStatusCheck) && doc.workerStatusCheck.requestId === requestId;

      return {
        ...doc,
        workerStatus,
        workerHeartbeatAt: t,
        workerProcessId: this.workerProcessId,
        workerHost: this.workerHost,
        workerStatusCheck: matchesRequest ? null : doc.workerStatusCheck ?? null,
        lastCheckAckAt: matchesRequest ? t : doc.lastCheckAckAt ?? null,
        updatedAt: t,
      };
    });
  }


  private ensureSetupClient(): LiveTrackingSetupDocument | null {
    const session = this.sessionClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return null;

    const setupDocId = makeLiveTrackingSetupDocId(session.setupId);
    if (this.activeSetupDocId !== setupDocId) {
      this.unsubscribeSetup?.();
      this.setupClient?.close();
      this.setupClient = new RealtimeDocClient<LiveTrackingSetupDocument>(setupDocId, this.baseHttpUrl);
      this.setupClient.connect();
      this.unsubscribeSetup = this.setupClient.onData(() => {
        this.scheduleSyncAmmConnections();
        this.scheduleUpdateResultsProjection();
      });
      this.activeSetupDocId = setupDocId;
    }

    const setup = this.setupClient?.data;
    if (!setup || !isLiveTrackingSetupDocument(setup)) return null;
    return setup;
  }

  /**
   * Reconciles live subscriptions to all active participant pool docs.
   *
   * Pool IDs are read from `setup.activeParticipantPoolIds` so that the setup document
   * is the single source of truth — the session's participantPoolDocId is not used here.
   * Athletes from all active pools are merged and returned for name resolution.
   */
  private ensureParticipantPoolAthletes(): LiveTrackingAthlete[] | null {
    const setup = this.setupClient?.data;
    if (!setup || !isLiveTrackingSetupDocument(setup)) {
      // No setup available — close all existing pool subscriptions.
      for (const unsub of this.unsubscribeParticipantPools.values()) unsub();
      this.unsubscribeParticipantPools.clear();
      for (const client of this.participantPoolClients.values()) client.close();
      this.participantPoolClients.clear();
      return [];
    }

    const targetDocIds = new Set(
      (setup.activeParticipantPoolIds ?? []).map((id) => makeLiveTrackingParticipantPoolDocId(id)),
    );

    // Remove subscriptions for pools that are no longer active.
    for (const [docId, client] of this.participantPoolClients) {
      if (!targetDocIds.has(docId)) {
        this.unsubscribeParticipantPools.get(docId)?.();
        this.unsubscribeParticipantPools.delete(docId);
        client.close();
        this.participantPoolClients.delete(docId);
      }
    }

    // Add subscriptions for newly active pools.
    for (const docId of targetDocIds) {
      if (!this.participantPoolClients.has(docId)) {
        const client = new RealtimeDocClient<LiveTrackingParticipantPoolDocument>(docId, this.baseHttpUrl);
        client.connect();
        const unsub = client.onData(() => this.scheduleUpdateResultsProjection());
        this.participantPoolClients.set(docId, client);
        this.unsubscribeParticipantPools.set(docId, unsub);
      }
    }

    // If any target pool subscription hasn't received its first snapshot yet, return null so
    // the caller can skip the projection. The onData callback will schedule a new one once
    // all snapshots have arrived. This prevents a "flash" projection with empty athletes that
    // would incorrectly mark known transponders as unknown.
    for (const docId of targetDocIds) {
      const client = this.participantPoolClients.get(docId);
      if (client && client.data === null) {
        console.log(`[livetracking-worker] pool snapshot pending: ${docId} — deferring projection`);
        return null;
      }
    }

    // Merge athletes from all active pools; later pools' entries append to earlier ones.
    const athletes: LiveTrackingAthlete[] = [];
    for (const client of this.participantPoolClients.values()) {
      athletes.push(...extractAthletesFromPoolDoc(client.data));
    }

    console.log(
      `[livetracking-worker] pool athletes loaded: ${athletes.length} athlete(s), transponders: [${athletes.flatMap((a) => a.transponderIds).join(", ")}]`,
    );

    return athletes;
  }

  private updateResultsProjection() {
    const session = this.sessionClient.data;
    const setup = this.ensureSetupClient();
    const runtime = this.runtimeClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return;
    if (!setup || !runtime) return;

    // Reconcile pool subscriptions. Returns null when a snapshot is still in-flight — defer.
    const athletes = this.ensureParticipantPoolAthletes();
    if (athletes === null) return;

    const warnings: string[] = [];

    if (session.participantSource.kind === "race") {
      warnings.push("race participant source projection is not connected yet; only participant-pool sources are supported.");
    }

    const timingOptions = { debounceMs: 2_000, ...deriveTimingOptions(setup) };

    if (athletes.length === 0 && (setup.activeParticipantPoolIds ?? []).length > 0) {
      const poolIds = (setup.activeParticipantPoolIds ?? []).join(", ");
      warnings.push(`[worker] No athletes loaded from active pool(s): ${poolIds}. Pool documents may be empty or still loading.`);
      console.warn(`[livetracking-worker] projection: 0 athletes from pools [${poolIds}], ${(runtime.recentPassings ?? []).length} passings, minLapTimeMs=${timingOptions.minLapTimeMs}`);
    } else {
      console.log(`[livetracking-worker] projection: ${athletes.length} athletes, ${(runtime.recentPassings ?? []).length} passings, minLapTimeMs=${timingOptions.minLapTimeMs}`);
    }

    const projected = buildLiveTrackingResultsProjection({
      passings: runtime.recentPassings ?? [],
      track: setup.track,
      athletes,
      generatedAt: nowIso(),
      warnings,
      options: timingOptions,
    });

    const current = this.resultsClient.data;
    if (current) {
      const currentComparable = JSON.stringify({ ...current, generatedAt: null });
      const projectedComparable = JSON.stringify({ ...projected, generatedAt: null });
      if (currentComparable === projectedComparable) return;
    }

    this.resultsClient.update(() => projected);
  }

  /**
   * Reconciles AMMC processes and websocket connections against current setup/session state.
   *
   * Reconciliation model:
   * - source of truth = enabled timing points in the active setup
   * - if session is not running: tear everything down
   * - if running: ensure process exists first, then websocket connect (with startup delay)
   */
    private syncAmmConnections() {
    const session = this.sessionClient.data;
    const setup = this.ensureSetupClient();

    if (setup) {
      const configuredEnabledIds = new Set(
        normalizeTimingPoints(setup.track.timingPoints)
          .filter((p) => p.enabled)
          .map((p) => p.id),
      );
      this.pruneRuntimeDecoders(configuredEnabledIds);
    }

    const shouldCollect = !!session && isLiveTrackingSessionDocument(session) && session.state === "running";
    if (!shouldCollect || !setup) {

      for (const [timingPointId] of this.pendingAmmConnectTimers) {
        this.clearPendingAmmConnect(timingPointId);
      }
      for (const [timingPointId] of this.ammConnections) {
        this.disconnectAmm(timingPointId);
      }
      this.ammcProcessManager.stopAll();
      return;
    }

    const enabledPoints = normalizeTimingPoints(setup.track.timingPoints).filter((p) => p.enabled);
    const enabledIds = new Set(enabledPoints.map((p) => p.id));

    this.ammcProcessManager.sync(enabledPoints);

    for (const [timingPointId] of this.pendingAmmConnectTimers) {
      const processRunning = this.ammcProcessManager.isRunning(timingPointId);
      if (!enabledIds.has(timingPointId) || !processRunning) this.clearPendingAmmConnect(timingPointId);
    }

    for (const [timingPointId] of this.ammConnections) {
      const processRunning = this.ammcProcessManager.isRunning(timingPointId);
      if (!enabledIds.has(timingPointId) || !processRunning) this.disconnectAmm(timingPointId);
    }

    for (const point of enabledPoints) {
      if (!this.ammcProcessManager.isRunning(point.id)) continue;
      if (this.ammConnections.has(point.id)) continue;
      this.scheduleConnectAmm(point);
    }
  }

  private clearPendingAmmConnect(timingPointId: string) {
    const timer = this.pendingAmmConnectTimers.get(timingPointId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingAmmConnectTimers.delete(timingPointId);
  }

  private scheduleConnectAmm(point: LiveTrackingTimingPoint) {
    if (this.pendingAmmConnectTimers.has(point.id)) return;

    const delayMs = 1_000;
    console.log(
      `[livetracking-worker] waiting ${delayMs}ms before connecting to AMMC websocket for timingPoint=${point.id}`,
    );

    const timer = setTimeout(() => {
      this.pendingAmmConnectTimers.delete(point.id);

      const session = this.sessionClient.data;
      const isRunning = !!session && isLiveTrackingSessionDocument(session) && session.state === "running";
      if (!isRunning) return;
      if (!this.ammcProcessManager.isRunning(point.id)) return;
      if (this.ammConnections.has(point.id)) return;

      this.connectAmm(point);
    }, delayMs);

    this.pendingAmmConnectTimers.set(point.id, timer);
  }

  private connectAmm(point: LiveTrackingTimingPoint) {
    // AMMC opens the websocket endpoint locally on the worker host.
    // The decoder IP is consumed by AMMC itself (process args), not by this websocket client.
    const url = `ws://127.0.0.1:${point.websocketPortAMM}`;
    console.log(`[livetracking-worker] connecting to AMMC websocket for timingPoint=${point.id}: ${url}`);
    const socket = new WebSocket(url);
    const connection: AmmConnection = { timingPoint: point, socket };
    this.ammConnections.set(point.id, connection);

    this.upsertRuntimeDecoder(point, {
      websocketStatus: "connecting",
      lastError: null,
    });

    socket.on("open", () => {
      this.upsertRuntimeDecoder(point, {
        websocketStatus: "connected",
        lastConnectedAt: nowIso(),
        lastError: null,
      });
    });

    socket.on("message", (raw) => {
      this.handleAmmMessage(point, raw);
    });

    socket.on("error", (err) => {
      const message = err instanceof Error ? err.message : "AMM websocket error";
      console.error(`[livetracking-worker] AMMC websocket error for timingPoint=${point.id}: ${message}`);
      this.upsertRuntimeDecoder(point, {
        processStatus: "error",
        websocketStatus: "error",
        lastError: message,
      });
    });

    socket.on("close", (code, reason) => {
      const reasonText = reason.toString("utf8") || "n/a";
      console.warn(
        `[livetracking-worker] AMMC websocket closed for timingPoint=${point.id} (code=${String(code)}, reason=${reasonText})`,
      );
      this.upsertRuntimeDecoder(point, {
        websocketStatus: "disconnected",
      });
      this.ammConnections.delete(point.id);
    });
  }

  private disconnectAmm(timingPointId: string) {
    this.clearPendingAmmConnect(timingPointId);

    const connection = this.ammConnections.get(timingPointId);
    if (!connection) return;

    connection.socket.close();
    this.ammConnections.delete(timingPointId);

    this.upsertRuntimeDecoder(connection.timingPoint, {
      websocketStatus: "disconnected",
    });
  }

  /**
   * Handles one AMMC websocket frame.
   *
   * Pipeline:
   * 1) parse JSON payload (store raw even on parse failures)
   * 2) explode array/object payloads into event candidates
   * 3) normalize candidates into canonical runtime passing events
   * 4) persist decoder heartbeat + raw payload + passings + warnings in one atomic runtime update
   */
  private handleAmmMessage(point: LiveTrackingTimingPoint, raw: WebSocket.RawData) {
    const receivedAt = nowIso();
    const rawText = typeof raw === "string" ? raw : raw.toString("utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      this.commitRuntimeUpdate((doc) => {
        const decoders = [...(doc.decoders ?? [])];
        const index = decoders.findIndex((d) => d.timingPointId === point.id || d.decoderId === point.decoderId);

        const base: LiveTrackingRuntimeDocument["decoders"][number] =
          index >= 0
            ? decoders[index]!
            : {
                decoderId: point.decoderId,
                timingPointId: point.id,
                processStatus: "stopped",
                websocketStatus: "disconnected",
                lastConnectedAt: null,
                lastMessageAt: null,
                lastError: null,
              };

        const nextDecoder: LiveTrackingRuntimeDocument["decoders"][number] = {
          ...base,
          websocketStatus: "error",
          lastError: "Invalid AMM JSON payload",
        };

        if (index >= 0) decoders[index] = nextDecoder;
        else decoders.push(nextDecoder);

        return {
          ...doc,
          decoders,
          recentRawPayloads: appendBounded(
            doc.recentRawPayloads ?? [],
            {
              receivedAt,
              timingPointId: point.id,
              decoderId: point.decoderId,
              payload: rawText,
            },
            50,
          ),
          updatedAt: receivedAt,
        };
      });
      return;
    }

    const passings: LiveTrackingRuntimeDocument["recentPassings"] = [];
    const warnings: string[] = [];

    for (const item of explodeAmmPayloads(parsed)) {
      const normalized = normalizeAmmPayloadToPassing({ payload: item, timingPoint: point });
      if (!normalized) continue;

      passings.push(normalized.passing);
      for (const warning of normalized.warnings) {
        warnings.push(`[${point.id}] ${warning}`);
      }
    }

    this.commitRuntimeUpdate((doc) => {
      const decoders = [...(doc.decoders ?? [])];
      const index = decoders.findIndex((d) => d.timingPointId === point.id || d.decoderId === point.decoderId);

      const base: LiveTrackingRuntimeDocument["decoders"][number] =
        index >= 0
          ? decoders[index]!
          : {
              decoderId: point.decoderId,
              timingPointId: point.id,
              processStatus: "stopped",
              websocketStatus: "disconnected",
              lastConnectedAt: null,
              lastMessageAt: null,
              lastError: null,
            };

      const nextDecoder: LiveTrackingRuntimeDocument["decoders"][number] = {
        ...base,
        websocketStatus: "connected",
        lastMessageAt: receivedAt,
        lastError: null,
      };

      if (index >= 0) decoders[index] = nextDecoder;
      else decoders.push(nextDecoder);

      let nextPassings = doc.recentPassings ?? [];
      for (const passing of passings) {
        nextPassings = appendBounded(nextPassings, passing, 200);
      }

      let nextWarnings = doc.warnings ?? [];
      for (const warning of warnings) {
        nextWarnings = appendBounded(nextWarnings, warning, 100);
      }

      return {
        ...doc,
        decoders,
        recentRawPayloads: appendBounded(
          doc.recentRawPayloads ?? [],
          {
            receivedAt,
            timingPointId: point.id,
            decoderId: point.decoderId,
            payload: rawText,
          },
          50,
        ),
        recentPassings: nextPassings,
        warnings: nextWarnings,
        updatedAt: receivedAt,
      };
    });
  }

  private appendRuntimeRawPayload(point: LiveTrackingTimingPoint, receivedAt: string, payload: string) {
    this.runtimeClient.update((doc) => ({
      ...doc,
      recentRawPayloads: appendBounded(
        doc.recentRawPayloads ?? [],
        {
          receivedAt,
          timingPointId: point.id,
          decoderId: point.decoderId,
          payload,
        },
        50,
      ),
      updatedAt: receivedAt,
    }));
  }

  private appendRuntimeWarning(warning: string) {
    const t = nowIso();
    this.runtimeClient.update((doc) => ({
      ...doc,
      warnings: appendBounded(doc.warnings ?? [], warning, 100),
      updatedAt: t,
    }));
  }

  private upsertRuntimeDecoder(
    point: LiveTrackingTimingPoint,
    patch: Partial<LiveTrackingRuntimeDocument["decoders"][number]>,
  ) {
    const t = nowIso();
    this.commitRuntimeUpdate((doc) => {
      const decoders = [...(doc.decoders ?? [])];
      const index = decoders.findIndex((d) => d.timingPointId === point.id || d.decoderId === point.decoderId);

      const base: LiveTrackingRuntimeDocument["decoders"][number] =
        index >= 0
          ? decoders[index]!
          : {
              decoderId: point.decoderId,
              timingPointId: point.id,
              processStatus: "stopped",
              websocketStatus: "disconnected",
              lastConnectedAt: null,
              lastMessageAt: null,
              lastError: null,
            };

      const next: LiveTrackingRuntimeDocument["decoders"][number] = { ...base, ...patch };
      if (index >= 0) decoders[index] = next;
      else decoders.push(next);

      return {
        ...doc,
        decoders,
        updatedAt: t,
      };
    });
  }

  /**
   * Executes one command-queue tick.
   *
   * Domain transition helpers from `@raceoffice/domain` enforce legal state flow.
   * This method only maps command intents to concrete transition sequences.
   */
  private tickCommands() {
    const session = this.sessionClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return;

    const t = nowIso();
    let nextSession = session;

    const running = getRunningLiveTrackingCommand(nextSession);
    if (!running) {
      const queued = getNextQueuedLiveTrackingCommand(nextSession);
      if (queued) {
        nextSession = startLiveTrackingCommand(nextSession, queued.id, t);
      }
    }

    const active = getRunningLiveTrackingCommand(nextSession);
    if (!active) {
      this.commitIfChanged(session, nextSession);
      return;
    }

    switch (active.intent) {
      case "prepare": {
        if (nextSession.state === "idle" || nextSession.state === "ready" || nextSession.state === "error") {
          nextSession = transitionLiveTrackingSessionState(nextSession, "preparing", t);
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "ready",
            updatedAt: t,
          });
          break;
        }

        if (nextSession.state === "preparing") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "ready",
            updatedAt: t,
          });
          break;
        }

        nextSession = failLiveTrackingCommand(nextSession, {
          commandId: active.id,
          processedAt: t,
          message: `prepare is invalid from state ${nextSession.state}`,
          nextState: "error",
          updatedAt: t,
        });
        break;
      }

      case "start": {
        if (nextSession.state === "ready") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "running",
            updatedAt: t,
          });
          break;
        }

        nextSession = failLiveTrackingCommand(nextSession, {
          commandId: active.id,
          processedAt: t,
          message: `start is invalid from state ${nextSession.state}`,
          nextState: "error",
          updatedAt: t,
        });
        break;
      }

      case "stop": {
        if (nextSession.state === "running") {
          nextSession = transitionLiveTrackingSessionState(nextSession, "stopping", t);
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "ready",
            updatedAt: t,
          });
          break;
        }

        if (nextSession.state === "stopping") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "ready",
            updatedAt: t,
          });
          break;
        }

        if (nextSession.state === "ready") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            updatedAt: t,
          });
          break;
        }

        nextSession = failLiveTrackingCommand(nextSession, {
          commandId: active.id,
          processedAt: t,
          message: `stop is invalid from state ${nextSession.state}`,
          nextState: "error",
          updatedAt: t,
        });
        break;
      }

      case "shutdown": {
        if (nextSession.state === "ready" || nextSession.state === "error") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "idle",
            updatedAt: t,
          });
          break;
        }

        if (nextSession.state === "idle") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            updatedAt: t,
          });
          break;
        }

        nextSession = failLiveTrackingCommand(nextSession, {
          commandId: active.id,
          processedAt: t,
          message: `shutdown is invalid from state ${nextSession.state}`,
          nextState: "error",
          updatedAt: t,
        });
        break;
      }

      case "reset": {
        if (nextSession.state === "preparing" || nextSession.state === "stopping") {
          nextSession = transitionLiveTrackingSessionState(nextSession, "ready", t);
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "idle",
            updatedAt: t,
          });
          break;
        }

        if (nextSession.state === "ready" || nextSession.state === "error") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            nextState: "idle",
            updatedAt: t,
          });
          break;
        }

        if (nextSession.state === "idle") {
          nextSession = completeLiveTrackingCommand(nextSession, {
            commandId: active.id,
            processedAt: t,
            updatedAt: t,
          });
          break;
        }

        nextSession = failLiveTrackingCommand(nextSession, {
          commandId: active.id,
          processedAt: t,
          message: `reset is invalid from state ${nextSession.state}`,
          nextState: "error",
          updatedAt: t,
        });
        break;
      }
    }

    this.commitIfChanged(session, nextSession);
  }

    private commitIfChanged(previous: LiveTrackingSessionDocument, next: LiveTrackingSessionDocument) {
    if (previous === next) return;
    this.sessionClient.update(() => next);

    // Use the target session snapshot immediately to avoid one-tick lag in workerStatus
    // (e.g. ready -> idle after shutdown).
    this.syncHeartbeatLifecycle(next);
    this.scheduleSyncAmmConnections();
    this.scheduleUpdateResultsProjection();
  }

}
