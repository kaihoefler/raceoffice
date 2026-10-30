import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, defaultConfig, loadConfig, parseCliArgs } from "../src/config.js";

describe("configuration", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const d = mkdtempSync(join(tmpdir(), "leaderboard-config-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("has the documented defaults", () => {
    const c = loadConfig(["--data-dir", tempDir()], {});
    expect(c.server).toEqual({ host: "0.0.0.0", port: 8080 });
    expect(c.client).toMatchObject({ host: "127.0.0.1", port: 50000, encoding: "windows-1252", retryMax: -1, autoConnect: false });
    expect(c.state).toEqual({ corrections: "apply", maxRaces: 200 });
  });

  it("accepts the Java CLI flags", () => {
    const layer = parseCliArgs([
      "--headless",
      "-c",
      "--host",
      "192.168.1.20",
      "--port=50001",
      "--client-stream-encoding",
      "utf-8",
      "--client-max-retries",
      "3",
      "-s",
      "--server-port",
      "8081",
      "--recorder-file",
      "C:\\rec\\day1.txt",
      "--loglevel=DEBUG",
    ]);
    expect(layer.client).toEqual({ autoConnect: true, host: "192.168.1.20", port: 50001, encoding: "utf-8", retryMax: 3 });
    expect(layer.server).toEqual({ port: 8081 });
    expect(layer.recorder).toEqual({ autoStart: true, name: "day1" });
    expect(layer.logLevel).toBe("debug");
    expect(() => parseCliArgs(["--nope"])).toThrow(ConfigError);
    expect(() => parseCliArgs(["--port"])).toThrow(ConfigError);
  });

  it("applies CLI > ENV > file > defaults", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "leaderboard.config.json"),
      JSON.stringify({ client: { host: "file-host", port: 50010, encoding: "latin1" }, server: { port: 1 }, junk: 1 }),
    );
    const c = loadConfig(["--data-dir", dir, "--port", "50030"], { RMONITOR_PORT: "50020", RMONITOR_HOST: "env-host" });
    expect(c.client.host).toBe("env-host");
    expect(c.client.port).toBe(50030);
    expect(c.client.encoding).toBe("latin1");
    // server settings are never taken from the file
    expect(c.server.port).toBe(defaultConfig().server.port);
  });

  it("reads Docker-style ENV", () => {
    const c = loadConfig([], {
      LEADERBOARD_DATA_DIR: tempDir(),
      AUTOCONNECT: "true",
      PORT: "9000",
      RECORDER_AUTOSTART: "yes",
      LEADERBOARD_CONTROL_TOKEN: "t",
      LEADERBOARD_MODE: "managed",
    });
    expect(c.client.autoConnect).toBe(true);
    expect(c.server.port).toBe(9000);
    expect(c.recorder.autoStart).toBe(true);
    expect(c.controlToken).toBe("t");
    expect(c.mode).toBe("managed");
  });

  it("rejects invalid values", () => {
    expect(() => loadConfig(["--data-dir", tempDir(), "--client-stream-encoding", "klingon"], {})).toThrow(ConfigError);
    expect(() => loadConfig(["--data-dir", tempDir()], { AUTOCONNECT: "maybe" })).toThrow(ConfigError);
    expect(() => loadConfig(["--data-dir", tempDir(), "--mode", "x"], {})).toThrow(ConfigError);
  });
});
