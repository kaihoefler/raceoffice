/**
 * Session loop for the LiveTracking worker.
 *
 * Responsibilities (single orchestration point):
 * - keep live subscriptions to session/runtime/results/setup/participants documents
 * - execute session command queue transitions (prepare/start/stop/shutdown/reset)
 * - reconcile decoder connections of the timing layer (TimingConnectionManager): explicitly
 *   connected decoders (timingConnection) plus – phase 1 bridge – the decoders of the setup
 *   while the session is running
 * - upload every passing to the timing passing store, and map it through the setup to timing
 *   points for the LiveTracking passing history / passing log / decoder status
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
  makeLiveTrackingPassingHistoryDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  startLiveTrackingCommand,
  transitionLiveTrackingSessionState,
  type LiveTrackingAthlete,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingResultsDocument,
  type LiveTrackingPassingHistoryDocument,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingRuntimeRawPayload,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  applyTimingClockOffset,
  createTimingDecodersDocument,
  findTimingDecoder,
  isTimingConnectionDocument,
  isTimingDecodersDocument,
  mergeLegacySetupDecoders,
  resolveTimingPointDecoderId,
  timingDecoderFromLegacyPoint,
  TIMING_CONNECTION_DOC_ID,
  TIMING_DECODERS_DOC_ID,
  TIMING_STATUS_DOC_ID,
  type LiveTrackingTimingPoint,
  type TimingConnectionDocument,
  type TimingDecoderStatus,
  type TimingDecodersDocument,
  type TimingPassingInput,
  type TimingStatusDocument,
} from "@raceoffice/domain";
import type { DecoderHealthPatch, NormalizedPassing } from "./decoder/adapters/decoderSourceAdapter.js";
import { normalizedToRuntimePassing } from "./decoder/adapters/normalizedPassing.js";
import { PassingHistoryWriter } from "./passingHistoryWriter.js";
import { RealtimeDocClient } from "./realtimeDocClient.js";
import { TimingConnectionManager, type DesiredDecoder } from "./timing/connectionManager.js";
import { TimingPassingUploader } from "./timing/passingUploader.js";

/** Decoder status is written at most this often (passings update it constantly). */
const TIMING_STATUS_FLUSH_MS = 500;

/** How often buffered passings are appended to the history document. */
const HISTORY_FLUSH_INTERVAL_MS = 1_000;

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
 */
