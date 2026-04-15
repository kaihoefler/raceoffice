import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export type LiveTrackingWorkerControlResult = {
  ok: boolean;
  running: boolean;
  pid: number | null;
  message: string;
};

export type LiveTrackingWorkerStatusSnapshot = {
  running: boolean;
  pid: number | null;
};

type RuntimeSync = {
  markStarting: (pid: number | null) => void;
  markStopping: (pid: number | null) => void;
  markOffline: (reason: string) => void;
};

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

type LiveTrackingWorkerManagerOptions = {
  repoRoot: string;
  liveTrackingServerUrl: string;
  logger: Logger;
  runtimeSync: RuntimeSync;
};

type ResolvedWorkerCommand =
  | {
    command: string;
    args: string[];
    cwd: string;
  }
  | {
    error: string;
  };


/**
 * Manages the singleton LiveTracking worker process for the server.
 *
 * Design goals:
 * - keep process lifecycle in one place (start/stop/status)
 * - make runtime-doc synchronization explicit via injected callbacks
 * - hide spawn/runtime command resolution details from route handlers
 */
export class LiveTrackingWorkerManager {
  private child: ChildProcess | null = null;
  private stopTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly options: LiveTrackingWorkerManagerOptions) { }

  private isRunningProcess(processRef: ChildProcess | null = this.child): processRef is ChildProcess {
    return !!processRef && processRef.exitCode === null && !processRef.killed;
  }

  private clearStopTimeout() {
    if (!this.stopTimeout) return;
    clearTimeout(this.stopTimeout);
    this.stopTimeout = null;
  }

  private resolveWorkerCommand(): ResolvedWorkerCommand {
    const workerDistEntry = path.join(this.options.repoRoot, "apps", "livetracking-worker", "dist", "index.js");
    if (fs.existsSync(workerDistEntry)) {
      return {
        command: process.execPath,
        args: [workerDistEntry, "--server", this.options.liveTrackingServerUrl],
        cwd: this.options.repoRoot,
      };
    }

    const workerSrcEntry = path.join(this.options.repoRoot, "apps", "livetracking-worker", "src", "index.ts");
    const tsxCliEntry = path.join(this.options.repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    if (fs.existsSync(workerSrcEntry) && fs.existsSync(tsxCliEntry)) {
      return {
        command: process.execPath,
        args: [tsxCliEntry, workerSrcEntry, "--server", this.options.liveTrackingServerUrl],
        cwd: this.options.repoRoot,
      };
    }

    return {
      error:
        "Worker start failed: no runnable worker entry found. " +
        `Checked dist entry: ${workerDistEntry}; ` +
        `checked dev entry: ${workerSrcEntry}; ` +
        `checked tsx runtime: ${tsxCliEntry}. ` +
        "Build @raceoffice/livetracking-worker and ensure deploy contains apps/livetracking-worker/dist + node_modules.",
    };
  }


  start(): LiveTrackingWorkerControlResult {
    if (this.isRunningProcess()) {
      return {
        ok: true,
        running: true,
        pid: this.child?.pid ?? null,
        message: "worker already running",
      };
    }

    const command = this.resolveWorkerCommand();
    if ("error" in command) {
      this.options.logger.warn({ scope: "livetracking-worker", reason: command.error }, "worker start rejected");
      this.options.runtimeSync.markOffline(command.error);
      return {
        ok: false,
        running: false,
        pid: null,
        message: command.error,
      };
    }


    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: {
        ...process.env,
        LIVETRACKING_SERVER_URL: this.options.liveTrackingServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;
    this.clearStopTimeout();

    child.stdout?.on("data", (chunk) => {
      this.options.logger.info(
        { scope: "livetracking-worker", pid: child.pid, line: String(chunk).trimEnd() },
        "worker stdout",
      );
    });

    child.stderr?.on("data", (chunk) => {
      this.options.logger.warn(
        { scope: "livetracking-worker", pid: child.pid, line: String(chunk).trimEnd() },
        "worker stderr",
      );
    });

    child.once("spawn", () => {
      this.options.runtimeSync.markStarting(child.pid ?? null);
    });

    child.once("error", (err) => {
      if (this.child === child) this.child = null;
      this.clearStopTimeout();

      const message = `Worker process spawn error: ${err.message}`;
      this.options.logger.warn({ scope: "livetracking-worker", pid: child.pid, error: err }, message);
      this.options.runtimeSync.markOffline(message);
    });

    child.once("exit", (code, signal) => {

      if (this.child === child) this.child = null;
      this.clearStopTimeout();

      const reason = signal ? `signal=${signal}` : `code=${String(code ?? "null")}`;
      this.options.logger.warn({ pid: child.pid, code, signal }, "livetracking worker exited");
      this.options.runtimeSync.markOffline(reason);
    });

    return {
      ok: true,
      running: true,
      pid: child.pid ?? null,
      message: `worker start requested (cmd=${command.command}, cwd=${command.cwd})`,
    };

  }

  stop(): LiveTrackingWorkerControlResult {
    if (!this.isRunningProcess()) {
      this.child = null;
      this.clearStopTimeout();
      this.options.runtimeSync.markOffline("stop requested while worker not running");
      return {
        ok: true,
        running: false,
        pid: null,
        message: "worker already stopped",
      };
    }

    const child = this.child!;
    this.options.runtimeSync.markStopping(child.pid ?? null);

    child.kill("SIGTERM");

    this.clearStopTimeout();
    this.stopTimeout = setTimeout(() => {
      if (!this.isRunningProcess(child)) return;
      this.options.logger.warn({ pid: child.pid }, "livetracking worker did not stop in time, sending SIGKILL");
      child.kill("SIGKILL");
    }, 5_000);

    return {
      ok: true,
      running: true,
      pid: child.pid ?? null,
      message: "worker stop requested",
    };
  }

  status(): LiveTrackingWorkerStatusSnapshot {
    return {
      running: this.isRunningProcess(),
      pid: this.child?.pid ?? null,
    };
  }
}
