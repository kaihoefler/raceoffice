/**
 * RMonitorTcpSource – TCP client for the Orbits RMonitor stream.
 *
 * - Splits the byte stream into lines (raw bytes kept for the recorder) and decodes them.
 * - Reconnect: after a failed attempt or a lost connection it waits `retryTimeoutMs` and tries
 *   again, up to `retryMax` times in a row (-1 = unlimited). The counter resets once a
 *   connection is established.
 * - Idle detection: Orbits sends a `$F` heartbeat every second. If nothing arrives for
 *   `idleTimeoutMs`, the connection is considered dead (e.g. cable pulled, no FIN) and re-opened.
 */
import { createConnection, type Socket } from "node:net";
import { LineSplitter } from "@raceoffice/rmonitor";
import { RateCounter } from "../util/rateCounter.js";

export type TcpSourceOptions = {
  host: string;
  port: number;
  encoding: string;
  retryMax: number;
  retryTimeoutMs: number;
  idleTimeoutMs: number;
};

export type TcpSourceState = "stopped" | "connecting" | "connected" | "retrying" | "error";

export type TcpSourceStatus = {
  state: TcpSourceState;
  host: string;
  port: number;
  encoding: string;
  lastMessageAt: number | null;
  messagesPerMinute: number;
  retry: { attempt: number; max: number; nextAttemptAt: number | null };
  lastError: string | null;
};

export type TcpSourceEvents = {
  onLine: (raw: Uint8Array, text: string) => void;
  onStateChange?: (state: TcpSourceState) => void;
  log?: { info(msg: string): void; warn(msg: string): void };
};

export class RMonitorTcpSource {
  private socket: Socket | null = null;
  private state: TcpSourceState = "stopped";
  private attempt = 0;
  private nextAttemptAt: number | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastMessageAt: number | null = null;
  private lastError: string | null = null;
  private readonly rate = new RateCounter(60);
  private readonly decoder: TextDecoder;
  private splitter = new LineSplitter();

  constructor(
    private readonly options: TcpSourceOptions,
    private readonly events: TcpSourceEvents,
  ) {
    this.decoder = new TextDecoder(options.encoding);
  }

  get currentState(): TcpSourceState {
    return this.state;
  }

  status(now = Date.now()): TcpSourceStatus {
    return {
      state: this.state,
      host: this.options.host,
      port: this.options.port,
      encoding: this.options.encoding,
      lastMessageAt: this.lastMessageAt,
      messagesPerMinute: this.rate.total(now),
      retry: { attempt: this.attempt, max: this.options.retryMax, nextAttemptAt: this.nextAttemptAt },
      lastError: this.lastError,
    };
  }

  start(): void {
    if (this.state !== "stopped" && this.state !== "error") return;
    this.attempt = 0;
    this.lastError = null;
    this.connect();
  }

  /** Closes the connection and cancels pending retries. */
  stop(): void {
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.destroy();
    }
    this.flushPending();
    this.setState("stopped");
  }

  private connect(): void {
    this.clearRetry();
    this.setState("connecting");
    this.splitter = new LineSplitter();

    const socket = createConnection({ host: this.options.host, port: this.options.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);
    if (this.options.idleTimeoutMs > 0) socket.setTimeout(this.options.idleTimeoutMs);

    socket.on("connect", () => {
      this.attempt = 0;
      this.lastError = null;
      this.setState("connected");
      this.events.log?.info(`connected to Orbits ${this.options.host}:${this.options.port}`);
    });
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("timeout", () => {
      this.lastError = `no data for ${this.options.idleTimeoutMs} ms`;
      this.events.log?.warn(`Orbits connection idle, reconnecting (${this.lastError})`);
      socket.destroy();
    });
    socket.on("error", (err) => {
      this.lastError = err.message;
    });
    socket.on("close", () => {
      if (this.socket !== socket) return; // stopped or replaced
      this.socket = null;
      this.flushPending();
      this.scheduleRetry();
    });
  }

  private onData(chunk: Buffer): void {
    const now = Date.now();
    for (const raw of this.splitter.push(chunk)) this.emit(raw, now);
  }

  /** Java's BufferedReader returns the unterminated rest at EOF as a last line; do the same. */
  private flushPending(): void {
    const now = Date.now();
    for (const raw of this.splitter.flush()) this.emit(raw, now);
  }

  private emit(raw: Uint8Array, now: number): void {
    this.lastMessageAt = now;
    this.rate.add(now);
    this.events.onLine(raw, this.decoder.decode(raw));
  }

  private scheduleRetry(): void {
    this.attempt++;
    const max = this.options.retryMax;
    if (max >= 0 && this.attempt > max) {
      this.nextAttemptAt = null;
      this.setState("error");
      this.events.log?.warn(`giving up after ${max} retries: ${this.lastError ?? "connection closed"}`);
      return;
    }
    this.nextAttemptAt = Date.now() + this.options.retryTimeoutMs;
    this.setState("retrying");
    this.retryTimer = setTimeout(() => this.connect(), this.options.retryTimeoutMs);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.nextAttemptAt = null;
  }

  private setState(state: TcpSourceState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange?.(state);
  }
}
