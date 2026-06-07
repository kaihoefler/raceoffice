import WebSocket from "ws";
import type { LiveTrackingTimingPoint } from "@raceoffice/domain";
import { normalizeTimingPoints } from "@raceoffice/domain";
import { explodeAmmPayloads, normalizeAmmPayloadToPassing } from "../ammc/ammParser.js";
import { AmmcProcessManager } from "../ammc/ammcProcessManager.js";
import type { DecoderHealthPatch, DecoderSourceAdapter, NormalizedPassing } from "./decoderSourceAdapter.js";

function nowIso(): string {
  return new Date().toISOString();
}

type AmmConnection = {
  timingPoint: LiveTrackingTimingPoint;
  socket: WebSocket;
};

type AmmcAdapterCallbacks = {
  onPassing: (passing: NormalizedPassing) => void;
  onWarning: (message: string) => void;
  onHealth: (update: DecoderHealthPatch) => void;
};

/**
 * DecoderSourceAdapter für das AMMC-Backend.
 *
 * Kapselt AmmcProcessManager + WebSocket-Verbindungen pro Timing-Point.
 * Liefert NormalizedPassing über den onPassing-Callback.
 */
export class AmmcDecoderSourceAdapter implements DecoderSourceAdapter {
  private timingPoints: LiveTrackingTimingPoint[];
  private readonly callbacks: AmmcAdapterCallbacks;
  private readonly ammcProcessManager: AmmcProcessManager;

  private readonly ammConnections = new Map<string, AmmConnection>();
  private readonly pendingConnectTimers = new Map<string, NodeJS.Timeout>();
  private started = false;

