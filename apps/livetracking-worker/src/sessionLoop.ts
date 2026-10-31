/**
 * Session loop for the LiveTracking worker.
 *
 * Responsibilities (single orchestration point):
 * - keep live subscriptions to session/runtime/results/setup/participants documents
 * - execute the session command queue (start/stop/reset): measurement windows on the timing
 *   passing store (doc/timing-architecture.md)
 * - timing layer: connect exactly the decoders listed in timingConnection (explicit, never
 *   automatic), upload every passing to the timing passing store, publish the decoder status
 * - LiveTracking as consumer: read the passings of the measurement window from the store and map
 *   them through the setup to timing points (TimingPassingFeed + toTimingPointPassings)
 * - continuously project sporting results from those passings + setup + participant pool
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
  type LiveTrackingAthlete,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingResultsDocument,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  applyLiveTrackingMeasurementCommand,
  getLiveTrackingMeasurementFromSeq,
  getSetupDecoderIds,
  isSeqInLiveTrackingMeasurement,
  normalizeLiveTrackingSessionDocument,
  toTimingPointPassings,
  createTimingDecodersDocument,
  findTimingDecoder,
  isTimingConnectionDocument,
  isTimingDecodersDocument,
  mergeLegacySetupDecoders,
  TIMING_CONNECTION_DOC_ID,
  TIMING_DECODERS_DOC_ID,
  TIMING_STATUS_DOC_ID,
  type LiveTrackingCommandIntent,
  type TimingConnectionDocument,
  type TimingDecodersDocument,
  type TimingPassingInput,
  type TimingStatusDocument,
} from "@raceoffice/domain";
import { RealtimeDocClient } from "./realtimeDocClient.js";
import { TimingConnectionManager, type DesiredDecoder } from "./timing/connectionManager.js";
import { TimingPassingFeed } from "./timing/passingFeed.js";
import { TimingPassingUploader } from "./timing/passingUploader.js";

/** Decoder status is written at most this often (passings update it constantly). */
const TIMING_STATUS_FLUSH_MS = 500;


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


export class SessionLoop {
  readonly sessionDocId: string;
  readonly runtimeDocId: string;
  readonly resultsDocId: string;
  readonly sessionClient: RealtimeDocClient<LiveTrackingSessionDocument>;
  readonly runtimeClient: RealtimeDocClient<LiveTrackingRuntimeDocument>;
  readonly resultsClient: RealtimeDocClient<LiveTrackingResultsDocument>;

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
  /** Passings of the measurement window (LiveTracking as consumer of the passing store). */
  private readonly passingFeed: TimingPassingFeed;
  /** A command is being executed (it needs the store seq, fetched asynchronously). */
  private commandInFlight = false;
  /**
   * Commands already executed. The own session update arrives only after the server confirmed
   * it; until then the command still looks "running" and must not be executed a second time.
   */
  private readonly executedCommandIds = new Set<string>();

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
    this.passingFeed = new TimingPassingFeed(baseHttpUrl, () => this.scheduleUpdateResultsProjection());

