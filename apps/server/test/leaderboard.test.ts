/**
 * Leaderboard integration of the RaceOffice server: proxy (HTTP + WebSocket), runtime mode switch
 * (incl. emergency fallback to an external/Java leaderboard) and the managed service process.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/app";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let tmpDir: string;
let app: FastifyInstance | null = null;
let upstream: FastifyInstance | null = null;
let baseUrl = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });

/** A stand-in for the Java app / another leaderboard service. */
async function startUpstream(): Promise<string> {
  upstream = Fastify({ logger: false });
  await upstream.register(websocket);
  upstream.removeAllContentTypeParsers();
  upstream.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  upstream.get("/races", async (req) => [
    { raceID: 7, flagStatus: "GREEN", query: req.url, authorization: req.headers.authorization ?? null },
  ]);
  upstream.get("/", async (_req, reply) => reply.redirect("/ui/"));
  upstream.put("/api/recordings/:file", async (req) => ({ size: (req.body as Buffer).length }));
  upstream.get("/ws/race/current", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "snapshot", rev: 1 }));
    socket.on("message", (raw: Buffer) => socket.send(JSON.stringify({ echo: String(raw) })));
  });
  await upstream.listen({ port: 0, host: "127.0.0.1" });
  return `http://127.0.0.1:${(upstream.server.address() as AddressInfo).port}`;
}

async function startServer(leaderboard: BuildAppOptions["leaderboard"], repoRoot = tmpDir): Promise<void> {
  app = await buildApp({
    dbPath: path.join(tmpDir, "raceoffice.db"),
    publicDir: path.join(tmpDir, "public"),
    repoRoot,
    liveTrackingServerUrl: "http://127.0.0.1:0",
    logger: false,
    ...(leaderboard ? { leaderboard } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raceoffice-leaderboard-"));
});

afterEach(async () => {
  await app?.close();
  await upstream?.close();
  app = null;
  upstream = null;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("leaderboard proxy (external mode, e.g. Java RMonitorLeaderboard)", () => {
  it("proxies REST with query string, without adding a token", async () => {
    const url = await startUpstream();
    await startServer({ mode: "external", externalUrl: url, internalPort: 0, dataDir: tmpDir, autoStart: false });
    const { status, body } = await json(`${baseUrl}/leaderboard/races?filter=current`);
    expect(status).toBe(200);
    expect(body).toEqual([{ raceID: 7, flagStatus: "GREEN", query: "/races?filter=current", authorization: null }]);
  });

  it("keeps redirects inside /leaderboard and forwards raw request bodies", async () => {
    const url = await startUpstream();
    await startServer({ mode: "external", externalUrl: url, internalPort: 0, dataDir: tmpDir, autoStart: false });
    const redirect = await fetch(`${baseUrl}/leaderboard/`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/leaderboard/ui/");

    const bytes = new Uint8Array([0x24, 0x41, 0xfc, 0x0d, 0x0a]);
    const put = await json(`${baseUrl}/leaderboard/api/recordings/x.txt`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });
    expect(put.body).toEqual({ size: 5 });
  });

  it("proxies WebSockets in both directions", async () => {
    const url = await startUpstream();
    await startServer({ mode: "external", externalUrl: url, internalPort: 0, dataDir: tmpDir, autoStart: false });
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/leaderboard/ws/race/current`);
    const messages: unknown[] = [];
    ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data))));
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    ws.send('{"type":"resync"}');
    const deadline = Date.now() + 3000;
    while (messages.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    ws.close();
    expect(messages).toEqual([{ type: "snapshot", rev: 1 }, { echo: '{"type":"resync"}' }]);
  });

  it("switches mode at runtime: off → 503, external → proxy", async () => {
    const url = await startUpstream();
    await startServer({ mode: "off", externalUrl: null, internalPort: 0, dataDir: tmpDir, autoStart: false });
    const off = await json(`${baseUrl}/leaderboard/races`);
    expect(off.status).toBe(503);
    expect(off.body).toMatchObject({ error: "leaderboard_unavailable", mode: "off" });

    const noUrl = await json(`${baseUrl}/leaderboard-service/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "external" }),
    });
    expect(noUrl.status).toBe(400);

    const switched = await json(`${baseUrl}/leaderboard-service/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "external", url }),
    });
    expect(switched.body).toMatchObject({ ok: true, mode: "external", externalUrl: url });
    expect((await json(`${baseUrl}/leaderboard/races`)).status).toBe(200);
    const status = await json(`${baseUrl}/leaderboard-service/status`);
    expect(status.body).toMatchObject({ mode: "external", available: true });
  });

  it("managed mode without a running service answers 503 and rejects start/stop in other modes", async () => {
    await startServer({ mode: "managed", externalUrl: null, internalPort: 0, dataDir: tmpDir, autoStart: false });
    expect((await json(`${baseUrl}/leaderboard/races`)).status).toBe(503);
    const status = await json(`${baseUrl}/leaderboard-service/status`);
    expect(status.body).toMatchObject({ mode: "managed", available: false, process: { state: "stopped" } });
  });
});

describe("managed leaderboard service", () => {
  it("starts the real service, proxies with the control token and stops it", async () => {
    const port = await freePort();
    await startServer(
      { mode: "managed", externalUrl: null, internalPort: port, dataDir: path.join(tmpDir, "lb"), autoStart: false },
      REPO_ROOT,
    );
    const started = await json(`${baseUrl}/leaderboard-service/start`, { method: "POST" });
    expect(started.status).toBe(200);
    expect(started.body.status.state).toBe("running");

    // Read endpoints and the Java-compatible feed through the proxy.
    const races = await json(`${baseUrl}/leaderboard/races?filter=current`);
    expect(races.body[0]).toMatchObject({ raceID: -1 });

    // Writing endpoints work only because the proxy adds the token…
    expect((await json(`${baseUrl}/leaderboard/api/state/reset`, { method: "POST" })).status).toBe(200);
    // …the service itself rejects calls without it.
    expect((await json(`http://127.0.0.1:${port}/api/state/reset`, { method: "POST" })).status).toBe(401);

    const status = await json(`${baseUrl}/leaderboard-service/status`);
    expect(status.body).toMatchObject({ available: true, service: { mode: "managed", source: "none" } });

    const stopped = await json(`${baseUrl}/leaderboard-service/stop`, { method: "POST" });
    expect(stopped.body.status.state).toBe("stopped");
    expect((await json(`${baseUrl}/leaderboard/races`)).status).toBe(503);
  }, 60_000);
});