  constructor(timingPoints: LiveTrackingTimingPoint[], callbacks: AmmcAdapterCallbacks) {
    this.timingPoints = timingPoints;
    this.callbacks = callbacks;

    this.ammcProcessManager = new AmmcProcessManager({
      onStatus: (point, patch) => {
        if (patch.processStatus === "error") {
          console.error(
            `[ammc-adapter] process error for timingPoint=${point.id}: ${patch.lastError ?? "unknown"}`,
          );
        }
        this._emitHealth(point, patch);
        this._triggerSync();
        if (patch.processStatus === "error" || patch.processStatus === "stopped") {
          setTimeout(() => this._triggerSync(), 2500);
        }
      },
      onWarning: (warning) => {
        console.warn(`[ammc-adapter] ${warning}`);
        this.callbacks.onWarning(warning);
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this._sync();
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const [id] of this.pendingConnectTimers) this._clearPendingTimer(id);
    for (const [id] of this.ammConnections) this._disconnectAmm(id);
    this.ammcProcessManager.stopAll();
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

  /**
   * Aktualisiert die verwalteten Timing-Points (z.B. bei Setup-Änderungen während laufender Session).
   * Führt sofort einen Sync durch wenn der Adapter gestartet ist.
   */
  syncPoints(points: LiveTrackingTimingPoint[]): void {
    this.timingPoints = points;
    if (this.started) this._sync();
  }

  // ---------------------------------------------------------------------------

  private _triggerSync() {
    // Use setTimeout to break synchronous recursion: onStatus("starting") fires
    // before processes.set() in ensure(), so a direct _sync() call would re-enter
    // ensure() with processes.has() = false and loop until stack overflow.
    setTimeout(() => {
      if (this.started) this._sync();
    }, 0);
  }

  private _sync() {
    const enabledPoints = normalizeTimingPoints(this.timingPoints).filter((p) => p.enabled);
    const enabledIds = new Set(enabledPoints.map((p) => p.id));

    this.ammcProcessManager.sync(enabledPoints);

    for (const [id] of this.pendingConnectTimers) {
      if (!enabledIds.has(id) || !this.ammcProcessManager.isRunning(id)) {
        this._clearPendingTimer(id);
      }
    }

    for (const [id] of this.ammConnections) {
      if (!enabledIds.has(id) || !this.ammcProcessManager.isRunning(id)) {
        this._disconnectAmm(id);
      }
    }

    for (const point of enabledPoints) {
      if (!this.ammcProcessManager.isRunning(point.id)) continue;
      if (this.ammConnections.has(point.id)) continue;
      this._scheduleConnectAmm(point);
    }
  }

  private _clearPendingTimer(timingPointId: string) {
    const timer = this.pendingConnectTimers.get(timingPointId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingConnectTimers.delete(timingPointId);
  }

  private _scheduleConnectAmm(point: LiveTrackingTimingPoint) {
    if (this.pendingConnectTimers.has(point.id)) return;

    const delayMs = 1_000;
    const timer = setTimeout(() => {
      this.pendingConnectTimers.delete(point.id);
      if (!this.started) return;
      if (!this.ammcProcessManager.isRunning(point.id)) return;
      if (this.ammConnections.has(point.id)) return;
      this._connectAmm(point);
    }, delayMs);

    this.pendingConnectTimers.set(point.id, timer);
  }

  private _connectAmm(point: LiveTrackingTimingPoint) {
    const url = `ws://127.0.0.1:${point.websocketPortAMM}`;
    console.log(`[ammc-adapter] connecting to AMMC websocket for timingPoint=${point.id}: ${url}`);
    const socket = new WebSocket(url);
    this.ammConnections.set(point.id, { timingPoint: point, socket });

    this._emitHealth(point, { websocketStatus: "connecting" });

    socket.on("open", () => {
      this._emitHealth(point, { websocketStatus: "connected", lastConnectedAt: nowIso(), lastError: null });
    });

    socket.on("message", (raw) => {
      this._handleAmmMessage(point, raw);
    });

    socket.on("error", (err) => {
      const message = err instanceof Error ? err.message : "AMM websocket error";
      console.error(`[ammc-adapter] websocket error for timingPoint=${point.id}: ${message}`);
      this._emitHealth(point, { processStatus: "error", websocketStatus: "error", lastError: message });
    });

    socket.on("close", (code, reason) => {
      console.warn(
        `[ammc-adapter] websocket closed for timingPoint=${point.id} (code=${String(code)}, reason=${reason.toString("utf8") || "n/a"})`,
      );
      this._emitHealth(point, { websocketStatus: "disconnected" });
      this.ammConnections.delete(point.id);
      if (this.started) {
        setTimeout(() => this._triggerSync(), 2_500);
      }
    });
  }

  private _disconnectAmm(timingPointId: string) {
    this._clearPendingTimer(timingPointId);
    const connection = this.ammConnections.get(timingPointId);
    if (!connection) return;
    connection.socket.close();
    this.ammConnections.delete(timingPointId);
    this._emitHealth(connection.timingPoint, { websocketStatus: "disconnected" });
  }

  private _handleAmmMessage(point: LiveTrackingTimingPoint, raw: WebSocket.RawData) {
    const receivedAt = nowIso();
    const rawText = typeof raw === "string" ? raw : raw.toString("utf8");

    console.log(`[ammc-adapter] ws msg for timingPoint=${point.id}: ${rawText.slice(0, 400)}`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      this._emitHealth(point, { websocketStatus: "error", lastError: "Invalid AMM JSON payload" });
      return;
    }

    this._emitHealth(point, { lastMessageAt: receivedAt });

    for (const item of explodeAmmPayloads(parsed)) {
      const result = normalizeAmmPayloadToPassing({ payload: item, timingPoint: point });
      if (!result) {
        console.log(`[ammc-adapter] parse failed for timingPoint=${point.id}:`, JSON.stringify(item));
        continue;
      }

      for (const warning of result.warnings) {
        this.callbacks.onWarning(`[${point.id}] ${warning}`);
      }

      const normalized: NormalizedPassing = {
        passingId: result.passing.id,
        timestamp: result.passing.timestamp,
        transponderId: result.passing.transponderId,
        timingPointId: result.passing.timingPointId,
        decoderId: result.passing.decoderId,
        passingNumber: result.passingNumber,
        transponderType: "tranx",
        signalStrength: 0,
        hits: 0,
        lowBattery: false,
        backend: "ammc",
        raw: rawText,
      };

      console.log(`[ammc-adapter] passing emitted: timingPoint=${point.id}, transponder=${normalized.transponderId}, ts=${normalized.timestamp}`);
      this.callbacks.onPassing(normalized);
    }
  }

  private _emitHealth(
    point: LiveTrackingTimingPoint,
    patch: DecoderHealthPatch["patch"],
  ) {
    this.callbacks.onHealth({
      timingPointId: point.id,
      decoderName: point.name,
      patch,
    });
  }
}
