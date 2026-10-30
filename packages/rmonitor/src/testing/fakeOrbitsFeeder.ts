/**
 * FakeOrbitsFeeder – a controllable RMonitor TCP server that replays a recording.
 *
 * Unlike the Java player (wall-clock replay, no pause/seek in headless mode) the feeder sends
 * lines on command: `sendUntil(n)` writes exactly the first n lines and stops. That makes
 * "state after line n" reproducible, which the golden tests need. `play()` adds timed replay
 * for integration tests of the leaderboard service.
 *
 * - Listens on `127.0.0.1` and an ephemeral port by default.
 * - Every connected client receives every line written after it connected (like Orbits).
 * - Lines are written byte-exact (recordings are windows-1252) followed by `lineEnding`.
 */
import { readFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { parseRecordingBytes } from "../recording/format.js";

export type FeederLine = {
  /** Offset from the recording, used by `play()`. */
  offsetMs: number;
  bytes: Uint8Array;
};

export type FakeOrbitsFeederOptions = {
  /** Bind address. Default `127.0.0.1`; use `0.0.0.0` if a container must reach the feeder. */
  host?: string;
  /** Default 0 = ephemeral port. */
  port?: number;
  /** Default `\r\n` like Orbits. */
  lineEnding?: "\r\n" | "\n";
};

export type PlayOptions = {
  /** Replay speed factor, default 1. */
  speedup?: number;
  /** Stops before this line count (exclusive end), default all lines. */
  until?: number;
  signal?: AbortSignal;
};

export class FakeOrbitsFeeder {
  private readonly lines: FeederLine[];
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly lineEnding: Uint8Array;
  private server: Server | null = null;
  private readonly clients = new Set<Socket>();
  private clientWaiters: Array<() => void> = [];
  private sent = 0;

  constructor(lines: FeederLine[], options: FakeOrbitsFeederOptions = {}) {
    this.lines = lines;
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.lineEnding = Buffer.from(options.lineEnding ?? "\r\n", "latin1");
  }

  /** Loads a recording file (`<ms> <raw>` per line) byte-exact. */
  static async fromRecordingFile(path: string, options?: FakeOrbitsFeederOptions): Promise<FakeOrbitsFeeder> {
    const data = await readFile(path);
    const lines = parseRecordingBytes(data).map((e) => ({ offsetMs: e.offsetMs, bytes: e.raw }));
    return new FakeOrbitsFeeder(lines, options);
  }

  /**
   * Builds a feeder from message strings (no timestamps; `play()` then sends 100 ms apart).
   * `encoding` only supports what Node can encode: `latin1` (= windows-1252 for umlauts) or `utf-8`.
   */
  static fromMessages(
    messages: string[],
    options?: FakeOrbitsFeederOptions & { encoding?: "latin1" | "utf-8" },
  ): FakeOrbitsFeeder {
    const encoding = options?.encoding === "utf-8" ? "utf8" : "latin1";
    const lines = messages.map((m, i) => ({ offsetMs: i * 100, bytes: Buffer.from(m, encoding) }));
    return new FakeOrbitsFeeder(lines, options);
  }

  /** Number of lines in the recording. */
  get length(): number {
    return this.lines.length;
  }

  /** Number of lines sent so far (= index of the next line). */
  get position(): number {
    return this.sent;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get port(): number {
    const address = this.server?.address() as AddressInfo | null | undefined;
    if (!address) throw new Error("FakeOrbitsFeeder is not started");
    return address.port;
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) return { host: this.host, port: this.port };
    const server = createServer((socket) => this.onConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.requestedPort, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return { host: this.host, port: this.port };
  }

  /** Resolves once at least `count` clients are connected. */
  async waitForClients(count = 1, timeoutMs = 30_000): Promise<void> {
    if (this.clients.size >= count) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.clientWaiters = this.clientWaiters.filter((w) => w !== check);
        reject(new Error(`no client connected within ${timeoutMs} ms`));
      }, timeoutMs);
      const check = () => {
        if (this.clients.size >= count) {
          clearTimeout(timer);
          this.clientWaiters = this.clientWaiters.filter((w) => w !== check);
          resolve();
        }
      };
      this.clientWaiters.push(check);
    });
  }

  /** Sends all lines up to (excluding) `lineCount`, i.e. afterwards exactly `lineCount` lines are sent. */
  async sendUntil(lineCount: number): Promise<void> {
    const end = Math.min(Math.max(lineCount, this.sent), this.lines.length);
    if (end === this.sent) return;
    const parts: Uint8Array[] = [];
    for (let i = this.sent; i < end; i++) {
      parts.push((this.lines[i] as FeederLine).bytes, this.lineEnding);
    }
    this.sent = end;
    await this.write(Buffer.concat(parts));
  }

  async sendNext(count = 1): Promise<void> {
    await this.sendUntil(this.sent + count);
  }

  /** Writes arbitrary bytes (e.g. a split line for chunking tests); does not move the position. */
  async sendRaw(bytes: Uint8Array): Promise<void> {
    await this.write(bytes);
  }

  /** Replays from the current position with the recording's timing (`Δt / speedup`). */
  async play(options: PlayOptions = {}): Promise<void> {
    const speedup = options.speedup && options.speedup > 0 ? options.speedup : 1;
    const until = Math.min(options.until ?? this.lines.length, this.lines.length);
    let lastOffset = this.sent > 0 ? (this.lines[this.sent - 1] as FeederLine).offsetMs : null;

    while (this.sent < until) {
      if (options.signal?.aborted) return;
      // Send all lines with the same timestamp together, then wait for the next one.
      const offset = (this.lines[this.sent] as FeederLine).offsetMs;
      const delay = lastOffset === null ? 0 : Math.max(0, offset - lastOffset) / speedup;
      if (delay > 0) await sleep(delay, options.signal);
      if (options.signal?.aborted) return;
      let end = this.sent + 1;
      while (end < until && (this.lines[end] as FeederLine).offsetMs === offset) end++;
      await this.sendUntil(end);
      lastOffset = offset;
    }
  }

  /** Disconnects all clients but keeps listening (reconnect tests). */
  disconnectClients(): void {
    for (const socket of this.clients) socket.destroy();
    this.clients.clear();
  }

  async close(): Promise<void> {
    this.disconnectClients();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private onConnection(socket: Socket): void {
    socket.setNoDelay(true);
    this.clients.add(socket);
    const remove = () => this.clients.delete(socket);
    socket.on("close", remove);
    socket.on("error", remove);
    // Clients do not send anything relevant; drain to avoid back-pressure.
    socket.on("data", () => {});
    for (const waiter of [...this.clientWaiters]) waiter();
  }

  private async write(data: Uint8Array): Promise<void> {
    await Promise.all(
      [...this.clients].map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.destroyed) return resolve();
            socket.write(data, () => resolve());
          }),
      ),
    );
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
