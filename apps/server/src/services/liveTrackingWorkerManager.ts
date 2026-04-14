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

  constructor(private readonly options: LiveTrackingWorkerManagerOptions) {}

  private isRunningProcess(processRef: ChildProcess | null = this.child): processRef is ChildProcess {
    return !!processRef && processRef.exitCode === null && !processRef.killed;
  }

  private clearStopTimeout() {
    if (!this.stopTimeout) return;
    clearTimeout(this.stopTimeout);
    this.stopTimeout = null;
  }

  private resolveWorkerCommand(): { command: string; args: string[]; cwd: string } | null {
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

    return null;
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
    if (!command) {
      return {
        ok: false,
        running: false,
        pid: null,
        message: "Worker entry not found. Build livetracking-worker or provide tsx runtime.",
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
      message: "worker start requested",
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
