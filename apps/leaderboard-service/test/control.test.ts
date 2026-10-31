/**
 * Control API: Orbits connection incl. reconnect, recorder, recordings, player, token, config.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeOrbitsFeeder } from "@raceoffice/rmonitor/testing";
import type { LeaderboardServiceStatus } from "@raceoffice/domain";
import { getJson, postJson, RMONITOR_FIXTURES, startService, waitFor, type TestService } from "./helpers.js";

type Status = LeaderboardServiceStatus;

const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });

const status = async (svc: TestService) => (await getJson<Status>(`${svc.baseUrl}/api/status`)).body;

describe("control API", () => {
  let svc: TestService | null = null;
  let feeder: FakeOrbitsFeeder | null = null;

  afterEach(async () => {
    await feeder?.close();
    await svc?.close();
    feeder = null;
    svc = null;
  });

  it("connects, reconnects after a lost connection and disconnects", async () => {
    feeder = FakeOrbitsFeeder.fromMessages(['$B,1,"R"', '$F,0,"00:00:00","12:00:00","00:00:01","Green "']);
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port, retryTimeoutMs: 50 } });
    const s = svc;

    const res = await postJson<Status>(`${s.baseUrl}/api/client/connect`);
    expect(res.body.source).toBe("rmonitor");
    await feeder.waitForClients(1);
    await waitFor(async () => (await status(s)).client.state === "connected", 2000, "connected");
    await feeder.sendNext(2);
    await waitFor(async () => (await status(s)).race.currentId === 1, 2000, "race 1");

    feeder.disconnectClients();
    await waitFor(async () => ["retrying", "connecting"].includes((await status(s)).client.state), 2000, "retrying");
    await feeder.waitForClients(1, 3000);
    await waitFor(async () => (await status(s)).client.state === "connected", 2000, "reconnected");

    await postJson(`${s.baseUrl}/api/client/disconnect`);
    const after = await status(s);
    expect(after.client.state).toBe("stopped");
    expect(after.source).toBe("none");
  });

  it("keeps retrying until Orbits comes up; gives up after retryMax", async () => {
    const port = await freePort();
    svc = await startService({ client: { host: "127.0.0.1", port, retryTimeoutMs: 50 } });
    const s = svc;
    await postJson(`${s.baseUrl}/api/client/connect`);
    await waitFor(async () => (await status(s)).client.retry.attempt >= 2, 3000, "retries");

    feeder = FakeOrbitsFeeder.fromMessages([]);
    // Bind the feeder to the port the service is retrying.
    feeder = new FakeOrbitsFeeder([], { port });
    await feeder.start();
    await feeder.waitForClients(1, 3000);
    await waitFor(async () => (await status(s)).client.state === "connected", 2000, "connected");

    // retryMax = 1 against a dead port → error
    const deadPort = await freePort();
    await postJson(`${s.baseUrl}/api/client/disconnect`);
    await getJson(`${s.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { retryMax: 1 } }),
    });
    await postJson(`${s.baseUrl}/api/client/connect`, { port: deadPort });
    await waitFor(async () => (await status(s)).client.state === "error", 3000, "error state");
  });

  it("reconnects when Orbits goes silent (idle timeout)", async () => {
    feeder = FakeOrbitsFeeder.fromMessages(['$F,0,"00:00:00","12:00:00","00:00:00","      "']);
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port, retryTimeoutMs: 20, idleTimeoutMs: 200 } });
    const s = svc;
    await postJson(`${s.baseUrl}/api/client/connect`);
    await feeder.waitForClients(1);
    await waitFor(async () => (await status(s)).client.lastError?.includes("no data") ?? false, 3000, "idle detected");
    await waitFor(async () => (await status(s)).client.state === "connected", 3000, "reconnected");
  });

  it("records live lines byte-exact in the Java recording format", async () => {
    // "Jörg" in windows-1252 (latin1) – must stay a single 0xF6 byte in the file.
    feeder = FakeOrbitsFeeder.fromMessages(['$B,1,"R"', '$A,"1","1",T,"Jörg","X","GER",1']);
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port } });
    const s = svc;
    const started = await postJson<{ file: string }>(`${s.baseUrl}/api/recorder/start`, { name: "test run" });
    expect(started.body.file).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_test run\.txt$/);
    await postJson(`${s.baseUrl}/api/client/connect`);
    await feeder.waitForClients(1);
    await feeder.sendNext(2);
    await waitFor(async () => (await status(s)).recorder.lines === 2, 2000, "2 lines recorded");
    await postJson(`${s.baseUrl}/api/recorder/stop`);

    const res = await fetch(`${s.baseUrl}/api/recordings/${encodeURIComponent(started.body.file)}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const lines = bytes.toString("latin1").split("\r\n");
    expect(lines[0]).toBe('0 $B,1,"R"');
    expect(lines[1]).toMatch(/^\d+ \$A,"1","1",T,"Jörg","X","GER",1$/);
    expect(bytes.includes(Buffer.from([0xf6]))).toBe(true);

    const list = await getJson<Array<{ file: string; lines: number }>>(`${s.baseUrl}/api/recordings`);
    expect(list.body).toEqual([expect.objectContaining({ file: started.body.file, lines: 2 })]);
  });

  it("uploads, replays (fast, seek, pause/resume), downloads and deletes recordings", async () => {
    svc = await startService({ publish: { coalesceMs: 0 } });
    const s = svc;
    const data = readFileSync(join(RMONITOR_FIXTURES, "recordings/leaderboard-Dobbin_simu.txt"));

    const upload = await getJson<{ file: string }>(`${s.baseUrl}/api/recordings/dobbin.txt`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: data,
    });
    expect(upload.status).toBe(201);
    expect(upload.body.file).toBe("dobbin.txt");
    expect((await getJson(`${s.baseUrl}/api/recordings/..%2Fevil.txt`)).status).toBe(400);

    // ~60 s recording at 2000x → ~30 ms
    const start = await postJson<Status>(`${s.baseUrl}/api/player/start`, { file: "dobbin.txt", speedup: 2000 });
    expect(start.status).toBe(200);
    expect(start.body.source).toBe("player");
    await waitFor(async () => (await status(s)).player.state === "idle", 3000, "replay finished");
    const end = await status(s);
    expect(end.player.progress).toBe(1);
    const race = (await getJson<Array<{ raceID: number; flagStatus: string }>>(`${s.baseUrl}/races?filter=current`)).body[0];
    expect(race).toMatchObject({ raceID: 57, flagStatus: "FINISH" });

    // Seek to the middle while idle → paused at that position with the state rebuilt.
    const seek = await postJson<Status>(`${s.baseUrl}/api/player/seek`, { positionMs: 20_000 });
    expect(seek.body.player).toMatchObject({ state: "paused", positionMs: 20_000 });
    const mid = (await getJson<Array<{ raceID: number; flagStatus: string }>>(`${s.baseUrl}/races?filter=current`)).body[0];
    expect(mid?.raceID).toBe(57);
    expect(mid?.flagStatus).not.toBe("FINISH");

    await postJson(`${s.baseUrl}/api/player/resume`);
    expect((await status(s)).player.state).not.toBe("paused");
    expect((await getJson(`${s.baseUrl}/api/recordings/dobbin.txt`, { method: "DELETE" })).status).toBe(409);
    await postJson(`${s.baseUrl}/api/player/stop`);

    const download = Buffer.from(await (await fetch(`${s.baseUrl}/api/recordings/dobbin.txt`)).arrayBuffer());
    expect(download.equals(data)).toBe(true);
    expect((await getJson(`${s.baseUrl}/api/recordings/dobbin.txt`, { method: "DELETE" })).status).toBe(204);
    expect((await getJson(`${s.baseUrl}/api/recordings/dobbin.txt`)).status).toBe(404);
  });

  it("detects UTF-8 recording files (Java recorder setting) and decodes names correctly", async () => {
    svc = await startService({ publish: { coalesceMs: 0 } });
    const s = svc;
    const data = readFileSync(join(RMONITOR_FIXTURES, "recordings/excerpt_utf8-recording-file.txt"));
    await fetch(`${s.baseUrl}/api/recordings/utf8.txt`, { method: "PUT", headers: { "content-type": "text/plain" }, body: data });
    await postJson(`${s.baseUrl}/api/player/start`, { file: "utf8.txt", speedup: 100_000 });
    await waitFor(async () => (await status(s)).player.state === "idle", 5000, "replay finished");
    expect((await status(s)).player).toMatchObject({ encoding: "utf-8" });
    const races = (await getJson<Array<{ competitors: Array<{ firstName: string }> }>>(`${s.baseUrl}/races`)).body;
    const names = races.flatMap((r) => r.competitors.map((c) => c.firstName));
    expect(names.some((n) => n.includes("é"))).toBe(true);
    expect(names.some((n) => n.includes("Ã"))).toBe(false);
  });

  it("switching from replay to live resets the race state", async () => {
    feeder = FakeOrbitsFeeder.fromMessages([]);
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port }, publish: { coalesceMs: 0 } });
    const s = svc;
    const data = readFileSync(join(RMONITOR_FIXTURES, "recordings/leaderboard-Dobbin_simu.txt"));
    await fetch(`${s.baseUrl}/api/recordings/d.txt`, { method: "PUT", headers: { "content-type": "text/plain" }, body: data });
    await postJson(`${s.baseUrl}/api/player/start`, { file: "d.txt", speedup: 100_000 });
    await waitFor(async () => (await status(s)).player.state === "idle", 3000, "replay finished");
    expect((await getJson<unknown[]>(`${s.baseUrl}/races`)).body).toHaveLength(1);

    await postJson(`${s.baseUrl}/api/client/connect`);
    expect((await getJson<unknown[]>(`${s.baseUrl}/races`)).body).toHaveLength(0);
    expect((await status(s)).source).toBe("rmonitor");
  });

  it("protects writing endpoints with the control token", async () => {
    svc = await startService({ controlToken: "secret" });
    const s = svc;
    expect((await postJson(`${s.baseUrl}/api/state/reset`)).status).toBe(401);
    expect((await postJson(`${s.baseUrl}/api/state/reset`, undefined, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await postJson(`${s.baseUrl}/api/state/reset`, undefined, { authorization: "Bearer secret" })).status).toBe(200);
    // Reading stays open.
    expect((await getJson(`${s.baseUrl}/api/status`)).status).toBe(200);
    expect((await getJson(`${s.baseUrl}/races`)).status).toBe(200);
  });

  it("validates and persists configuration changes", async () => {
    svc = await startService();
    const s = svc;
    const bad = await getJson(`${s.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { port: 0 } }),
    });
    expect(bad.status).toBe(400);

    const ok = await getJson<{ client: { host: string; port: number } }>(`${s.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { host: "10.0.0.5", port: 50001 }, server: { port: 1 } }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.client).toMatchObject({ host: "10.0.0.5", port: 50001 });
    const file = JSON.parse(readFileSync(join(s.config.dataDir, "leaderboard.config.json"), "utf8")) as Record<string, unknown>;
    expect(file).toMatchObject({ client: { host: "10.0.0.5", port: 50001 } });
    expect(file).not.toHaveProperty("server");
  });

  it("rejects invalid request bodies", async () => {
    svc = await startService();
    expect((await postJson(`${svc.baseUrl}/api/client/connect`, { port: "x" })).status).toBe(400);
    expect((await postJson(`${svc.baseUrl}/api/client/connect`, { encoding: "nope" })).status).toBe(400);
    expect((await postJson(`${svc.baseUrl}/api/player/start`, {})).status).toBe(400);
    expect((await postJson(`${svc.baseUrl}/api/player/start`, { file: "missing.txt" })).status).toBe(404);
  });
});
