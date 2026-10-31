/**
 * Service configuration.
 *
 * Precedence: CLI > ENV > file (`<dataDir>/leaderboard.config.json`) > defaults.
 * The CLI accepts the flags of the Java app RMonitorLeaderboard, so existing start scripts
 * keep working (`-c --host 10.0.0.5 --port 50000 -s --server-port 8080`).
 *
 * Only the operational settings (`client`, `recorder`, `player`, `publish`, `state`, `compat`)
 * are stored in the file; server address, data dir, mode and token come from CLI/ENV.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type CorrectionsMode = "apply" | "ignore";

export type LeaderboardConfig = {
  mode: "managed" | "standalone";
  dataDir: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  /** Optional bearer token for writing /api endpoints; null = open. Never written to the file. */
  controlToken: string | null;
  server: { host: string; port: number };
  client: {
    host: string;
    port: number;
    encoding: string;
    autoConnect: boolean;
    /** -1 = unlimited (Java default is 3). */
    retryMax: number;
    retryTimeoutMs: number;
    /** Reconnect if nothing arrives for this long while connected (Orbits sends $F every second); 0 = off. */
    idleTimeoutMs: number;
  };
  recorder: { autoStart: boolean; name: string };
  player: {
    /** Recording to replay at startup (Java `-p --player-file`). */
    file: string | null;
    speedup: number;
    /** Encoding of recording files: `auto` detects UTF-8 vs windows-1252 per file. */
    fileEncoding: string;
    /**
     * Shorten pauses when replaying: silence > 10 s plays as 1 s; idle stretches between races
     * (heartbeats only, race clock stopped > 30 s) keep 5 s and play the rest within 2 s.
     */
    skipGaps: boolean;
  };
  publish: { coalesceMs: number };
  state: { corrections: CorrectionsMode; maxRaces: number };
  compat: {
    /** Unknown paths return the current race like the Java app (except /api, /ws, /ui, /health). */
    catchAllRace: boolean;
  };
  uploadLimitBytes: number;
};

/** The part of the configuration stored in leaderboard.config.json and editable via PUT /api/config. */
export type PersistedConfig = Pick<LeaderboardConfig, "client" | "recorder" | "player" | "publish" | "state" | "compat">;

export const CONFIG_FILE_NAME = "leaderboard.config.json";

export function defaultConfig(): LeaderboardConfig {
  return {
    mode: "standalone",
    dataDir: "./data",
    logLevel: "info",
    controlToken: null,
    server: { host: "0.0.0.0", port: 8080 },
    client: {
      host: "127.0.0.1",
      port: 50000,
      encoding: "windows-1252",
      autoConnect: false,
      retryMax: -1,
      retryTimeoutMs: 5000,
      idleTimeoutMs: 10_000,
    },
    recorder: { autoStart: false, name: "recording" },
    player: { file: null, speedup: 1, fileEncoding: "auto", skipGaps: true },
    publish: { coalesceMs: 100 },
    state: { corrections: "apply", maxRaces: 200 },
    compat: { catchAllRace: true },
    uploadLimitBytes: 50 * 1024 * 1024,
  };
}

