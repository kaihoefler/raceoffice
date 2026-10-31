import type { LiveTrackingTimingPoint } from "@raceoffice/domain";
import { normalizeTimingPoints } from "@raceoffice/domain";
import {
  decoderIdToRequestOrder,
  P3DecoderConnection,
  type P3Record,
  type DecoderInfoEvent,
  type DecoderStatusEvent,
  type PassingEvent,
} from "@raceoffice/p3parser";
import type { DecoderHealthPatch, DecoderSourceAdapter, NormalizedPassing } from "../adapters/decoderSourceAdapter.js";
import { PassingSequenceTracker, type PassingRange } from "./passingSequenceTracker.js";

/** How often timed-out RESEND requests are checked. */
const RESEND_CHECK_MS = 2_000;
/** SESSION waits this long for the resume point (highest stored passing number). */
const RESUME_WAIT_MS = 3_000;

const P3_PORT = 5403;

function nowIso(): string {
  return new Date().toISOString();
}

function applyTimestampOffset(date: Date, offsetSecs: number): string {
  return new Date(date.getTime() + offsetSecs * 1000).toISOString();
}

type P3AdapterCallbacks = {
  onPassing: (passing: NormalizedPassing) => void;
  onWarning: (message: string) => void;
  onHealth: (update: DecoderHealthPatch) => void;
};

