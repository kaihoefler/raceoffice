import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(path: string) => boolean>(),
  spawnMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: existsSyncMock,
  },
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { LiveTrackingWorkerManager } from "./liveTrackingWorkerManager.js";

class FakeChildProcess extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.emit("kill", signal);
    return true;
  }
}

function createManager() {
  const runtimeSync = {
    markStarting: vi.fn(),
    markStopping: vi.fn(),
    markOffline: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  const manager = new LiveTrackingWorkerManager({
    repoRoot: "C:/repo",
    liveTrackingServerUrl: "http://127.0.0.1:8787",
    runtimeSync,
    logger,
  });

  return { manager, runtimeSync, logger };
}

describe("LiveTrackingWorkerManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
  });

  it("starts worker and publishes starting runtime sync on spawn", () => {
    const child = new FakeChildProcess(4242);
    spawnMock.mockReturnValueOnce(child);

    const { manager, runtimeSync } = createManager();

    const result = manager.start();
    expect(result.ok).toBe(true);
    expect(result.running).toBe(true);
    expect(result.pid).toBe(4242);

    child.emit("spawn");
    expect(runtimeSync.markStarting).toHaveBeenCalledWith(4242);
  });

  it("stops running worker and transitions runtime to stopping", () => {
    const child = new FakeChildProcess(7788);
    spawnMock.mockReturnValueOnce(child);

    const { manager, runtimeSync } = createManager();
    manager.start();

    const stopResult = manager.stop();
    expect(stopResult.ok).toBe(true);
    expect(stopResult.running).toBe(true);
    expect(runtimeSync.markStopping).toHaveBeenCalledWith(7788);
  });

  it("marks runtime offline on child exit", () => {
    const child = new FakeChildProcess(1111);
    spawnMock.mockReturnValueOnce(child);

    const { manager, runtimeSync } = createManager();
    manager.start();

    child.emit("exit", 0, null);

    expect(runtimeSync.markOffline).toHaveBeenCalledWith("code=0");
    expect(manager.status().running).toBe(false);
  });

  it("returns error when no worker command can be resolved", () => {
    existsSyncMock.mockReturnValue(false);

    const { manager } = createManager();
    const result = manager.start();

    expect(result.ok).toBe(false);
    expect(result.running).toBe(false);
    expect(result.message).toContain("Worker entry not found");
  });
});