    this.decodersClient = new RealtimeDocClient<TimingDecodersDocument>(TIMING_DECODERS_DOC_ID, baseHttpUrl);
    this.connectionClient = new RealtimeDocClient<TimingConnectionDocument>(TIMING_CONNECTION_DOC_ID, baseHttpUrl);
    this.timingStatusClient = new RealtimeDocClient<TimingStatusDocument>(TIMING_STATUS_DOC_ID, baseHttpUrl);
    this.uploader = new TimingPassingUploader(baseHttpUrl, { onWarning: (m) => this.appendRuntimeWarning(m) });
    this.connectionManager = new TimingConnectionManager(
      {
        onPassing: (passing) => this.handleTimingPassing(passing),
        onStatusChange: () => this.scheduleTimingStatusFlush(),
        onWarning: (m) => this.appendRuntimeWarning(m),
      },
      { fetchResumePoint: (decoderId) => this.fetchHighestPassingNumber(decoderId) },
    );
  }

  start() {
    this.sessionClient.connect();
    this.runtimeClient.connect();
    this.resultsClient.connect();
    this.decodersClient.connect();
    this.connectionClient.connect();
    this.timingStatusClient.connect();
    this.unsubscribeTiming = [
      this.decodersClient.onData(() => this.scheduleAdapterSync()),
      this.connectionClient.onData(() => this.scheduleAdapterSync()),
    ];


    this.unsubscribeSession = this.sessionClient.onData(() => {
      if (this.migrateSessionDocument()) return;
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

    this.passingFeed.close();

    this.sessionClient.close();
    this.runtimeClient.close();
    this.resultsClient.close();
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
    if (this.timingStatusTimer) {
      clearTimeout(this.timingStatusTimer);
      this.timingStatusTimer = null;
    }
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
   * Reconciles the decoder connections of the timing layer: exactly the decoders listed in
   * `timingConnection`. Nothing connects automatically – decoders accept only few connections
   * (doc/timing-architecture.md, 5.1). The LiveTracking session no longer connects anything.
   */
  private syncAdapterLifecycle() {
    const setup = this.ensureSetupClient();
    // Decoders of the active setup appear in the register (and thus in the hardware view).
    if (setup) this.registerLegacySetupDecoders(setup);

    const register = isTimingDecodersDocument(this.decodersClient.data) ? this.decodersClient.data : null;
    const desired: DesiredDecoder[] = [];
    const connection = this.connectionClient.data;
    if (register && isTimingConnectionDocument(connection)) {
      for (const id of connection.connectedDecoderIds) {
        const decoder = findTimingDecoder(register, id);
        if (decoder) desired.push({ decoder, reasons: ["explicit"] });
      }
    }
    this.connectionManager.sync(desired);
  }

  /** Adds the decoders of the setup to the register (only once it is loaded, never overwriting). */
  private registerLegacySetupDecoders(setup: LiveTrackingSetupDocument) {
    const current = this.decodersClient.data;
    if (current === null) return;
    const base = isTimingDecodersDocument(current) ? current : createTimingDecodersDocument();
    const merged = mergeLegacySetupDecoders(base, [setup], nowIso());
    if (merged !== base) this.decodersClient.update(() => merged);
  }


  /** A passing of a physical decoder: stored in the timing passing store (consumers read it there). */
  private handleTimingPassing(passing: TimingPassingInput) {
    this.uploader.add(passing);
  }

  /** Highest passing number stored for the decoder (timing store), null if unknown. */
  private async fetchHighestPassingNumber(decoderId: string): Promise<number | null> {
    const res = await fetch(`${this.baseHttpUrl}/timing/passings/stats`);
    if (!res.ok) return null;
    const stats = (await res.json()) as { decoders?: Array<{ decoderId: string; maxPassingNumber: number | null }> };
    return stats.decoders?.find((d) => d.decoderId === decoderId)?.maxPassingNumber ?? null;
  }

  private scheduleTimingStatusFlush() {
    if (this.timingStatusTimer) return;
    this.timingStatusTimer = setTimeout(() => {
      this.timingStatusTimer = null;
      this.flushTimingStatus();
    }, TIMING_STATUS_FLUSH_MS);
  }

  /** Writes the decoder status of the timing layer. */
  private flushTimingStatus() {
    const statuses = this.connectionManager.statusList;
    const t = nowIso();
    this.timingStatusClient.update((doc) => {
      const byId = new Map(doc.decoders.map((d) => [d.decoderId, d]));
      for (const status of statuses) byId.set(status.decoderId, status);
      return { ...doc, workerHeartbeatAt: t, decoders: [...byId.values()], updatedAt: t };
    });
  }

  // ---------------------------------------------------------------------------
  // Adapter callbacks



  // ---------------------------------------------------------------------------


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

    // Passings of the measurement window, read from the timing passing store and mapped
    // through the setup to timing points. Without measurement the results are empty.
    const measurement = session.measurement ?? null;
    this.passingFeed.configure(getSetupDecoderIds(setup), getLiveTrackingMeasurementFromSeq(measurement));
    if (measurement && !this.passingFeed.isLive) return; // catch-up still running
    const register = isTimingDecodersDocument(this.decodersClient.data) ? this.decodersClient.data : null;
    const inWindow = this.passingFeed.passings.filter((p) => isSeqInLiveTrackingMeasurement(p.seq, measurement));
    const passings = toTimingPointPassings(inWindow, setup, register);

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
   * Executes one command-queue tick: starts the next queued command and runs it. Commands need
   * the current last seq of the timing passing store (the measurement window boundary), so the
   * execution is asynchronous; one command at a time.
   */
  private tickCommands() {
    if (this.commandInFlight) return;
    const session = this.sessionClient.data;
    if (!session || !isLiveTrackingSessionDocument(session)) return;

    const t = nowIso();
    let next = session;
    if (!getRunningLiveTrackingCommand(next)) {
      const queued = getNextQueuedLiveTrackingCommand(next);
      if (queued) next = startLiveTrackingCommand(next, queued.id, t);
    }
    const active = getRunningLiveTrackingCommand(next);
    this.commitIfChanged(session, next);
    if (!active || this.executedCommandIds.has(active.id)) return;
    this.executedCommandIds.add(active.id);

    this.commandInFlight = true;
    void this.executeCommand(active.id, active.intent).finally(() => {
      this.commandInFlight = false;
      this.scheduleTickCommands();
    });
  }

  private async executeCommand(commandId: string, intent: LiveTrackingCommandIntent) {
    let lastSeq: number;
    try {
      lastSeq = await this.fetchLastSeq();
    } catch (err) {
      const message = `${intent} failed: passing store unreachable (${err instanceof Error ? err.message : String(err)})`;
      this.applySessionUpdate((s) =>
        failLiveTrackingCommand(s, { commandId, processedAt: nowIso(), message, nextState: "error", updatedAt: nowIso() }),
      );
      return;
    }
    const t = nowIso();
    this.applySessionUpdate((s) => {
      const running = s.state === "running";
      const nextState = intent === "start" ? "running" : intent === "stop" ? "idle" : running ? "running" : "idle";
      const measurement = applyLiveTrackingMeasurementCommand(s.measurement, intent, { lastSeq, at: t, running });
      return completeLiveTrackingCommand(
        { ...s, measurement, desiredState: nextState },
        { commandId, processedAt: t, nextState, updatedAt: t },
      );
    });
  }

  private applySessionUpdate(mutate: (s: LiveTrackingSessionDocument) => LiveTrackingSessionDocument) {
    const before = this.sessionClient.data;
    if (!before || !isLiveTrackingSessionDocument(before)) return;
    this.commitIfChanged(before, mutate(before));
  }

  /** Current last seq of the timing passing store (start/stop boundary of a measurement). */
  private async fetchLastSeq(): Promise<number> {
    const res = await fetch(`${this.baseHttpUrl}/timing/passings/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = (await res.json()) as { lastSeq?: unknown };
    if (typeof stats.lastSeq !== "number") throw new Error("no lastSeq");
    return stats.lastSeq;
  }

  /** Session documents of older versions (prepare/ready/stopping) are migrated in place. */
  private migrateSessionDocument(): boolean {
    const data = this.sessionClient.data;
    if (!data || isLiveTrackingSessionDocument(data)) return false;
    const migrated = normalizeLiveTrackingSessionDocument(data);
    if (!migrated) return false;
    console.log("[livetracking-worker] migrating session document from an older version");
    this.sessionClient.update(() => migrated);
    return true;
  }

  private commitIfChanged(previous: LiveTrackingSessionDocument, next: LiveTrackingSessionDocument) {
    if (previous === next) return;
    this.sessionClient.update(() => next);
    this.syncHeartbeatLifecycle(next);
    this.scheduleAdapterSync();
    this.scheduleUpdateResultsProjection();
  }
}
