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
  mode: DecoderExecutableKind;
  ambChild: ChildProcess;
  simChild: ChildProcess | null;
  startedAtMs: number;
};


export type AmmcProcessManagerOptions = {
  /** AMB converter binary path override (physical decoder mode). */
  ambBinaryPath?: string;

  /** Simulator binary path override (`ammc-sim`). */
  simBinaryPath?: string;

  /** AMB argument template (placeholders: wsPort, decoderIp, decoderId, timingPointId). */
  ambArgsTemplate?: string[];

  /**
   * Simulator argument template.
   * Additional placeholders:
   * - {tranCodesCsv}
   * - {passingDelay}
   * - {startupDelaySecs}
   */
  simArgsTemplate?: string[];

  /**
   * Legacy aliases kept for backward compatibility.
   * - `binaryPath` maps to `ambBinaryPath`
   * - `argsTemplate` maps to `ambArgsTemplate`
   */
  binaryPath?: string;
  argsTemplate?: string[];

  restartDelayMs?: number;
  onStatus: (timingPoint: LiveTrackingTimingPoint, patch: AmmcProcessStatusPatch) => void;
  onWarning?: (warning: string) => void;
};

type DecoderExecutableKind = "amb" | "sim";


function resolveWorkspaceRoot(): string {
  // src/ammcProcessManager.ts -> livetracking-worker -> apps -> workspace root
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../..");
}

/**
 * Resolves platform-specific default AMM converter binaries shipped in this repository.
 */
function defaultBinaryPath(kind: DecoderExecutableKind): string {
  const root = resolveWorkspaceRoot();
  const ammcPath = "tools/ammc/";
  const suffix = kind === "sim" ? "sim" : "amb";

  if (process.platform === "win32") {
    return path.resolve(root, `${ammcPath}windows64/ammc-${suffix}.exe`);
  }
  if (process.platform === "darwin") {
    return path.resolve(root, `${ammcPath}apple_m/ammc-${suffix}`);
  }
  return path.resolve(root, `${ammcPath}linux_x86-64/ammc-${suffix}`);
}


function resolveDecoderType(point: LiveTrackingTimingPoint): DecoderExecutableKind {
  return point.decoderType === "sim" ? "sim" : "amb";
}

function formatCommand(binaryPath: string, args: string[]): string {
  return [binaryPath, ...args].map((part) => JSON.stringify(part)).join(" ");
}


function normalizeSimTranCodes(point: LiveTrackingTimingPoint): string[] {
  const raw = Array.isArray(point.simTranCodes) ? point.simTranCodes : [];
  const cleaned = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : ["SIM-0001"];
}

/**
 * ammc-sim expects passing-delay as range: "from-to" (ms).
 *
 * Accepted input forms:
 * - "23000-24000" -> kept as is (normalized)
 * - "23000" -> converted to "23000-24000"
 * - invalid/empty -> fallback "1000-2000"
 */
function normalizeSimPassingDelayRange(rawValue: unknown): string {
  const raw = String(rawValue ?? "").trim();

  const rangeMatch = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const from = Math.max(0, Number(rangeMatch[1]));
    const to = Math.max(from, Number(rangeMatch[2]));
    return `${from}-${to}`;
  }

  const single = Number(raw);
  if (Number.isFinite(single) && single >= 0) {
    const from = Math.floor(single);
    const to = from + 1000;
    return `${from}-${to}`;
  }

  return "1000-2000";
}

/**
 * Expands AMMC argument template placeholders with timing-point specific values.
 */
