/**
 * LeaderboardService – the core, independent of HTTP.
 *
 * Data flow: source (Orbits TCP or recording player) → parseLine → RaceStateStore →
 * SnapshotPublisher (WebSocket) / REST reads the store directly.
 *
 * Rules:
 * - Exactly one source at a time. Connecting to Orbits stops a replay, starting a replay
 *   disconnects Orbits. Switching between live and replay resets the race state, so replay
 *   data never mixes with live data.
 * - The recorder only records live lines from Orbits (a replay is not recorded again).
 */
import { join } from "node:path";
import type { LeaderboardServiceStatus } from "@raceoffice/domain";
import { parseLine, RaceStateStore } from "@raceoffice/rmonitor";
import { writeConfigFile, type LeaderboardConfig, type PersistedConfig } from "./config.js";
import { SnapshotPublisher } from "./publisher.js";
import { Recorder, RecordingLibrary } from "./recordings.js";
import { PassingLog } from "./passings.js";
import { RecordingPlayer } from "./sources/playerSource.js";
import { RMonitorTcpSource } from "./sources/tcpSource.js";
import { VERSION } from "./version.js";

export type Source = "none" | "rmonitor" | "player";

export type ServiceLogger = {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
};

const silentLogger: ServiceLogger = { info() {}, warn() {}, error() {} };

export class LeaderboardService {
  private storeInstance: RaceStateStore;
  readonly publisher: SnapshotPublisher;
  readonly recorder: Recorder;
  readonly recordings: RecordingLibrary;
  readonly player: RecordingPlayer;
  /** Line crossings for the finish line log (events, not state). */
  readonly passings = new PassingLog();
  private tcp: RMonitorTcpSource | null = null;
  private source: Source = "none";
  private statusListeners = new Set<() => void>();
  /** Set by the HTTP layer for the status (`server.*`). */
  serverStats: () => { port: number; wsClients: number; restRequestsPerMinute: number } = () => ({
    port: this.config.server.port,
    wsClients: 0,
    restRequestsPerMinute: 0,
  });

  constructor(
    readonly config: LeaderboardConfig,
    private log: ServiceLogger = silentLogger,
  ) {
    this.storeInstance = this.createStore();
    this.publisher = new SnapshotPublisher(() => this.storeInstance, () => this.config.publish.coalesceMs);
    const dir = join(config.dataDir, "recordings");
    this.recorder = new Recorder(dir);
    this.recordings = new RecordingLibrary(dir);
    this.player = new RecordingPlayer({
      onLine: (_raw, text) => this.applyLine(text),
      onReset: () => this.resetState(),
      onStateChange: () => this.emitStatus(),
      onEnd: () => this.log.info("replay finished"),
    });
    this.player.setSkipGaps(config.player.skipGaps);
  }

  setLogger(log: ServiceLogger): void {
    this.log = log;
  }

  get store(): RaceStateStore {
    return this.storeInstance;
  }

  get activeSource(): Source {
    return this.source;
  }

  /** Startup actions from the configuration (auto-connect, auto-record, player file). */
  async startup(): Promise<void> {
    if (this.config.recorder.autoStart) await this.startRecorder(this.config.recorder.name);
    if (this.config.player.file) {
      await this.startPlayer({ file: this.config.player.file, speedup: this.config.player.speedup });
    } else if (this.config.client.autoConnect) {
      this.connect();
    }
  }

  async shutdown(): Promise<void> {
    this.player.stop();
    this.tcp?.stop();
    this.tcp = null;
    this.publisher.close();
    await this.recorder.stop();
  }

  // -- Orbits ----------------------------------------------------------------------------------

  /** Connects to Orbits; optional parameters update (and persist) the client configuration. */
  connect(params: Partial<Pick<LeaderboardConfig["client"], "host" | "port" | "encoding">> = {}): void {
    const changed = Object.entries(params).some(
      ([k, v]) => v !== undefined && (this.config.client as Record<string, unknown>)[k] !== v,
    );
    if (changed) {
      Object.assign(this.config.client, definedOnly(params));
      this.persistConfig();
    }
    if (this.source === "player") {
      this.player.stop();
      this.resetState();
    }
    this.tcp?.stop();
    const c = this.config.client;
    this.tcp = new RMonitorTcpSource(
      {
        host: c.host,
        port: c.port,
        encoding: c.encoding,
        retryMax: c.retryMax,
        retryTimeoutMs: c.retryTimeoutMs,
        idleTimeoutMs: c.idleTimeoutMs,
      },
      {
        onLine: (raw, text) => {
          this.recorder.push(raw);
          this.applyLine(text);
        },
        onStateChange: () => this.emitStatus(),
        log: this.log,
      },
    );
    this.source = "rmonitor";
    this.tcp.start();
    this.emitStatus();
  }

