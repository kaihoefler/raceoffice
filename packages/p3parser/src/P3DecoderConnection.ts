import net from "node:net";

import {
  buildGetTimeRequest,
  buildResendRequest,
  buildSessionRequest,
  toNodeBuffer,
  type P3BuiltRequest,
} from "./builder.js";
import type {
  ConnectionState,
  DecoderConfig,
  DecoderInfoEvent,
  DecoderStatusEvent,
  PassingEvent,
} from "./clientTypes.js";
import { P3StreamDecoder } from "./stream.js";
import type { P3PassingRecord, P3Record, P3StatusRecord, P3VersionDecoderRecord } from "./types.js";

const DEFAULT_PORT = 5403;
const DEFAULT_RECONNECT_DELAY_MS = 3000;

export type ConnectionOptions = {
  /** Automatically reconnect after connection loss. Default: true */
  autoReconnect?: boolean;
  /** Milliseconds to wait before each reconnect attempt. Default: 3000 */
  reconnectDelayMs?: number;
};

export type DecoderConnectionCallbacks = {
  /** Called when VERSION_DECODER is received (decoder identified itself). */
  onConnected: (info: DecoderInfoEvent) => void;
  onDisconnected: (reason: string) => void;
  onPassing: (event: PassingEvent) => void;
  onStatus: (event: DecoderStatusEvent) => void;
  onError: (error: Error) => void;
  /** Escape hatch: direct access to every parsed P3 record before translation. */
  onRawRecord?: (record: P3Record) => void;
};

export class P3DecoderConnection {
  private readonly config: DecoderConfig;
  private readonly callbacks: DecoderConnectionCallbacks;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;

  private socket: net.Socket | null = null;
  private stream = new P3StreamDecoder();
  private _state: ConnectionState = "disconnected";
  private _decoderId: string | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    config: DecoderConfig,
    callbacks: DecoderConnectionCallbacks,
    options: ConnectionOptions = {},
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  connect(): Promise<void> {
    if (this._state !== "disconnected") return Promise.resolve();
    return this._doConnect();
  }

  disconnect(): void {
    this.destroyed = true;
    this._clearReconnectTimer();
    this._teardown("disconnect requested");
  }

  requestTime(): void {
    this._write(buildGetTimeRequest());
  }

  requestSession(decoderId: string): void {
    this._write(buildSessionRequest(decoderId));
  }

  requestPassings(decoderId: string, from: number, to: number): void {
    this._write(buildResendRequest(from, to, decoderId));
  }

  /**
   * Escape-Hatch: send any pre-built P3 request frame directly on the socket.
   * Use this only in diagnostic tools (e.g. the P3 test client) where arbitrary
   * request types need to be sent without a typed wrapper method.
   */
  sendBuiltRequest(request: P3BuiltRequest): void {
    this._write(request);
  }

  get state(): ConnectionState {
    return this._state;
  }

  get decoderId(): string | null {
    return this._decoderId;
  }

  // ---------------------------------------------------------------------------

  private _doConnect(): Promise<void> {
    this._state = "connecting";
    this._decoderId = null;
    this.stream.reset();

    return new Promise<void>((resolve) => {
      const host = this.config.ip;
      const port = this.config.port ?? DEFAULT_PORT;
      let settled = false;

      const settle = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const socket = net.createConnection({ host, port }, () => {
        this._state = "connected";
        settle();
      });

      this.socket = socket;

      socket.on("data", (chunk: Buffer) => {
        const { records } = this.stream.push(new Uint8Array(chunk));
        for (const record of records) {
          this.callbacks.onRawRecord?.(record);
          this._dispatch(record);
        }
      });

      socket.on("error", (err: Error) => {
        this.callbacks.onError(err);
        settle(); // unblock connect() promise; close event will handle reconnect
      });

      socket.on("close", () => {
        const reason = this._state === "connected" ? "connection closed" : "connection failed";
        this._state = "disconnected";
        this.socket = null;
        settle(); // safety net in case close fires without prior error
        this.callbacks.onDisconnected(reason);

        if (!this.destroyed && this.autoReconnect) {
          this._scheduleReconnect();
        }
      });
    });
  }

  private _dispatch(record: P3Record): void {
    switch (record.kind) {
      case "passing":
        this._onPassing(record);
        break;
      case "status":
        this._onStatus(record);
        break;
      case "version-decoder":
        this._onVersionDecoder(record);
        break;
    }
  }

  private _onPassing(r: P3PassingRecord): void {
    if (
      r.passingNumber == null ||
      r.transponderId == null ||
      r.transponderType == null ||
      r.passingTime == null ||
      r.passingTimeSource == null ||
      r.decoderId == null
    )
      return;

    this.callbacks.onPassing({
      passingNumber: r.passingNumber,
      transponderId: r.transponderId,
      transponderType: r.transponderType === "prochip-flexchip" ? "prochip" : "tranx",
      time: r.passingTime,
      timeSource: r.passingTimeSource,
      signalStrength: r.signalStrength ?? 0,
      hits: r.hits ?? 0,
      lowBattery: r.lowBatteryWarning ?? false,
      decoderId: r.decoderId,
    });
  }

  private _onStatus(r: P3StatusRecord): void {
    if (r.decoderId == null) return;

    this.callbacks.onStatus({
      noise: r.noise ?? 0,
      gpsLocked: r.gps ?? false,
      temperature: r.temperature ?? 0,
      voltage: r.inputVoltage ?? 0,
      decoderId: r.decoderId,
    });
  }

  private _onVersionDecoder(r: P3VersionDecoderRecord): void {
    if (r.decoderId == null) return;

    this._decoderId = r.decoderId;
    this.callbacks.onConnected({
      decoderType: r.decoderType ?? "unknown",
      firmwareVersion: r.firmwareVersion ?? "unknown",
      decoderId: r.decoderId,
    });
  }

  private _write(request: P3BuiltRequest): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(toNodeBuffer(request));
    }
  }

  private _teardown(reason: string): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this._state !== "disconnected") {
      this._state = "disconnected";
      this.callbacks.onDisconnected(reason);
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) {
        this._doConnect().catch(() => {});
      }
    }, this.reconnectDelayMs);
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