function extractAthletesFromPoolDoc(pool: unknown): LiveTrackingAthlete[] {
  if (!pool || typeof pool !== "object" || Array.isArray(pool)) return [];

  if (isLiveTrackingParticipantPoolDocument(pool)) {
    return (pool as { athletes: LiveTrackingAthlete[] }).athletes ?? [];
  }

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

/** Old per-timing-point decoder state (runtime.decoders) from the timing-layer status. */
function legacyHealthPatch(status: TimingDecoderStatus): DecoderHealthPatch["patch"] {
  const map = {
    connected: { processStatus: "running", websocketStatus: "connected" },
    connecting: { processStatus: "starting", websocketStatus: "connecting" },
    error: { processStatus: "error", websocketStatus: "error" },
    disconnected: { processStatus: "stopped", websocketStatus: "disconnected" },
  } as const;
  return {
    ...map[status.connection],
    lastConnectedAt: status.connectedSince,
    lastMessageAt: status.lastMessageAt,
    lastError: status.lastError,
  };
}

export class SessionLoop {
  readonly sessionDocId: string;
  readonly runtimeDocId: string;
  readonly resultsDocId: string;
  readonly sessionClient: RealtimeDocClient<LiveTrackingSessionDocument>;
  readonly runtimeClient: RealtimeDocClient<LiveTrackingRuntimeDocument>;
  readonly resultsClient: RealtimeDocClient<LiveTrackingResultsDocument>;
  readonly historyClient: RealtimeDocClient<LiveTrackingPassingHistoryDocument>;
  private readonly historyWriter: PassingHistoryWriter;
  private historyFlushTimer: NodeJS.Timeout | null = null;
  private unsubscribeHistory: (() => void) | null = null;

  private setupClient: RealtimeDocClient<LiveTrackingSetupDocument> | null = null;
  private activeSetupDocId: string | null = null;
  private readonly participantPoolClients = new Map<string, RealtimeDocClient<LiveTrackingParticipantPoolDocument>>();
  private readonly unsubscribeParticipantPools = new Map<string, () => void>();

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private commandTimer: NodeJS.Timeout | null = null;
  private adapterSyncTimer: NodeJS.Timeout | null = null;
  private resultsTimer: NodeJS.Timeout | null = null;

  private readonly pendingRuntimeMutations: Array<(doc: LiveTrackingRuntimeDocument) => LiveTrackingRuntimeDocument> = [];
  private runtimeFlushPending = false;

  private unsubscribeSession: (() => void) | null = null;
  private unsubscribeRuntime: (() => void) | null = null;
  private unsubscribeSetup: (() => void) | null = null;

  private readonly workerHost = os.hostname();
  private readonly workerProcessId = process.pid;

  private lastSessionState: LiveTrackingSessionDocument["state"] | null = null;
  private lastWorkerStatus: LiveTrackingRuntimeDocument["workerStatus"] | null = null;
  private lastHandledWorkerStatusCheckRequestId: string | null = null;

  // Timing layer (doc/timing-architecture.md)
  readonly decodersClient: RealtimeDocClient<TimingDecodersDocument>;
  readonly connectionClient: RealtimeDocClient<TimingConnectionDocument>;
  readonly timingStatusClient: RealtimeDocClient<TimingStatusDocument>;
  private readonly connectionManager: TimingConnectionManager;
  private readonly uploader: TimingPassingUploader;
  private unsubscribeTiming: Array<() => void> = [];
  private timingStatusTimer: NodeJS.Timeout | null = null;

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
    this.historyClient = new RealtimeDocClient<LiveTrackingPassingHistoryDocument>(
      makeLiveTrackingPassingHistoryDocId(),
      baseHttpUrl,
    );
    this.historyWriter = new PassingHistoryWriter(this.historyClient);

    this.decodersClient = new RealtimeDocClient<TimingDecodersDocument>(TIMING_DECODERS_DOC_ID, baseHttpUrl);
    this.connectionClient = new RealtimeDocClient<TimingConnectionDocument>(TIMING_CONNECTION_DOC_ID, baseHttpUrl);
    this.timingStatusClient = new RealtimeDocClient<TimingStatusDocument>(TIMING_STATUS_DOC_ID, baseHttpUrl);
    this.uploader = new TimingPassingUploader(baseHttpUrl, { onWarning: (m) => this.appendRuntimeWarning(m) });
    this.connectionManager = new TimingConnectionManager({
      onPassing: (passing, normalized) => this.handleTimingPassing(passing, normalized),
      onStatusChange: () => this.scheduleTimingStatusFlush(),
      onWarning: (m) => this.appendRuntimeWarning(m),
    });
  }

  start() {
    this.sessionClient.connect();
    this.runtimeClient.connect();
    this.resultsClient.connect();
    this.historyClient.connect();
    this.decodersClient.connect();
    this.connectionClient.connect();
    this.timingStatusClient.connect();
    this.unsubscribeTiming = [
      this.decodersClient.onData(() => this.scheduleAdapterSync()),
      this.connectionClient.onData(() => this.scheduleAdapterSync()),
    ];

    this.unsubscribeHistory = this.historyClient.onData(() => {
      this.historyWriter.onDocumentChanged();
      this.scheduleUpdateResultsProjection();
    });

    this.unsubscribeSession = this.sessionClient.onData(() => {
      this.logSessionStateTransition();
      this.syncHeartbeatLifecycle();
      this.scheduleTickCommands();
      this.scheduleAdapterSync();
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
    this.scheduleAdapterSync();
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

    for (const unsub of this.unsubscribeTiming) unsub();
    this.unsubscribeTiming = [];
    void this.connectionManager.stop();
    void this.uploader.flush();
    this.uploader.stop();
    this.timingStatusClient.update((doc) => ({
      ...doc,
      workerHeartbeatAt: null,
      decoders: doc.decoders.map((d) => ({ ...d, connection: "disconnected", reasons: [], connectionSessionId: null, connectedSince: null })),
      updatedAt: nowIso(),
    }));

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

    // Best effort: write passings that are still buffered before the socket closes.
    this.historyWriter.flush();
    this.unsubscribeHistory?.();
    this.unsubscribeHistory = null;

    this.sessionClient.close();
    this.runtimeClient.close();
    this.resultsClient.close();
    this.historyClient.close();
    this.decodersClient.close();
    this.connectionClient.close();
    this.timingStatusClient.close();
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
    if (this.adapterSyncTimer) {
      clearTimeout(this.adapterSyncTimer);
      this.adapterSyncTimer = null;
    }
    if (this.resultsTimer) {
      clearTimeout(this.resultsTimer);
      this.resultsTimer = null;
    }
    if (this.historyFlushTimer) {
      clearTimeout(this.historyFlushTimer);
      this.historyFlushTimer = null;
    }
    if (this.timingStatusTimer) {
      clearTimeout(this.timingStatusTimer);
      this.timingStatusTimer = null;
    }
  }

  /** Flushes buffered passings at most once per interval; retries while some remain. */
  private scheduleHistoryFlush() {
    if (this.historyFlushTimer) return;
    this.historyFlushTimer = setTimeout(() => {
      this.historyFlushTimer = null;
      this.historyWriter.flush();
      if (this.historyWriter.hasPending()) this.scheduleHistoryFlush();
    }, HISTORY_FLUSH_INTERVAL_MS);
  }

  private scheduleTickCommands() {
    if (this.commandTimer) return;
    this.commandTimer = setTimeout(() => {
      this.commandTimer = null;
      this.tickCommands();
    }, 0);
  }

  private scheduleAdapterSync() {
    if (this.adapterSyncTimer) return;
    this.adapterSyncTimer = setTimeout(() => {
      this.adapterSyncTimer = null;
      this.syncAdapterLifecycle();
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
   * Reconciles the decoder connections of the timing layer.
   *
   * - Explicit: every decoder listed in `timingConnection` (nothing connects automatically).
   * - Phase 1 bridge: while the LiveTracking session is `running`, the decoders of its setup are
   *   connected too, exactly as before – the old control page has no "connect" button yet. Their
   *   configuration comes from the timing points of the setup (still edited there); they are
   *   also registered in the decoder register.
   */
  private syncAdapterLifecycle() {
    const session = this.sessionClient.data;
    const setup = this.ensureSetupClient();

    if (setup) {
      const enabledIds = new Set(
        normalizeTimingPoints(setup.track.timingPoints)
          .filter((p) => p.enabled)
          .map((p) => p.id),
      );
      this.pruneRuntimeDecoders(enabledIds);
    }

    const register = isTimingDecodersDocument(this.decodersClient.data) ? this.decodersClient.data : null;
    const desired = new Map<string, DesiredDecoder>();

    const connection = this.connectionClient.data;
    if (register && isTimingConnectionDocument(connection)) {
      for (const id of connection.connectedDecoderIds) {
        const decoder = findTimingDecoder(register, id);
        if (decoder) desired.set(id, { decoder, reasons: ["explicit"] });
      }
    }

    const running = !!session && isLiveTrackingSessionDocument(session) && session.state === "running";
    if (running && setup) {
      this.registerLegacySetupDecoders(setup);
      for (const point of normalizeTimingPoints(setup.track.timingPoints).filter((p) => p.enabled)) {
        const decoder = timingDecoderFromLegacyPoint(point, setup.decoderBackend);
        if (!decoder.ip) continue;
        const existing = desired.get(decoder.id);
        desired.set(decoder.id, { decoder, reasons: existing ? [...existing.reasons, "livetracking"] : ["livetracking"] });
      }
    }

    this.connectionManager.sync([...desired.values()]);
  }

  /** Adds the decoders of the setup to the register (only once it is loaded, never overwriting). */
  private registerLegacySetupDecoders(setup: LiveTrackingSetupDocument) {
    const current = this.decodersClient.data;
    if (current === null) return;
    const base = isTimingDecodersDocument(current) ? current : createTimingDecodersDocument();
    const merged = mergeLegacySetupDecoders(base, [setup], nowIso());
    if (merged !== base) this.decodersClient.update(() => merged);
  }

  /** Enabled timing points of the active setup that use this physical decoder. */
  private timingPointsOfDecoder(decoderId: string): LiveTrackingTimingPoint[] {
    const setup = this.setupClient?.data;
    if (!setup || !isLiveTrackingSetupDocument(setup)) return [];
    return normalizeTimingPoints(setup.track.timingPoints).filter(
      (p) => p.enabled && resolveTimingPointDecoderId(p, setup.decoderBackend) === decoderId,
    );
  }

  /**
   * A passing of a physical decoder: always stored in the timing passing store; additionally
   * mapped to the timing points of the setup for LiveTracking (passing log, and the history the
   * results are computed from – only while the session is running, as before).
   */
  private handleTimingPassing(passing: TimingPassingInput, normalized: NormalizedPassing) {
    this.uploader.add(passing);

    const session = this.sessionClient.data;
    const running = !!session && isLiveTrackingSessionDocument(session) && session.state === "running";
    for (const point of this.timingPointsOfDecoder(passing.decoderId)) {
      this.handleNormalizedPassing(
        {
          ...normalized,
          passingId: `${point.id}:${normalized.passingId}`,
          timingPointId: point.id,
          timestamp: applyTimingClockOffset(passing.decoderTime, point.decoderTimestampOffsetSecs ?? 0),
        },
        running,
      );
    }
  }

  private scheduleTimingStatusFlush() {
    if (this.timingStatusTimer) return;
    this.timingStatusTimer = setTimeout(() => {
      this.timingStatusTimer = null;
      this.flushTimingStatus();
    }, TIMING_STATUS_FLUSH_MS);
  }

  /** Writes the decoder status (timing layer) and mirrors it into runtime.decoders per timing point. */
  private flushTimingStatus() {
    const statuses = this.connectionManager.statusList;
    const t = nowIso();
    this.timingStatusClient.update((doc) => {
      const byId = new Map(doc.decoders.map((d) => [d.decoderId, d]));
      for (const status of statuses) byId.set(status.decoderId, status);
      return { ...doc, workerHeartbeatAt: t, decoders: [...byId.values()], updatedAt: t };
    });
    for (const status of statuses) {
      for (const point of this.timingPointsOfDecoder(status.decoderId)) {
        this.applyDecoderHealth({ timingPointId: point.id, decoderName: point.name, patch: legacyHealthPatch(status) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Adapter callbacks

  private handleNormalizedPassing(passing: NormalizedPassing, recordHistory: boolean) {
    const runtimePassing = normalizedToRuntimePassing(passing);
    const t = nowIso();

    // Decoder signals only go to the passing log; results need athlete passings only.
    if (recordHistory && !passing.signalKind) {
      this.historyWriter.append({
        id: runtimePassing.id,
        timestamp: runtimePassing.timestamp,
        transponderId: runtimePassing.transponderId,
        timingPointId: runtimePassing.timingPointId,
        decoderId: runtimePassing.decoderId,
      });
      this.scheduleHistoryFlush();
    }
    this.commitRuntimeUpdate((doc) => {
      let recentRawPayloads = doc.recentRawPayloads ?? [];
      if (typeof passing.raw === "string") {
        const entry: LiveTrackingRuntimeRawPayload = {
          receivedAt: t,
          timingPointId: passing.timingPointId,
          decoderId: passing.decoderId,
          payload: passing.raw,
        };
        recentRawPayloads = appendBounded(recentRawPayloads, entry, 50);
      }
      return {
        ...doc,
        recentPassings: appendBounded(doc.recentPassings ?? [], runtimePassing, 200),
        recentRawPayloads,
        updatedAt: t,
      };
    });
  }

  private applyDecoderHealth(update: DecoderHealthPatch) {
    const t = nowIso();
    this.commitRuntimeUpdate((doc) => {
      const decoders = [...(doc.decoders ?? [])];
      const index = decoders.findIndex((d) => d.timingPointId === update.timingPointId);

      const base: LiveTrackingRuntimeDocument["decoders"][number] =
        index >= 0
          ? decoders[index]!
          : {
              decoderId: update.decoderName,
              timingPointId: update.timingPointId,
              processStatus: "stopped",
              websocketStatus: "disconnected",
              lastConnectedAt: null,
              lastMessageAt: null,
              lastError: null,
            };

      const next: LiveTrackingRuntimeDocument["decoders"][number] = { ...base, ...update.patch };
      if (index >= 0) decoders[index] = next;
      else decoders.push(next);

      return { ...doc, decoders, updatedAt: t };
    });
  }

  // ---------------------------------------------------------------------------

  private pruneRuntimeDecoders(enabledTimingPointIds: Set<string>) {
    this.commitRuntimeUpdate((doc) => ({
      ...doc,
      decoders: (doc.decoders ?? []).filter((decoder) => enabledTimingPointIds.has(decoder.timingPointId)),
      updatedAt: nowIso(),
    }));
  }

  private hasRuntimeContentChanged(previous: LiveTrackingRuntimeDocument, next: LiveTrackingRuntimeDocument): boolean {
    const previousComparable = JSON.stringify({ ...previous, updatedAt: null });
    const nextComparable = JSON.stringify({ ...next, updatedAt: null });
    return previousComparable !== nextComparable;
  }

  /**
   * Queues a runtime mutation and flushes all pending mutations in a single patch
   * at the end of the current microtask queue. This prevents rev_mismatch errors
   * when multiple mutations (e.g. health update + passing) fire synchronously
   * in the same event handler — each would otherwise send a patch with the same
   * baseRev, causing the server to reject all but the first.
   */
  private commitRuntimeUpdate(buildNext: (doc: LiveTrackingRuntimeDocument) => LiveTrackingRuntimeDocument) {
    this.pendingRuntimeMutations.push(buildNext);
    if (!this.runtimeFlushPending) {
      this.runtimeFlushPending = true;
      queueMicrotask(() => this.flushRuntimeUpdates());
    }
  }

  private flushRuntimeUpdates() {
    this.runtimeFlushPending = false;
    if (this.pendingRuntimeMutations.length === 0) return;
    const mutations = this.pendingRuntimeMutations.splice(0);

    this.runtimeClient.update((doc) => {
      let current = doc;
      for (const mutation of mutations) {
        current = mutation(current);
      }
      return this.hasRuntimeContentChanged(doc, current) ? current : doc;
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
    this.scheduleTimingStatusFlush();
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
    if (!session || !isLiveTrackingSessionDocument(session)) return "ready";
    if (session.state === "running") return "running";
    if (session.state === "stopping") return "stopping";
    if (session.state === "error") return "error";
    return "ready";
  }

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
        isLiveTrackingWorkerStatusCheck(doc.workerStatusCheck) &&
        doc.workerStatusCheck.requestId === requestId;
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
        this.scheduleAdapterSync();
        this.scheduleUpdateResultsProjection();
      });
      this.activeSetupDocId = setupDocId;
    }

    const setup = this.setupClient?.data;
    if (!setup || !isLiveTrackingSetupDocument(setup)) return null;
    return setup;
  }

  private ensureParticipantPoolAthletes(): LiveTrackingAthlete[] | null {
    const setup = this.setupClient?.data;
    if (!setup || !isLiveTrackingSetupDocument(setup)) {
      for (const unsub of this.unsubscribeParticipantPools.values()) unsub();
      this.unsubscribeParticipantPools.clear();
      for (const client of this.participantPoolClients.values()) client.close();
      this.participantPoolClients.clear();
      return [];
    }

    const targetDocIds = new Set(
      (setup.activeParticipantPoolIds ?? []).map((id) => makeLiveTrackingParticipantPoolDocId(id)),
    );

    for (const [docId, client] of this.participantPoolClients) {
      if (!targetDocIds.has(docId)) {
        this.unsubscribeParticipantPools.get(docId)?.();
        this.unsubscribeParticipantPools.delete(docId);
        client.close();
        this.participantPoolClients.delete(docId);
      }
    }

    for (const docId of targetDocIds) {
      if (!this.participantPoolClients.has(docId)) {
        const client = new RealtimeDocClient<LiveTrackingParticipantPoolDocument>(docId, this.baseHttpUrl);
        client.connect();
        const unsub = client.onData(() => this.scheduleUpdateResultsProjection());
        this.participantPoolClients.set(docId, client);
        this.unsubscribeParticipantPools.set(docId, unsub);
      }
    }

    for (const docId of targetDocIds) {
      const client = this.participantPoolClients.get(docId);
      if (client && client.data === null) {
        console.log(`[livetracking-worker] pool snapshot pending: ${docId} — deferring projection`);
        return null;
      }
    }

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

    const athletes = this.ensureParticipantPoolAthletes();
    if (athletes === null) return;

    // Full session history (not the small runtime window), so no lap ever drops out.
    const passings = this.historyWriter.allPassings();
    if (passings === null) return;

    const warnings: string[] = [];

    if (session.participantSource.kind === "race") {
      warnings.push("race participant source projection is not connected yet; only participant-pool sources are supported.");
    }

    const timingOptions = { debounceMs: 2_000, ...deriveTimingOptions(setup) };

    if (athletes.length === 0 && (setup.activeParticipantPoolIds ?? []).length > 0) {
      const poolIds = (setup.activeParticipantPoolIds ?? []).join(", ");
      warnings.push(`[worker] No athletes loaded from active pool(s): ${poolIds}. Pool documents may be empty or still loading.`);
      console.warn(`[livetracking-worker] projection: 0 athletes from pools [${poolIds}], ${passings.length} passings, minLapTimeMs=${timingOptions.minLapTimeMs}`);
    } else {
      console.log(`[livetracking-worker] projection: ${athletes.length} athletes, ${passings.length} passings, minLapTimeMs=${timingOptions.minLapTimeMs}`);
    }

    const projected = buildLiveTrackingResultsProjection({
      passings,
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

  private appendRuntimeWarning(warning: string) {
    const t = nowIso();
    this.runtimeClient.update((doc) => ({
      ...doc,
      warnings: appendBounded(doc.warnings ?? [], warning, 100),
      updatedAt: t,
    }));
  }

  /**
   * Executes one command-queue tick.
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
    this.syncHeartbeatLifecycle(next);
    this.scheduleAdapterSync();
    this.scheduleUpdateResultsProjection();
  }
}