/** Deep partial used for the config layers. */
export type ConfigLayer = {
  [K in keyof LeaderboardConfig]?: LeaderboardConfig[K] extends object
    ? LeaderboardConfig[K] extends null
      ? LeaderboardConfig[K]
      : Partial<LeaderboardConfig[K]>
    : LeaderboardConfig[K];
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ---------------------------------------------------------------------------------------------
// CLI

type FlagSpec = { names: string[]; takesValue: boolean; apply: (layer: ConfigLayer, value: string) => void };

const toInt = (flag: string, value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ConfigError(`${flag}: expected an integer, got "${value}"`);
  return n;
};

const set = <K extends keyof LeaderboardConfig>(layer: ConfigLayer, key: K, patch: ConfigLayer[K]) => {
  const current = layer[key];
  layer[key] = (
    typeof patch === "object" && patch !== null && typeof current === "object" && current !== null
      ? { ...current, ...patch }
      : patch
  ) as ConfigLayer[K];
};

const FLAGS: FlagSpec[] = [
  // Java-compatible flags
  { names: ["-c", "--start-client"], takesValue: false, apply: (l) => set(l, "client", { autoConnect: true }) },
  { names: ["--host", "--remote-host"], takesValue: true, apply: (l, v) => set(l, "client", { host: v }) },
  { names: ["--port", "--remote-port"], takesValue: true, apply: (l, v) => set(l, "client", { port: toInt("--port", v) }) },
  { names: ["--client-stream-encoding"], takesValue: true, apply: (l, v) => set(l, "client", { encoding: v }) },
  {
    names: ["--client-max-retries"],
    takesValue: true,
    apply: (l, v) => set(l, "client", { retryMax: toInt("--client-max-retries", v) }),
  },
  {
    names: ["--client-retry-timeout"],
    takesValue: true,
    apply: (l, v) => set(l, "client", { retryTimeoutMs: toInt("--client-retry-timeout", v) }),
  },
  { names: ["-s", "--start-server"], takesValue: false, apply: () => {} },
  { names: ["--server-host"], takesValue: true, apply: (l, v) => set(l, "server", { host: v }) },
  {
    names: ["--server-port"],
    takesValue: true,
    apply: (l, v) => set(l, "server", { port: toInt("--server-port", v) }),
  },
  { names: ["-p", "--start-player"], takesValue: false, apply: () => {} },
  { names: ["--player-file"], takesValue: true, apply: (l, v) => set(l, "player", { file: v }) },
  {
    names: ["--player-speedup"],
    takesValue: true,
    apply: (l, v) => set(l, "player", { speedup: Number(v) }),
  },
  { names: ["--player-file-encoding"], takesValue: true, apply: (l, v) => set(l, "player", { fileEncoding: v }) },
  {
    names: ["--player-skip-gaps"],
    takesValue: true,
    apply: (l, v) => set(l, "player", { skipGaps: bool("--player-skip-gaps", v) }),
  },
  { names: ["--player-port", "--player-stream-encoding"], takesValue: true, apply: () => {} },
  { names: ["-r", "--start-recorder"], takesValue: false, apply: (l) => set(l, "recorder", { autoStart: true }) },
  {
    names: ["--recorder-file"],
    takesValue: true,
    // Java takes a path; the service always writes to <dataDir>/recordings, so only the name is used.
    apply: (l, v) => set(l, "recorder", { autoStart: true, name: v.replace(/^.*[\\/]/, "").replace(/\.txt$/i, "") }),
  },
  { names: ["--recorder-file-encoding"], takesValue: true, apply: () => {} },
  { names: ["--headless", "--disable-console-log", "--disable-file-log"], takesValue: false, apply: () => {} },
  {
    names: ["--loglevel"],
    takesValue: true,
    apply: (l, v) => {
      l.logLevel = normalizeLogLevel(v);
    },
  },
  // Service flags
  { names: ["--data-dir"], takesValue: true, apply: (l, v) => (l.dataDir = v) },
  {
    names: ["--mode"],
    takesValue: true,
    apply: (l, v) => {
      if (v !== "managed" && v !== "standalone") throw new ConfigError(`--mode: expected managed|standalone, got "${v}"`);
      l.mode = v;
    },
  },
  {
    names: ["--coalesce-ms"],
    takesValue: true,
    apply: (l, v) => set(l, "publish", { coalesceMs: toInt("--coalesce-ms", v) }),
  },
];

/** Parses CLI arguments (`--flag value` and `--flag=value`). Throws ConfigError for unknown flags. */
export function parseCliArgs(argv: readonly string[]): ConfigLayer {
  const layer: ConfigLayer = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-h" || arg === "--help") continue;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const spec = FLAGS.find((f) => f.names.includes(name));
    if (!spec) throw new ConfigError(`unknown option ${arg}`);
    let value = "";
    if (spec.takesValue) {
      if (eq !== -1) value = arg.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next === undefined) throw new ConfigError(`${name} needs a value`);
        value = next;
        i++;
      }
    }
    spec.apply(layer, value);
  }
  return layer;
}

