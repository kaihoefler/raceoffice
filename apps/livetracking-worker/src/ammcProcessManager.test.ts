import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveTrackingTimingPoint } from "@raceoffice/domain";
import { AmmcProcessManager } from "./ammcProcessManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");

function resolveAmmcBinary(decoder: "amb" | "sim"): string {
  if (process.platform === "win32") {
    return path.resolve(workspaceRoot, `tools/ammc/windows64/ammc-${decoder}.exe`);
  }
  if (process.platform === "darwin") {
    return path.resolve(workspaceRoot, `tools/ammc/apple_m/ammc-${decoder}`);
  }
  return path.resolve(workspaceRoot, `tools/ammc/linux_x86-64/ammc-${decoder}`);
}

function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out waiting for condition"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForWebsocketMessage(url: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for websocket message on ${url}`));
    }, timeoutMs);

    ws.on("message", (data) => {
      clearTimeout(timer);
      const text = typeof data === "string" ? data : data.toString("utf8");
      ws.close();
      resolve(text);
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("AmmcProcessManager integration (AMB + simulator)", () => {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children) {
      try {
        child.kill();
      } catch {}
    }
    children.length = 0;
  });

  it("starts/stops AMMC process and receives passing stream from simulator", async () => {
    const wsPort = 19121;
    const timingPoint: LiveTrackingTimingPoint = {
      id: "tp-amb-1",
      name: "AMB Start/Finish",
      decoderId: "AMB-DEC-1",
      decoderIp: "127.0.0.1",
      websocketPortAMM: wsPort,
      order: 1,
      distanceFromPreviousM: 0,
      absolutePositionM: 0,
      role: "start_finish",
      enabled: true,
    };

    const sim = spawn(resolveAmmcBinary("sim"), [
      "AMB",
      "--passing-numbers",
      "1-25",
      "--passing-delay",
      "100-200",
      "--startup_delay_secs",
      "1",
      "--transponder",
      "12345",
      "--skip_telemetry_upload",
    ]);
    children.push(sim);

    const statuses: Array<string> = [];
    const manager = new AmmcProcessManager({
      binaryPath: resolveAmmcBinary("amb"),
      argsTemplate: ["--websocket", "{wsPort}", "--skip_telemetry_upload", "{decoderIp}"],
      restartDelayMs: 500,
      onStatus: (_point, patch) => {
        statuses.push(patch.processStatus);
      },
      onWarning: () => {
        // integration test only checks lifecycle + websocket passings
      },
    });

    try {
      manager.sync([timingPoint]);

    await waitFor(() => statuses.includes("running"), 10000);

      const raw = await waitForWebsocketMessage(`ws://127.0.0.1:${wsPort}`, 12000);
      expect(raw).toContain("transponder");

      manager.stopAll();
      await waitFor(() => statuses.includes("stopped"), 5000);
    } finally {
      manager.stopAll();
    }
  });

  it("retries process start on repeated sync when converter exits with error", async () => {
    const timingPoint: LiveTrackingTimingPoint = {
      id: "tp-amb-restart",
      name: "AMB Restart Test",
      decoderId: "AMB-DEC-R",
      decoderIp: "127.0.0.1",
      websocketPortAMM: 19122,
      order: 1,
      distanceFromPreviousM: 0,
      absolutePositionM: 0,
      role: "start_finish",
      enabled: true,
    };

    const statuses: Array<string> = [];
    const manager = new AmmcProcessManager({
      binaryPath: resolveAmmcBinary("amb"),
      // Force immediate converter failure to verify restart attempts.
      argsTemplate: ["--definitely-invalid-flag", "{decoderIp}"],
      restartDelayMs: 200,
      onStatus: (_point, patch) => {
        statuses.push(patch.processStatus);
      },
    });

    try {
      for (let i = 0; i < 25; i += 1) {
        manager.sync([timingPoint]);
        await sleep(120);
      }

      const starts = statuses.filter((x) => x === "starting").length;
      expect(starts).toBeGreaterThanOrEqual(2);
      expect(statuses.includes("error")).toBe(true);
    } finally {
      manager.stopAll();
    }
  });

  it("stops running process when timing point is removed from sync target", async () => {
    const wsPort = 19123;
    const timingPoint: LiveTrackingTimingPoint = {
      id: "tp-amb-sync-remove",
      name: "AMB Sync Remove",
      decoderId: "AMB-DEC-S",
      decoderIp: "127.0.0.1",
      websocketPortAMM: wsPort,
      order: 1,
      distanceFromPreviousM: 0,
      absolutePositionM: 0,
      role: "start_finish",
      enabled: true,
    };

    const sim = spawn(resolveAmmcBinary("sim"), [
      "AMB",
      "--passing-numbers",
      "1-60",
      "--passing-delay",
      "100-200",
      "--startup_delay_secs",
      "1",
      "--transponder",
      "67890",
      "--skip_telemetry_upload",
    ]);
    children.push(sim);

    const statuses: Array<string> = [];
    const manager = new AmmcProcessManager({
      binaryPath: resolveAmmcBinary("amb"),
      argsTemplate: ["--websocket", "{wsPort}", "--skip_telemetry_upload", "{decoderIp}"],
      restartDelayMs: 500,
      onStatus: (_point, patch) => {
        statuses.push(patch.processStatus);
      },
    });

    try {
      manager.sync([timingPoint]);
      await waitFor(() => statuses.includes("running"), 10000);

      manager.sync([]);
      await waitFor(() => statuses.includes("stopped"), 5000);
    } finally {
      manager.stopAll();
    }
  });
});
