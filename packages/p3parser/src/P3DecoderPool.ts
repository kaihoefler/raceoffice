import type {
  ConnectionState,
  DecoderConfig,
  DecoderInfoEvent,
  DecoderStatusEvent,
  PassingEvent,
} from "./clientTypes.js";
import { P3DecoderConnection, type ConnectionOptions } from "./P3DecoderConnection.js";
import type { P3Record } from "./types.js";

export type PoolOptions = {
  /** Automatically reconnect each decoder after connection loss. Default: true */
  autoReconnect?: boolean;
  /** Milliseconds to wait before each reconnect attempt. Default: 3000 */
  reconnectDelayMs?: number;
};

export type DecoderPoolCallbacks = {
  /** Unified passing stream from all decoders. The decoderId in the event identifies the source. */
  onPassing: (event: PassingEvent) => void;
  onStatus: (event: DecoderStatusEvent, source: DecoderConfig) => void;
  onDecoderConnected: (info: DecoderInfoEvent, source: DecoderConfig) => void;
  onDecoderDisconnected: (source: DecoderConfig, reason: string) => void;
  onError: (error: Error, source: DecoderConfig) => void;
  /** Escape hatch: raw P3 record before translation, with its source config. */
  onRawRecord?: (record: P3Record, source: DecoderConfig) => void;
};

export type PoolDecoderState = {
  config: DecoderConfig;
  /** null until the decoder has sent a VERSION_DECODER record. */
  decoderId: string | null;
  state: ConnectionState;
  lastError?: string;
};

/**
 * Manages multiple P3 decoder connections as a single track setup.
 *
 * All passings from all decoders arrive through a single onPassing callback.
 * The decoderId field on PassingEvent identifies which decoder produced each passing.
 *
 * Use P3DecoderConnection directly if you need a single connection with full control
 * (e.g. the P3 test client).
 */
export class P3DecoderPool {
  private readonly configs: DecoderConfig[];
  private readonly callbacks: DecoderPoolCallbacks;
  private readonly options: ConnectionOptions;

  private readonly connectionMap = new Map<string, P3DecoderConnection>(); // keyed by ip
  private readonly stateMap = new Map<string, PoolDecoderState>(); // keyed by ip

  constructor(
    decoders: DecoderConfig[],
    callbacks: DecoderPoolCallbacks,
    options: PoolOptions = {},
  ) {
    this.configs = decoders;
    this.callbacks = callbacks;
    this.options = {
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelayMs: options.reconnectDelayMs ?? 3000,
    };

    for (const config of decoders) {
      this._initConnection(config);
    }
  }

  /** Connect all decoders in parallel. Resolves once all initial connect attempts have settled. */
  async connect(): Promise<void> {
    await Promise.all([...this.connectionMap.values()].map((c) => c.connect()));
  }

  /** Disconnect all decoders. */
  disconnect(): void {
    for (const conn of this.connectionMap.values()) {
      conn.disconnect();
    }
  }

  /** Current state snapshot for all configured decoders. */
  get connections(): PoolDecoderState[] {
    return [...this.stateMap.values()];
  }

  /** Send a resend (passings range) request to a specific decoder identified by IP. */
  requestPassings(ip: string, from: number, to: number): void {
    const state = this.stateMap.get(ip);
    const conn = this.connectionMap.get(ip);
    if (!conn || !state?.decoderId) return;
    conn.requestPassings(state.decoderId, from, to);
  }

  /** Send a session query to a specific decoder identified by IP. */
  requestSession(ip: string): void {
    const state = this.stateMap.get(ip);
    const conn = this.connectionMap.get(ip);
    if (!conn || !state?.decoderId) return;
    conn.requestSession(state.decoderId);
  }

  // ---------------------------------------------------------------------------

  private _initConnection(config: DecoderConfig): void {
    const state: PoolDecoderState = {
      config,
      decoderId: null,
      state: "disconnected",
    };
    this.stateMap.set(config.ip, state);

    const conn = new P3DecoderConnection(
      config,
      {
        onConnected: (info: DecoderInfoEvent) => {
          state.decoderId = info.decoderId;
          state.state = "connected";
          state.lastError = undefined;
          this.callbacks.onDecoderConnected(info, config);
        },
        onDisconnected: (reason: string) => {
          state.state = "disconnected";
          this.callbacks.onDecoderDisconnected(config, reason);
        },
        onPassing: (event: PassingEvent) => {
          this.callbacks.onPassing(event);
        },
        onStatus: (event: DecoderStatusEvent) => {
          this.callbacks.onStatus(event, config);
        },
        onError: (error: Error) => {
          state.lastError = error.message;
          this.callbacks.onError(error, config);
        },
        onRawRecord: this.callbacks.onRawRecord
          ? (record: P3Record) => this.callbacks.onRawRecord!(record, config)
          : undefined,
      },
      this.options,
    );

    this.connectionMap.set(config.ip, conn);
  }
}
