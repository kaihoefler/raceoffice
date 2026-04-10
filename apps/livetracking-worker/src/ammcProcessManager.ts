import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveTrackingTimingPoint } from "@raceoffice/domain";

export type AmmcProcessStatusPatch = {
  processStatus: "stopped" | "starting" | "running" | "error";
  lastError?: string | null;
};

type AmmcManagedProcess = {
  timingPoint: LiveTrackingTimingPoint;
  child: ChildProcess;
  startedAtMs: number;
};

export type AmmcProcessManagerOptions = {
  binaryPath?: string;
  argsTemplate?: string[];
  restartDelayMs?: number;
  onStatus: (timingPoint: LiveTrackingTimingPoint, patch: AmmcProcessStatusPatch) => void;
  onWarning?: (warning: string) => void;
};

function resolveWorkspaceRoot(): string {
  // src/ammcProcessManager.ts -> livetracking-worker -> apps -> workspace root
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../..");
}

/**
 * Resolves platform-specific default AMMC binary shipped in this repository.
 *
 * Override via `LIVETRACKING_AMMC_BIN` when running custom builds.
 */
function defaultBinaryPath(): string {
  const root = resolveWorkspaceRoot();
  const ammcPath = "tools/ammc/";
  if (process.platform === "win32") {
    return path.resolve(root, ammcPath + "windows64/ammc-amb.exe");
  }
  if (process.platform === "darwin") {
    return path.resolve(root, ammcPath + "apple_m/ammc-amb");
  }
  return path.resolve(root, ammcPath + "linux_x86-64/ammc-amb");
}

/**
 * Expands AMMC argument template placeholders with timing-point specific values.
 */
function buildArgs(point: LiveTrackingTimingPoint, template: string[]): string[] {
  return template.map((token) =>
    token
      .replaceAll("{wsPort}", String(point.websocketPortAMM))
      .replaceAll("{decoderIp}", point.decoderIp)
      .replaceAll("{decoderId}", point.decoderId)
      .replaceAll("{timingPointId}", point.id),
  );
}

/**
 * AMMC sometimes writes informational lines to stderr.
 * We classify only obvious error-like lines as hard process errors.
 */
function isLikelyErrorLogLine(line: string): boolean {
  const normalized = line.toLowerCase();
  return normalized.includes("error") || normalized.includes("failed") || normalized.includes("fatal") || normalized.includes("panic");
}

/**
 * Manages AMM converter child processes per timing point.
 *
 * Scope:
 * - start/stop/restart process lifecycle
 * - report technical state transitions via callbacks
 * - keep this layer transport/ops-only (no timing business logic)
 */
export class AmmcProcessManager {
  private readonly binaryPath: string;
  private readonly argsTemplate: string[];
  private readonly restartDelayMs: number;
  private readonly onStatus: AmmcProcessManagerOptions["onStatus"];
  private readonly onWarning: AmmcProcessManagerOptions["onWarning"];

  private readonly processes = new Map<string, AmmcManagedProcess>();
  private readonly lastExitByTimingPoint = new Map<string, number>();

  constructor(options: AmmcProcessManagerOptions) {
    this.binaryPath = options.binaryPath ?? process.env.LIVETRACKING_AMMC_BIN ?? defaultBinaryPath();
    this.argsTemplate =
      options.argsTemplate ??
      (process.env.LIVETRACKING_AMMC_ARGS
        ? process.env.LIVETRACKING_AMMC_ARGS.split(" ").filter(Boolean)
        : ["--websocket", "{wsPort}", "--skip_telemetry_upload", "{decoderIp}"]);
    this.restartDelayMs = Math.max(200, options.restartDelayMs ?? 2000);
    this.onStatus = options.onStatus;
    this.onWarning = options.onWarning;
  }

