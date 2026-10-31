/**
 * SimulatorProcess – runs the decoder simulator `ammc-sim` (doc/timing-architecture.md, 2.1).
 *
 * `ammc-sim` simulates a MyLaps decoder on this machine: it listens on the MyLaps port 5403, so
 * only one can run at a time. Decoders in the register with address 127.0.0.1 (P3 or AMMC)
 * connect to it like to real hardware; the simulator itself is no decoder connection.
 *
 * - `apply(running, config)`: starts, stops or – on a config change – restarts the process.
 * - An unexpected exit is reported as error (e.g. port 5403 already in use) and not retried;
 *   the operator starts again after fixing the cause.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import {
  normalizeSimulatorDecoderId,
  normalizeSimulatorPassingDelay,
  type TimingSimulatorConfig,
  type TimingSimulatorStatus,
} from "@raceoffice/domain";
import { defaultBinaryPath, resolveWorkspaceRoot } from "../decoder/ammc/ammcProcessManager.js";

export type SimulatorSpawn = (binary: string, args: string[]) => ChildProcess;

/** Command line for `ammc-sim` (AMB decoder type). */
export function simulatorArgs(config: TimingSimulatorConfig): string[] {
  const transponders = config.transponderIds.map((t) => t.trim()).filter(Boolean);
  return [
    "AMB",
    "--decoder-id",
    normalizeSimulatorDecoderId(config.decoderId),
    "--passing-delay",
    normalizeSimulatorPassingDelay(config.passingDelay),
    "--startup_delay_secs",
    String(Math.max(0, Math.floor(config.startupDelaySecs) || 0)),
    "--tran_code",
    transponders.join(","),
    "--skip_telemetry_upload",
    ...(config.announceIp ? ["--my_ip", config.announceIp] : []),
  ];
}

export class SimulatorProcess {
  private child: ChildProcess | null = null;
  private runningKey: string | null = null;
  private current: TimingSimulatorStatus = { state: "stopped", startedAt: null, lastError: null, lastLine: null };
  private readonly binary: string;
  private readonly spawnImpl: SimulatorSpawn;

  constructor(
    private readonly onStatus: (status: TimingSimulatorStatus) => void,
    options: { binary?: string; spawnImpl?: SimulatorSpawn } = {},
  ) {
    this.binary = options.binary ?? process.env.LIVETRACKING_AMMC_SIM_BIN ?? defaultBinaryPath("sim");
    this.spawnImpl =
      options.spawnImpl ?? ((binary, args) => spawn(binary, args, { cwd: resolveWorkspaceRoot(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
  }

  get status(): TimingSimulatorStatus {
    return this.current;
  }

  /** Reconciles the process with the operator wish. */
  apply(running: boolean, config: TimingSimulatorConfig): void {
    const key = running ? JSON.stringify(simulatorArgs(config)) : null;
    if (key === this.runningKey) return;
    this.stop();
    if (!running) return;
    if (config.transponderIds.filter((t) => t.trim()).length === 0) {
      this.setStatus({ state: "error", startedAt: null, lastError: "Keine Transponder eingetragen", lastLine: null });
      this.runningKey = key;
      return;
    }
    if (this.binary !== "ammc-sim" && !fs.existsSync(this.binary)) {
      this.setStatus({ state: "error", startedAt: null, lastError: `Simulator nicht gefunden: ${this.binary}`, lastLine: null });
      this.runningKey = key;
      return;
    }
    this.start(config, key!);
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.runningKey = null;
    if (child) {
      child.removeAllListeners();
      child.kill();
    }
    if (this.current.state !== "stopped" || this.current.lastError) {
      this.setStatus({ state: "stopped", startedAt: null, lastError: null, lastLine: this.current.lastLine });
    }
  }

  private start(config: TimingSimulatorConfig, key: string): void {
    const args = simulatorArgs(config);
    console.log(`[livetracking-worker] starting decoder simulator: ${[this.binary, ...args].join(" ")}`);
    const child = this.spawnImpl(this.binary, args);
    this.child = child;
    this.runningKey = key;
    this.setStatus({ state: "starting", startedAt: new Date().toISOString(), lastError: null, lastLine: null });

    const onLine = (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim().split(/\r?\n/).pop() ?? "";
      if (!line || this.child !== child) return;
      // "Listening on: 5403" = ready for decoder connections.
      const state = /listening on/i.test(line) ? "running" : this.current.state;
      this.setStatus({ ...this.current, state, lastLine: line.slice(0, 300) });
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    child.on("spawn", () => {
      if (this.child === child && this.current.state === "starting") this.setStatus({ ...this.current, state: "running" });
    });
    child.on("error", (err) => {
      if (this.child !== child) return;
      this.child = null;
      this.setStatus({ ...this.current, state: "error", lastError: err.message });
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.setStatus({
        ...this.current,
        state: "error",
        lastError: `Simulator beendet (Code ${String(code)}${signal ? `, Signal ${signal}` : ""}) – läuft schon ein Simulator oder belegt etwas Port 5403?`,
      });
    });
  }

  private setStatus(status: TimingSimulatorStatus): void {
    this.current = status;
    this.onStatus(status);
  }
}
