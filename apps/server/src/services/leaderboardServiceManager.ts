import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

/**
 * Runs the leaderboard service (apps/leaderboard-service) as a child process of the RaceOffice
 * server ("managed" mode, doc/leaderboard-integration/05-worker-und-steuerung.md).
 *
 * - Entry: `dist/index.js`, fallback `tsx src/index.ts` (dev), like the LiveTracking worker.
 *   Note: dist wins – rebuild the service after changes.
 * - Binds to 127.0.0.1 only; the RaceOffice server reaches it through the /leaderboard proxy.
 * - A random control token per server start protects the service's control API; the proxy adds it.
 * - Restarts after a crash (at most 3 times within 60 s).
 */

export type LeaderboardProcessState = "stopped" | "starting" | "running" | "stopping" | "crashed";

export type LeaderboardProcessStatus = {
  state: LeaderboardProcessState;
  pid: number | null;
  port: number;
  startedAt: number | null;
  exitCode: number | null;
  lastError: string | null;
  restarts: number;
};

export type LeaderboardControlResult = { ok: boolean; message: string; status: LeaderboardProcessStatus };

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export type LeaderboardServiceManagerOptions = {
  repoRoot: string;
  /** Data directory of the service (config, recordings). */
  dataDir: string;
  /** Internal port on 127.0.0.1. */
  port: number;
  logger: Logger;
  /** Time to wait for /health after spawning. */
  startTimeoutMs?: number;
};

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS = 3;

export class LeaderboardServiceManager {
  readonly token = randomBytes(24).toString("hex");
  private child: ChildProcess | null = null;
  private state: LeaderboardProcessState = "stopped";
  private startedAt: number | null = null;
  private exitCode: number | null = null;
  private lastError: string | null = null;
  private stopRequested = false;
  private restartTimes: number[] = [];
  private killTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: LeaderboardServiceManagerOptions) {}

  get baseUrl(): string {
    return `http://127.0.0.1:${this.options.port}`;
  }

  status(): LeaderboardProcessStatus {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      port: this.options.port,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
      lastError: this.lastError,
      restarts: this.restartTimes.length,
    };
  }

  /** Starts the service and waits until /health answers (idempotent). */
  async start(): Promise<LeaderboardControlResult> {
    if (this.child && (this.state === "running" || this.state === "starting")) {
      await this.waitForHealth(this.child);
      return { ok: this.state === "running", message: "already running", status: this.status() };
    }
    this.stopRequested = false;
    const command = this.resolveCommand();
    if ("error" in command) {
      this.lastError = command.error;
      this.options.logger.warn({ scope: "leaderboard-service" }, command.error);
      return { ok: false, message: command.error, status: this.status() };
    }

    fs.mkdirSync(this.options.dataDir, { recursive: true });
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: { ...process.env, LEADERBOARD_CONTROL_TOKEN: this.token, LEADERBOARD_MODE: "managed" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.state = "starting";
    this.startedAt = Date.now();
    this.exitCode = null;
    this.lastError = null;

    const forward = (level: "info" | "warn") => (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.options.logger[level]({ scope: "leaderboard-service", pid: child.pid, line }, "service output");
      }
    };
    child.stdout?.on("data", forward("info"));
    child.stderr?.on("data", forward("warn"));
    child.once("error", (err) => {
      this.lastError = `spawn error: ${err.message}`;
    });
    child.once("exit", (code, signal) => this.onExit(child, code, signal));

    const healthy = await this.waitForHealth(child);
    if (!healthy) {
      return { ok: false, message: this.lastError ?? "service did not become healthy", status: this.status() };
    }
    return { ok: true, message: `started (pid ${child.pid})`, status: this.status() };
  }

  /** SIGTERM, then SIGKILL after 5 s. */
  async stop(): Promise<LeaderboardControlResult> {
    this.stopRequested = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      this.state = "stopped";
      return { ok: true, message: "already stopped", status: this.status() };
    }
    this.state = "stopping";
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      if (child.exitCode === null) {
        this.options.logger.warn({ pid: child.pid }, "leaderboard service did not stop in time, sending SIGKILL");
        child.kill("SIGKILL");
      }
    }, 5000);
    await exited;
    return { ok: true, message: "stopped", status: this.status() };
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
    if (this.child !== child) return;
    this.child = null;
    this.exitCode = code;
    const reason = signal ? `signal ${signal}` : `exit code ${String(code)}`;

    if (this.stopRequested) {
      this.state = "stopped";
      this.options.logger.info({ scope: "leaderboard-service", reason }, "leaderboard service stopped");
      return;
    }

    this.state = "crashed";
    this.lastError = this.lastError ?? `service exited unexpectedly (${reason})`;
    this.options.logger.warn({ scope: "leaderboard-service", reason }, "leaderboard service exited unexpectedly");

    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= MAX_RESTARTS) {
      this.lastError = `${this.lastError}; not restarted (${MAX_RESTARTS} crashes within 60 s)`;
      return;
    }
    this.restartTimes.push(now);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopRequested) void this.start();
    }, 1000);
  }

  private async waitForHealth(child: ChildProcess): Promise<boolean> {
    const deadline = Date.now() + (this.options.startTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      if (child.exitCode !== null || this.child !== child) return false;
      try {
        const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          if (this.child === child && this.state === "starting") this.state = "running";
          return this.state === "running";
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.lastError = "service did not answer /health in time";
    return false;
  }

  private resolveCommand(): { command: string; args: string[]; cwd: string } | { error: string } {
    const root = this.options.repoRoot;
    const args = [
      "--server-host",
      "127.0.0.1",
      "--server-port",
      String(this.options.port),
      "--data-dir",
      this.options.dataDir,
      "--mode",
      "managed",
    ];
    const dist = path.join(root, "apps", "leaderboard-service", "dist", "index.js");
    if (fs.existsSync(dist)) return { command: process.execPath, args: [dist, ...args], cwd: root };

    const src = path.join(root, "apps", "leaderboard-service", "src", "index.ts");
    const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    if (fs.existsSync(src) && fs.existsSync(tsx)) return { command: process.execPath, args: [tsx, src, ...args], cwd: root };

    return {
      error:
        "Leaderboard service start failed: no runnable entry found " +
        `(checked ${dist} and ${src} with tsx). Build @raceoffice/leaderboard-service.`,
    };
  }
}
