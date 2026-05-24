import type { LiveTrackingTimingPoint } from "@raceoffice/domain";
import { normalizeTimingPoints } from "@raceoffice/domain";
import {
  P3DecoderConnection,
  type DecoderInfoEvent,
  type PassingEvent,
} from "@raceoffice/p3parser";
import type { DecoderHealthPatch, DecoderSourceAdapter, NormalizedPassing } from "../adapters/decoderSourceAdapter.js";

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
    for (const { connection } of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();
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

    for (const [id, { connection }] of this.connections) {
      if (!enabledIds.has(id)) {
        connection.disconnect();
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

    const managed: ManagedConnection = { point, connection: null! };

    const connection = new P3DecoderConnection(
      { ip: point.decoderIp, port: P3_PORT, label: point.decoderLabel || point.name },
      {
        onConnected: (info: DecoderInfoEvent) => this._onConnected(managed, info),
        onDisconnected: (reason: string) => this._onDisconnected(managed, reason),
        onPassing: (event: PassingEvent) => this._onPassing(managed, event),
        onStatus: () => {},
        onError: (error: Error) => this._onError(managed, error),
      },
      { autoReconnect: true, reconnectDelayMs: 3_000 },
    );

    managed.connection = connection;
    this.connections.set(point.id, managed);

    this._emitHealth(point, { processStatus: "starting", websocketStatus: "connecting" });
    await connection.connect();
  }

  private _onPassing(managed: ManagedConnection, event: PassingEvent): void {
    const { point } = managed;
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
    };

    this.callbacks.onPassing(normalized);
    this._emitHealth(point, { lastMessageAt: nowIso() });
  }

  private _onConnected(managed: ManagedConnection, info: DecoderInfoEvent): void {
    const { point } = managed;
    console.log(
      `[p3-adapter] connected: timingPoint=${point.id} ip=${point.decoderIp} decoderId=${info.decoderId} type=${info.decoderType} fw=${info.firmwareVersion}`,
    );
    this._emitHealth(point, {
      processStatus: "running",
      websocketStatus: "connected",
      lastConnectedAt: nowIso(),
      lastError: null,
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
      decoderLabel: point.decoderLabel,
      patch,
    });
  }
}