  disconnect(): void {
    this.tcp?.stop();
    if (this.source === "rmonitor") this.source = "none";
    this.emitStatus();
  }

  // -- Player ----------------------------------------------------------------------------------

  async startPlayer(options: { file: string; speedup?: number; startAtMs?: number; skipGaps?: boolean }): Promise<void> {
    const path = this.recordings.pathOf(options.file);
    await this.player.load(path, this.config.player.fileEncoding, {
      skipGaps: options.skipGaps ?? this.player.status().skipGaps,
    });
    this.tcp?.stop();
    this.tcp = null;
    this.source = "player";
    this.player.start({
      speedup: options.speedup ?? this.config.player.speedup,
      ...(options.startAtMs !== undefined ? { startAtMs: options.startAtMs } : {}),
    });
    this.emitStatus();
  }

  stopPlayer(): void {
    this.player.stop();
    if (this.source === "player") this.source = "none";
    this.emitStatus();
  }

  // -- Recorder --------------------------------------------------------------------------------

  async startRecorder(name?: string): Promise<string> {
    const file = await this.recorder.start(name && name.trim() ? name : this.config.recorder.name);
    this.emitStatus();
    return file;
  }

  async stopRecorder(): Promise<void> {
    await this.recorder.stop();
    this.emitStatus();
  }

  // -- State / config --------------------------------------------------------------------------

  resetState(): void {
    this.storeInstance = this.createStore();
    this.passings.clear();
    this.publisher.reset();
    this.emitStatus();
  }

  /** Applies a validated configuration update (persisted part only) and saves it. */
  updateConfig(next: PersistedConfig): void {
    const clientChanged = JSON.stringify(next.client) !== JSON.stringify(this.config.client);
    const stateChanged = JSON.stringify(next.state) !== JSON.stringify(this.config.state);
    Object.assign(this.config, structuredClone(next));
    this.persistConfig();
    if (stateChanged) this.resetState();
    // Reconnect with the new client settings if live.
    if (clientChanged && this.source === "rmonitor" && this.tcp && this.tcp.currentState !== "stopped") this.connect();
    this.emitStatus();
  }

  status(): LeaderboardServiceStatus & { player: { encoding: string | null; linesPlayed: number; lineCount: number } } {
    const now = Date.now();
    const c = this.config.client;
    const client = this.tcp?.status(now) ?? {
      state: "stopped" as const,
      host: c.host,
      port: c.port,
      encoding: c.encoding,
      lastMessageAt: null,
      messagesPerMinute: 0,
      retry: { attempt: 0, max: c.retryMax, nextAttemptAt: null },
      lastError: null,
    };
    const race = this.storeInstance.displayRace;
    const hasRace = race.id !== -1;
    const player = this.player.status(now);
    return {
      version: VERSION,
      mode: this.config.mode,
      source: this.source,
      client: { ...client, host: c.host, port: c.port, encoding: c.encoding },
      recorder: this.recorder.status(),
      player: {
        state: player.state,
        file: player.file,
        speedup: player.speedup,
        skipGaps: player.skipGaps,
        progress: player.progress,
        positionMs: player.positionMs,
        durationMs: player.durationMs,
        encoding: player.encoding,
        linesPlayed: player.linesPlayed,
        lineCount: player.lineCount,
      },
      server: this.serverStats(),
      race: {
        currentId: hasRace ? race.id : null,
        currentName: hasRace ? race.name : null,
        flag: hasRace ? race.flagStatus : null,
      },
    };
  }

  /** Status listeners (for `/ws/status`); returns an unsubscribe function. */
  onStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private applyLine(text: string): void {
    const msg = parseLine(text);
    const changed = this.storeInstance.apply(msg).changed;
    if (changed) {
      this.passings.observe(this.storeInstance, msg);
      this.publisher.notify({ heartbeat: msg.kind === "heartbeat" });
    }
  }

  private createStore(): RaceStateStore {
    return new RaceStateStore({ corrections: this.config.state.corrections, maxRaces: this.config.state.maxRaces });
  }

  private persistConfig(): void {
    try {
      writeConfigFile(this.config);
    } catch (err) {
      this.log.warn(`cannot save configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) listener();
  }
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