export const CLI_HELP = `Usage: leaderboard-service [options]

Orbits (RMonitor) connection – Java-compatible:
  -c, --start-client               connect to Orbits at startup
      --host <host>                Orbits host (default 127.0.0.1)
      --port <port>                Orbits RMonitor port (default 50000)
      --client-stream-encoding <e> stream encoding (default windows-1252)
      --client-max-retries <n>     -1 = unlimited (default -1)
      --client-retry-timeout <ms>  delay between retries (default 5000)
Server:
      --server-host <host>         bind address (default 0.0.0.0)
      --server-port <port>         HTTP port (default 8080)
Player / recorder:
      --player-file <file>         replay a recording at startup
      --player-speedup <n>         replay speed (default 1)
      --player-file-encoding <e>   auto | windows-1252 | utf-8 (default auto)
      --player-skip-gaps <bool>    shorten pauses and idle time between races (default true)
  -r, --start-recorder             record the live stream at startup
      --recorder-file <name>       recording name (implies -r)
Service:
      --data-dir <dir>             config + recordings (default ./data)
      --mode <managed|standalone>  default standalone
      --coalesce-ms <ms>           WebSocket patch coalescing (default 100)
      --loglevel <level>           error | warn | info | debug
Accepted for compatibility, no effect: -s, -p, --headless, --player-port,
  --player-stream-encoding, --recorder-file-encoding, --disable-console-log, --disable-file-log
Environment: RMONITOR_HOST, RMONITOR_PORT, RMONITOR_ENCODING, RMONITOR_RETRY_MAX,
  RMONITOR_RETRY_TIMEOUT_MS, AUTOCONNECT, HOST/LEADERBOARD_HOST, PORT/LEADERBOARD_PORT,
  RECORDER_AUTOSTART, PUBLISH_COALESCE_MS, LEADERBOARD_DATA_DIR, LEADERBOARD_MODE,
  LEADERBOARD_CONTROL_TOKEN, LOG_LEVEL
`;

// ---------------------------------------------------------------------------------------------
// ENV

const bool = (name: string, value: string): boolean => {
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new ConfigError(`${name}: expected true/false, got "${value}"`);
};

export function readEnv(env: NodeJS.ProcessEnv): ConfigLayer {
  const layer: ConfigLayer = {};
  const get = (name: string) => {
    const v = env[name];
    return v === undefined || v === "" ? undefined : v;
  };
  let v: string | undefined;
  if ((v = get("RMONITOR_HOST"))) set(layer, "client", { host: v });
  if ((v = get("RMONITOR_PORT"))) set(layer, "client", { port: toInt("RMONITOR_PORT", v) });
  if ((v = get("RMONITOR_ENCODING"))) set(layer, "client", { encoding: v });
  if ((v = get("RMONITOR_RETRY_MAX"))) set(layer, "client", { retryMax: toInt("RMONITOR_RETRY_MAX", v) });
  if ((v = get("RMONITOR_RETRY_TIMEOUT_MS")))
    set(layer, "client", { retryTimeoutMs: toInt("RMONITOR_RETRY_TIMEOUT_MS", v) });
  if ((v = get("AUTOCONNECT"))) set(layer, "client", { autoConnect: bool("AUTOCONNECT", v) });
  if ((v = get("LEADERBOARD_HOST") ?? get("HOST"))) set(layer, "server", { host: v });
  if ((v = get("LEADERBOARD_PORT") ?? get("PORT"))) set(layer, "server", { port: toInt("PORT", v) });
  if ((v = get("PLAYER_SKIP_GAPS"))) set(layer, "player", { skipGaps: bool("PLAYER_SKIP_GAPS", v) });
  if ((v = get("RECORDER_AUTOSTART"))) set(layer, "recorder", { autoStart: bool("RECORDER_AUTOSTART", v) });
  if ((v = get("PUBLISH_COALESCE_MS"))) set(layer, "publish", { coalesceMs: toInt("PUBLISH_COALESCE_MS", v) });
  if ((v = get("LEADERBOARD_DATA_DIR"))) layer.dataDir = v;
  if ((v = get("LEADERBOARD_MODE"))) {
    if (v !== "managed" && v !== "standalone") throw new ConfigError(`LEADERBOARD_MODE: expected managed|standalone`);
    layer.mode = v;
  }
  if ((v = get("LEADERBOARD_CONTROL_TOKEN"))) layer.controlToken = v;
  if ((v = get("LOG_LEVEL"))) layer.logLevel = normalizeLogLevel(v);
  return layer;
}