function buildArgs(point: LiveTrackingTimingPoint, template: string[]): string[] {
  const tranCodesCsv = normalizeSimTranCodes(point).join(",");
  const passingDelay = normalizeSimPassingDelayRange(point.simPassingDelay);
  const startupDelaySecs = String(Math.max(0, Number(point.simStartupDelaySecs ?? 0) || 0));


  return template.map((token) =>
    token
      .replaceAll("{wsPort}", String(point.websocketPortAMM))
      .replaceAll("{decoderIp}", point.decoderIp)
      .replaceAll("{decoderId}", point.decoderId)
      .replaceAll("{timingPointId}", point.id)
      .replaceAll("{tranCodesCsv}", tranCodesCsv)
      .replaceAll("{passingDelay}", passingDelay)
      .replaceAll("{startupDelaySecs}", startupDelaySecs),
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
  private readonly ambBinaryPath: string;
  private readonly simBinaryPath: string;
  private readonly ambArgsTemplate: string[];
  private readonly simArgsTemplate: string[];
  private readonly restartDelayMs: number;

  private readonly onStatus: AmmcProcessManagerOptions["onStatus"];
  private readonly onWarning: AmmcProcessManagerOptions["onWarning"];

  private readonly processes = new Map<string, AmmcManagedProcess>();
  private readonly lastExitByTimingPoint = new Map<string, number>();

    constructor(options: AmmcProcessManagerOptions) {
    // Legacy compatibility: old `binaryPath/argsTemplate` still configure AMB mode.
    this.ambBinaryPath =
      options.ambBinaryPath ??
      options.binaryPath ??
      process.env.LIVETRACKING_AMMC_BIN ??
      defaultBinaryPath("amb");
    this.simBinaryPath =
      options.simBinaryPath ??
      process.env.LIVETRACKING_AMMC_SIM_BIN ??
      defaultBinaryPath("sim");

    this.ambArgsTemplate =
      options.ambArgsTemplate ??
      options.argsTemplate ??
      (process.env.LIVETRACKING_AMMC_ARGS
        ? process.env.LIVETRACKING_AMMC_ARGS.split(" ").filter(Boolean)
        : ["--websocket", "{wsPort}", "--skip_telemetry_upload", "{decoderIp}"]);

        this.simArgsTemplate =
      options.simArgsTemplate ??
      (process.env.LIVETRACKING_AMMC_SIM_ARGS
        ? process.env.LIVETRACKING_AMMC_SIM_ARGS.split(" ").filter(Boolean)
        : [
            "AMB",
            "--decoder-id",
            "{decoderId}",
            "--passing-delay",
            "{passingDelay}",
            "--startup_delay_secs",
            "{startupDelaySecs}",
            "--tran_code",
            "{tranCodesCsv}",
          ]);


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
      const existing = this.processes.get(point.id);
      const expectedMode = resolveDecoderType(point);

      // If operator toggles amb/sim mode, restart process pair with new mode.
      if (existing && existing.mode !== expectedMode) {
        this.stop(point.id);
      }

      this.ensure(point);
    }
  }

  isRunning(timingPointId: string): boolean {
    const managed = this.processes.get(timingPointId);
    if (!managed) return false;
    return !!managed.ambChild && !managed.ambChild.killed;
  }

  stop(timingPointId: string) {
    const existing = this.processes.get(timingPointId);
    if (!existing) return;

    existing.ambChild.removeAllListeners();
    existing.ambChild.kill();

    if (existing.simChild) {
      existing.simChild.removeAllListeners();
      existing.simChild.kill();
    }

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

    const mode = resolveDecoderType(point);
    const needsSimulator = mode === "sim";

    if (needsSimulator && (!point.simTranCodes || point.simTranCodes.length === 0)) {
      this.onWarning?.(
        `[ammc:${point.id}] simulator selected without simTranCodes; using fallback transponder SIM-0001`,
      );
    }

    if (!fs.existsSync(this.ambBinaryPath)) {
      this.onStatus(point, {
        processStatus: "error",
        lastError: `AMMC amb binary not found: ${this.ambBinaryPath}`,
      });
      return;
    }

    if (needsSimulator && !fs.existsSync(this.simBinaryPath)) {
      this.onStatus(point, {
        processStatus: "error",
        lastError: `AMMC sim binary not found: ${this.simBinaryPath}`,
      });
      return;
    }

    this.onStatus(point, { processStatus: "starting", lastError: null });

    const handleChildError = (kind: DecoderExecutableKind, err: Error) => {
      const current = this.processes.get(point.id);
      if (!current) return;

      this.processes.delete(point.id);
      this.lastExitByTimingPoint.set(point.id, Date.now());

      const message = `[${kind}] ${err.message}`;
      console.error(`[livetracking-worker] AMMC process error for timingPoint=${point.id}: ${message}`);
      this.onStatus(point, {
        processStatus: "error",
        lastError: message,
      });

      current.ambChild.removeAllListeners();
      current.ambChild.kill();
      if (current.simChild) {
        current.simChild.removeAllListeners();
        current.simChild.kill();
      }
    };

    const handleChildExit = (kind: DecoderExecutableKind, code: number | null, signal: NodeJS.Signals | null) => {
      const current = this.processes.get(point.id);
      if (!current) return;

      this.processes.delete(point.id);
      this.lastExitByTimingPoint.set(point.id, Date.now());

      const runtimeMs = Date.now() - current.startedAtMs;
      const reason = `[${kind}] exited (code=${String(code)}, signal=${String(signal)}, runtimeMs=${runtimeMs})`;
      if (code !== 0) {
        console.error(`[livetracking-worker] AMMC process failed for timingPoint=${point.id}: ${reason}`);
      } else {
        console.log(`[livetracking-worker] AMMC process stopped for timingPoint=${point.id}: ${reason}`);
      }

      this.onStatus(point, {
        processStatus: code === 0 ? "stopped" : "error",
        lastError: code === 0 ? null : reason,
      });

      current.ambChild.removeAllListeners();
      current.ambChild.kill();
      if (current.simChild) {
        current.simChild.removeAllListeners();
        current.simChild.kill();
      }
    };

    const wireChild = (kind: DecoderExecutableKind, child: ChildProcess) => {
      child.stdout?.on("data", (chunk: Buffer) => {
        const line = chunk.toString("utf8").trim();
        if (line && this.onWarning) this.onWarning(`[ammc:${kind}:${point.id}] ${line}`);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString("utf8").trim();
        if (!line) return;

        if (isLikelyErrorLogLine(line)) {
          console.error(`[livetracking-worker] AMMC ${kind} stderr for timingPoint=${point.id}: ${line}`);
          this.onStatus(point, { processStatus: "error", lastError: `[${kind}] ${line}` });
          return;
        }

        console.warn(`[livetracking-worker] AMMC ${kind} stderr (info) for timingPoint=${point.id}: ${line}`);
        if (this.onWarning) this.onWarning(`[ammc:${kind}:${point.id}] ${line}`);
      });

      child.on("error", (err) => handleChildError(kind, err));
      child.on("exit", (code, signal) => handleChildExit(kind, code, signal));
    };

    let simChild: ChildProcess | null = null;
    if (needsSimulator) {
      const simArgs = buildArgs(point, this.simArgsTemplate);
      console.log(
        `[livetracking-worker] starting AMMC (sim) for timingPoint=${point.id}: ${formatCommand(this.simBinaryPath, simArgs)}`,
      );
      simChild = spawn(this.simBinaryPath, simArgs, {
        cwd: resolveWorkspaceRoot(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      wireChild("sim", simChild);
    }

    const ambArgs = buildArgs(point, this.ambArgsTemplate);
    console.log(
      `[livetracking-worker] starting AMMC (amb) for timingPoint=${point.id}: ${formatCommand(this.ambBinaryPath, ambArgs)}`,
    );
    const ambChild = spawn(this.ambBinaryPath, ambArgs, {
      cwd: resolveWorkspaceRoot(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    wireChild("amb", ambChild);

    const managed: AmmcManagedProcess = {
      timingPoint: point,
      mode,
      ambChild,
      simChild,
      startedAtMs: now,
    };
    this.processes.set(point.id, managed);

    // Runtime websocket sync depends on AMB converter; mark running when AMB process is ready.
    ambChild.on("spawn", () => {
      this.onStatus(point, { processStatus: "running", lastError: null });
    });
  }

}