type ManagedConnection = {
  point: LiveTrackingTimingPoint;
  connection: P3DecoderConnection;
  /** Detects gaps in the passing numbers and decides what to request again (RESEND). */
  tracker: PassingSequenceTracker;
  /** Decoder id as reported on connect (display order); needed for SESSION/RESEND. */
  hardwareId: string | null;
  resendTimer: ReturnType<typeof setInterval> | null;
  /** The resume point is known (or waiting for it timed out). */
  resumeKnown: boolean;
  /** SESSION already sent for the current connection. */
  sessionAsked: boolean;
  sessionTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * DecoderSourceAdapter für das P3-Backend (MYLAPS P3-Protokoll, TCP Port 5403).
 *
 * Nutzt P3DecoderConnection direkt (statt P3DecoderPool), damit der Timing-Point
 * im Closure gebunden ist — keine hwId-to-IP-Auflösung nötig und kein Race
 * zwischen VERSION_DECODER und dem ersten Passing.
 */
export class P3ParserDecoderSourceAdapter implements DecoderSourceAdapter {
  private timingPoints: LiveTrackingTimingPoint[];
  private readonly callbacks: P3AdapterCallbacks;

  private readonly connections = new Map<string, ManagedConnection>(); // keyed by timingPoint.id
  /** Resume points given before the connection object existed. */
  private readonly pendingResume = new Map<string, number | null>();
  private started = false;

  constructor(timingPoints: LiveTrackingTimingPoint[], callbacks: P3AdapterCallbacks) {
    this.timingPoints = timingPoints;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const enabledPoints = normalizeTimingPoints(this.timingPoints).filter((p) => p.enabled);
    await Promise.all(enabledPoints.map((point) => this._openConnection(point)));
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const managed of this.connections.values()) this._close(managed);
    this.connections.clear();
  }

  /**
   * Highest passing number already stored for this decoder: after the next connect, everything
   * the decoder numbered since then is requested again (catch-up after an outage).
   */
  resumeFrom(configId: string, highestPassingNumber: number | null): void {
    this.pendingResume.set(configId, highestPassingNumber);
    const managed = this.connections.get(configId);
    if (!managed) return;
    managed.tracker.resumeFrom(highestPassingNumber);
    managed.resumeKnown = true;
    this._askSession(managed);
  }

  onPassing(cb: (passing: NormalizedPassing) => void): void {
    (this.callbacks as { onPassing: typeof cb }).onPassing = cb;
  }

  onWarning(cb: (message: string) => void): void {
    (this.callbacks as { onWarning: typeof cb }).onWarning = cb;
  }

  onHealth(cb: (update: DecoderHealthPatch) => void): void {
    (this.callbacks as { onHealth: typeof cb }).onHealth = cb;
  }

  syncPoints(points: LiveTrackingTimingPoint[]): void {
    this.timingPoints = points;
    if (!this.started) return;

    const enabledPoints = normalizeTimingPoints(points).filter((p) => p.enabled);
    const enabledIds = new Set(enabledPoints.map((p) => p.id));

    for (const [id, managed] of this.connections) {
      if (!enabledIds.has(id)) {
        this._close(managed);
        this.connections.delete(id);
      }
    }

    for (const point of enabledPoints) {
      const existing = this.connections.get(point.id);
      if (existing) {
        // Konfigurationsänderungen (z.B. offset) übernehmen ohne reconnect
        existing.point = point;
        continue;
      }
      this._openConnection(point).catch((err: unknown) => {
        this.callbacks.onWarning(
          `[p3-adapter] connect failed for timingPoint=${point.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // ---------------------------------------------------------------------------

  private async _openConnection(point: LiveTrackingTimingPoint): Promise<void> {
    if (this.connections.has(point.id)) return;

    const tracker = new PassingSequenceTracker();
    tracker.resumeFrom(this.pendingResume.get(point.id) ?? null);
    const managed: ManagedConnection = {
      point,
      connection: null!,
      tracker,
      hardwareId: null,
      resendTimer: null,
      resumeKnown: this.pendingResume.has(point.id),
      sessionAsked: false,
      sessionTimer: null,
    };

    const connection = new P3DecoderConnection(
      { ip: point.decoderIp, port: P3_PORT, label: point.name },
      {
        onConnected: (info: DecoderInfoEvent) => this._onConnected(managed, info),
        onDisconnected: (reason: string) => this._onDisconnected(managed, reason),
        onPassing: (event: PassingEvent) => this._onPassing(managed, event),
        onStatus: (status: DecoderStatusEvent) => this._onStatus(managed, status),
        onError: (error: Error) => this._onError(managed, error),
        onRawRecord: (record: P3Record) => this._onRawRecord(managed, record),
      },
      { autoReconnect: true, reconnectDelayMs: 3_000 },
    );

    managed.connection = connection;
    managed.resendTimer = setInterval(() => this._requestAgain(managed, managed.tracker.due(Date.now())), RESEND_CHECK_MS);
    this.connections.set(point.id, managed);

    this._emitHealth(point, { processStatus: "starting", websocketStatus: "connecting" });
    await connection.connect();
  }

  private _onPassing(managed: ManagedConnection, event: PassingEvent): void {
    const { point } = managed;
    // Every passing record (also sync pulses) takes a number: gaps are requested again.
    this._requestAgain(managed, managed.tracker.onPassing(event.passingNumber, Date.now()));

    // Sync pulses only keep decoders in step; they carry no athlete and would
    // otherwise crowd real passings out of the bounded recentPassings buffer.
    if (event.specialKind === "sync_pulse") {
      this._emitHealth(point, { lastMessageAt: nowIso() });
      return;
    }

    const offsetSecs = point.decoderTimestampOffsetSecs ?? 0;

    const timestamp = applyTimestampOffset(event.time, offsetSecs);
    const normalized: NormalizedPassing = {
      passingId: `${point.id}:${event.decoderId}:${timestamp}:${event.transponderId}:${String(event.passingNumber)}`,
      timestamp,
      passingTimeSource: event.timeSource,
      passingNumber: event.passingNumber,
      transponderId: event.transponderId,
      transponderType: event.transponderType,
      decoderId: event.decoderId,
      timingPointId: point.id,
      signalStrength: event.signalStrength,
      hits: event.hits,
      lowBattery: event.lowBattery,
      backend: "p3parser",
      // Switch / FinishCamStart are kept as start signals for the passing log.
      // Open point: mapping of these IDs to real start signals is not yet verified on hardware.
      ...(event.specialKind ? { signalKind: "start_signal" as const } : {}),
    };

    this.callbacks.onPassing(normalized);
    this._emitHealth(point, { lastMessageAt: nowIso() });
  }

  private _onConnected(managed: ManagedConnection, info: DecoderInfoEvent): void {
    const { point } = managed;
    managed.hardwareId = info.decoderId;
    // Ask for the last passing index (everything numbered while we were away is requested) –
    // once the highest stored number is known, so the catch-up starts at the right place.
    managed.sessionAsked = false;
    if (managed.sessionTimer) clearTimeout(managed.sessionTimer);
    managed.sessionTimer = managed.resumeKnown
      ? null
      : setTimeout(() => {
          managed.resumeKnown = true;
          this._askSession(managed);
        }, RESUME_WAIT_MS);
    this._askSession(managed);
    console.log(
      `[p3-adapter] connected: timingPoint=${point.id} ip=${point.decoderIp} decoderId=${info.decoderId} type=${info.decoderType} fw=${info.firmwareVersion}`,
    );
    this._emitHealth(point, {
      processStatus: "running",
      websocketStatus: "connected",
      lastConnectedAt: nowIso(),
      lastError: null,
      hardware: { hardwareId: info.decoderId, decoderType: info.decoderType || null, firmwareVersion: info.firmwareVersion || null },
    });
  }

  /** SESSION answer: last passing index of the decoder → catch-up of missed passings. */
  private _onRawRecord(managed: ManagedConnection, record: P3Record): void {
    if (record.kind !== "session" || typeof record.lastPassingIndex !== "number") return;
    this._requestAgain(managed, managed.tracker.onSession(record.lastPassingIndex, Date.now()));
  }

  /** Sends RESEND requests for missing passing numbers and reports the counters. */
  private _requestAgain(managed: ManagedConnection, ranges: PassingRange[]): void {
    if (ranges.length > 0 && managed.hardwareId && managed.connection.state === "connected") {
      const decoderId = decoderIdToRequestOrder(managed.hardwareId);
      for (const range of ranges) {
        console.warn(`[p3-adapter] requesting passings ${range.from}-${range.to} again: timingPoint=${managed.point.id}`);
        managed.connection.requestPassings(decoderId, range.from, range.to);
      }
    }
    if (ranges.length > 0) this._emitHealth(managed.point, { sequence: managed.tracker.snapshot });
  }

  private _askSession(managed: ManagedConnection): void {
    if (managed.sessionAsked || !managed.resumeKnown || !managed.hardwareId) return;
    if (managed.connection.state !== "connected") return;
    managed.sessionAsked = true;
    managed.connection.requestSession(decoderIdToRequestOrder(managed.hardwareId));
  }

  private _close(managed: ManagedConnection): void {
    if (managed.resendTimer) clearInterval(managed.resendTimer);
    if (managed.sessionTimer) clearTimeout(managed.sessionTimer);
    managed.resendTimer = null;
    managed.sessionTimer = null;
    managed.connection.disconnect();
  }

  /** P3 STATUS records (sent periodically): device health for the hardware status view. */
  private _onStatus(managed: ManagedConnection, status: DecoderStatusEvent): void {
    const t = nowIso();
    this._emitHealth(managed.point, {
      lastMessageAt: t,
      device: {
        noise: Number.isFinite(status.noise) ? status.noise : null,
        gpsLocked: typeof status.gpsLocked === "boolean" ? status.gpsLocked : null,
        temperatureC: Number.isFinite(status.temperature) ? status.temperature : null,
        voltage: Number.isFinite(status.voltage) ? status.voltage : null,
        at: t,
      },
    });
  }

  private _onDisconnected(managed: ManagedConnection, reason: string): void {
    const { point } = managed;
    console.warn(`[p3-adapter] disconnected: timingPoint=${point.id} ip=${point.decoderIp} reason=${reason}`);
    this._emitHealth(point, { processStatus: "stopped", websocketStatus: "disconnected" });
  }

  private _onError(managed: ManagedConnection, error: Error): void {
    const { point } = managed;
    console.error(`[p3-adapter] error: timingPoint=${point.id} ip=${point.decoderIp}: ${error.message}`);
    this._emitHealth(point, { websocketStatus: "error", lastError: error.message });
  }

  private _emitHealth(point: LiveTrackingTimingPoint, patch: DecoderHealthPatch["patch"]): void {
    this.callbacks.onHealth({
      timingPointId: point.id,
      decoderName: point.name,
      patch,
    });
  }
}