function normalizeLogLevel(value: string): LeaderboardConfig["logLevel"] {
  const v = value.toLowerCase();
  if (v === "off") return "silent";
  if (["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(v)) {
    return v as LeaderboardConfig["logLevel"];
  }
  throw new ConfigError(`unknown log level "${value}"`);
}

// ---------------------------------------------------------------------------------------------
// File, merge, validation

export function configFilePath(dataDir: string): string {
  return join(resolve(dataDir), CONFIG_FILE_NAME);
}

export function readConfigFile(dataDir: string): ConfigLayer {
  const file = configFilePath(dataDir);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return pickPersisted(parsed);
  } catch (err) {
    throw new ConfigError(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Writes the persisted part atomically (temp file + rename). */
export function writeConfigFile(config: LeaderboardConfig): void {
  const file = configFilePath(config.dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const persisted: PersistedConfig = {
    client: config.client,
    recorder: config.recorder,
    player: config.player,
    publish: config.publish,
    state: config.state,
    compat: config.compat,
  };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

const PERSISTED_KEYS = ["client", "recorder", "player", "publish", "state", "compat"] as const;

/** Keeps only the persisted sections and their known keys (ignores everything else). */
export function pickPersisted(input: unknown): ConfigLayer {
  const layer: ConfigLayer = {};
  if (typeof input !== "object" || input === null) return layer;
  const defaults = defaultConfig();
  for (const key of PERSISTED_KEYS) {
    const section = (input as Record<string, unknown>)[key];
    if (typeof section !== "object" || section === null) continue;
    const known = Object.keys(defaults[key]);
    const picked: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(section)) if (known.includes(k)) picked[k] = value;
    (layer as Record<string, unknown>)[key] = picked;
  }
  return layer;
}

export function mergeConfig(base: LeaderboardConfig, ...layers: ConfigLayer[]): LeaderboardConfig {
  const result = structuredClone(base) as Record<string, unknown>;
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const current = result[key];
      result[key] =
        typeof value === "object" && value !== null && typeof current === "object" && current !== null
          ? { ...current, ...value }
          : value;
    }
  }
  return validateConfig(result as LeaderboardConfig);
}

const isPort = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 65535;

export function validateConfig(c: LeaderboardConfig): LeaderboardConfig {
  const fail = (msg: string) => {
    throw new ConfigError(msg);
  };
  if (!isPort(c.server.port)) fail(`server.port invalid: ${c.server.port}`);
  if (!isPort(c.client.port) || c.client.port === 0) fail(`client.port invalid: ${c.client.port}`);
  if (typeof c.client.host !== "string" || c.client.host.trim() === "") fail("client.host must not be empty");
  try {
    new TextDecoder(c.client.encoding);
  } catch {
    fail(`client.encoding unknown: ${c.client.encoding}`);
  }
  if (c.player.fileEncoding !== "auto") {
    try {
      new TextDecoder(c.player.fileEncoding);
    } catch {
      fail(`player.fileEncoding unknown: ${c.player.fileEncoding}`);
    }
  }
  if (!Number.isInteger(c.client.retryMax) || c.client.retryMax < -1) fail("client.retryMax must be >= -1");
  if (!(c.client.retryTimeoutMs >= 0)) fail("client.retryTimeoutMs must be >= 0");
  if (!(c.client.idleTimeoutMs >= 0)) fail("client.idleTimeoutMs must be >= 0");
  if (!(c.player.speedup > 0)) fail("player.speedup must be > 0");
  if (!(c.publish.coalesceMs >= 0)) fail("publish.coalesceMs must be >= 0");
  if (c.state.corrections !== "apply" && c.state.corrections !== "ignore") fail("state.corrections: apply|ignore");
  if (!(c.state.maxRaces >= 1)) fail("state.maxRaces must be >= 1");
  if (typeof c.recorder.name !== "string") fail("recorder.name must be a string");
  return c;
}

/** Full resolution: defaults < file < ENV < CLI. The data dir itself comes from CLI/ENV/default. */
export function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv): LeaderboardConfig {
  const cli = parseCliArgs(argv);
  const envLayer = readEnv(env);
  const dataDir = cli.dataDir ?? envLayer.dataDir ?? defaultConfig().dataDir;
  const file = readConfigFile(dataDir);
  return mergeConfig(defaultConfig(), file, envLayer, cli, { dataDir: resolve(dataDir) });
}
