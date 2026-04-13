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
  makeLiveTrackingResultsDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  startLiveTrackingCommand,
  transitionLiveTrackingSessionState,
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
  private participantPoolClient: RealtimeDocClient<LiveTrackingParticipantPoolDocument> | null = null;
  private activeParticipantPoolDocId: string | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private commandTimer: NodeJS.Timeout | null = null;
  private ammSyncTimer: NodeJS.Timeout | null = null;
  private resultsTimer: NodeJS.Timeout | null = null;

  private unsubscribeSession: (() => void) | null = null;
  private unsubscribeRuntime: (() => void) | null = null;
  private unsubscribeSetup: (() => void) | null = null;
  private unsubscribeParticipantPool: (() => void) | null = null;

  private readonly workerHost = os.hostname();
  private readonly workerProcessId = process.pid;

  private lastSessionState: LiveTrackingSessionDocument["state"] | null = null;
  private lastWorkerStatus: LiveTrackingRuntimeDocument["workerStatus"] | null = null;

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
    this.unsubscribeParticipantPool?.();
    this.unsubscribeParticipantPool = null;

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
      workerHeartbeatAt: t,
      workerProcessId: this.workerProcessId,
      workerHost: this.workerHost,
      updatedAt: t,
    }));

    this.setupClient?.close();
    this.setupClient = null;
    this.participantPoolClient?.close();
    this.participantPoolClient = null;

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

    private isHeartbeatEnabled(sessionOverride?: LiveTrackingSessionDocument | null): boolean {
    const session = sessionOverride ?? this.sessionClient.data;
    return !!session && isLiveTrackingSessionDocument(session) && (session.state === "ready" || session.state === "running");
  }


    private syncHeartbeatLifecycle(sessionOverride?: LiveTrackingSessionDocument | null) {
    const workerStatus = this.mapWorkerStatus(sessionOverride);
    this.logWorkerStatusTransition(workerStatus);

    if (this.isHeartbeatEnabled(sessionOverride)) {
      if (!this.heartbeatTimer) {
        const heartbeatMs = Math.max(5_000, this.options?.heartbeatMs ?? 5_000);
        this.heartbeatTimer = setInterval(() => this.writeHeartbeat(), heartbeatMs);
      }
      this.writeHeartbeat(sessionOverride);
      return;
    }


    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const t = nowIso();
    this.commitRuntimeUpdate((doc) => ({
      ...doc,
      workerStatus,
      workerHeartbeatAt: null,
      workerProcessId: this.workerProcessId,
      workerHost: this.workerHost,
      updatedAt: t,
    }));
  }

    private writeHeartbeat(sessionOverride?: LiveTrackingSessionDocument | null) {
    if (!this.isHeartbeatEnabled(sessionOverride)) return;

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

    private mapWorkerStatus(sessionOverride?: LiveTrackingSessionDocument | null): LiveTrackingRuntimeDocument["workerStatus"] {
    const session = sessionOverride ?? this.sessionClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return "starting";


    if (session.state === "running") return "running";
    if (session.state === "stopping") return "stopping";
    if (session.state === "ready") return "ready";
    if (session.state === "preparing") return "starting";
    if (session.state === "error") return "error";
    return "offline";
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

    private ensureParticipantPoolClient(): LiveTrackingParticipantPoolDocument | null {
    const session = this.sessionClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return null;

    const poolDocId =
      session.participantSource.kind === "event_participant_pool" || session.participantSource.kind === "setup_participant_pool"
        ? session.participantSource.participantPoolDocId
        : null;

    if (!poolDocId) {
      this.unsubscribeParticipantPool?.();
      this.participantPoolClient?.close();
      this.participantPoolClient = null;
      this.activeParticipantPoolDocId = null;
      return null;
    }

    if (this.activeParticipantPoolDocId !== poolDocId) {
      this.unsubscribeParticipantPool?.();
      this.participantPoolClient?.close();
      this.participantPoolClient = new RealtimeDocClient<LiveTrackingParticipantPoolDocument>(poolDocId, this.baseHttpUrl);
      this.participantPoolClient.connect();
      this.unsubscribeParticipantPool = this.participantPoolClient.onData(() => {
        this.scheduleUpdateResultsProjection();
      });
      this.activeParticipantPoolDocId = poolDocId;
    }

    const pool = this.participantPoolClient?.data;
    if (!pool || !isLiveTrackingParticipantPoolDocument(pool)) return null;
    return pool;
  }

  private updateResultsProjection() {
    const session = this.sessionClient.data;
    const setup = this.ensureSetupClient();
    const runtime = this.runtimeClient.data;
    const pool = this.ensureParticipantPoolClient();

    if (!session || !isLiveTrackingSessionDocument(session)) return;
    if (!setup || !runtime) return;

    const warnings: string[] = [];
    const athletes = pool?.athletes ?? [];

        if (session.participantSource.kind === "race") {
      warnings.push("race participant source projection is not connected yet; only participant-pool sources are supported.");
    }


    const projected = buildLiveTrackingResultsProjection({
      passings: runtime.recentPassings ?? [],
      track: setup.track,
      athletes,
      generatedAt: nowIso(),
      warnings,
      options: {
        debounceMs: 1_000,
        minSectorTimeMs: 500,
        minLapTimeMs: 10_000,
      },
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