  /**
   * Reconciles managed processes against the currently enabled timing points.
   * - extra running processes are stopped
   * - missing processes are started (subject to restart backoff)
   */
  sync(points: LiveTrackingTimingPoint[]) {
    const targetIds = new Set(points.map((p) => p.id));

    for (const [timingPointId] of this.processes) {
      if (!targetIds.has(timingPointId)) this.stop(timingPointId);
    }

    for (const point of points) {
      this.ensure(point);
    }
  }

  isRunning(timingPointId: string): boolean {
    return this.processes.has(timingPointId);
  }

  stop(timingPointId: string) {
    const existing = this.processes.get(timingPointId);
    if (!existing) return;

    existing.child.removeAllListeners();
    existing.child.kill();
    this.processes.delete(timingPointId);

    this.onStatus(existing.timingPoint, { processStatus: "stopped", lastError: null });
  }

  stopAll() {
    for (const timingPointId of this.processes.keys()) {
      this.stop(timingPointId);
    }
  }

  /**
   * Ensures one AMMC process exists for a timing point.
   *
   * Restart protection:
   * - after crashes/exits, starts are delayed by `restartDelayMs` to avoid rapid respawn loops.
   */
  private ensure(point: LiveTrackingTimingPoint) {
    if (this.processes.has(point.id)) return;

    const now = Date.now();
    const lastExit = this.lastExitByTimingPoint.get(point.id) ?? 0;
    if (now - lastExit < this.restartDelayMs) return;

    if (!fs.existsSync(this.binaryPath)) {
      this.onStatus(point, {
        processStatus: "error",
        lastError: `AMMC binary not found: ${this.binaryPath}`,
      });
      return;
    }

    const args = buildArgs(point, this.argsTemplate);
    this.onStatus(point, { processStatus: "starting", lastError: null });

    const commandForLog = [this.binaryPath, ...args].map((part) => JSON.stringify(part)).join(" ");
    console.log(`[livetracking-worker] starting AMMC for timingPoint=${point.id}: ${commandForLog}`);

    const child = spawn(this.binaryPath, args, {
      cwd: resolveWorkspaceRoot(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const managed: AmmcManagedProcess = {
      timingPoint: point,
      child,
      startedAtMs: now,
    };
    this.processes.set(point.id, managed);

    child.on("spawn", () => {
      this.onStatus(point, { processStatus: "running", lastError: null });
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line && this.onWarning) this.onWarning(`[ammc:${point.id}] ${line}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (!line) return;

      if (isLikelyErrorLogLine(line)) {
        console.error(`[livetracking-worker] AMMC stderr for timingPoint=${point.id}: ${line}`);
        this.onStatus(point, { processStatus: "error", lastError: line });
        return;
      }

      console.warn(`[livetracking-worker] AMMC stderr (info) for timingPoint=${point.id}: ${line}`);
      if (this.onWarning) this.onWarning(`[ammc:${point.id}] ${line}`);
    });

    child.on("error", (err) => {
      this.processes.delete(point.id);
      this.lastExitByTimingPoint.set(point.id, Date.now());
      console.error(`[livetracking-worker] AMMC process error for timingPoint=${point.id}: ${err.message}`);
      this.onStatus(point, {
        processStatus: "error",
        lastError: err.message,
      });
    });

    child.on("exit", (code, signal) => {
      const current = this.processes.get(point.id);
      if (current?.child === child) this.processes.delete(point.id);

      this.lastExitByTimingPoint.set(point.id, Date.now());

      const runtimeMs = Date.now() - managed.startedAtMs;
      const reason = `AMMC exited (code=${String(code)}, signal=${String(signal)}, runtimeMs=${runtimeMs})`;
      if (code !== 0) {
        console.error(`[livetracking-worker] AMMC process failed for timingPoint=${point.id}: ${reason}`);
      } else {
        console.log(`[livetracking-worker] AMMC process stopped for timingPoint=${point.id}: ${reason}`);
      }
      this.onStatus(point, {
        processStatus: code === 0 ? "stopped" : "error",
        lastError: code === 0 ? null : reason,
      });
    });
  }
}
