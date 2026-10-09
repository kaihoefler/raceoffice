// @raceoffice/race-status-mock/server (Node only)
//
// HTTP transport for RaceStatusFeed: behaves like the timing system's REST endpoint so the
// real frontend can poll it (E2E tests, manual testing without a timing system).
//
// Endpoints:
//   GET  /races?...        what the frontend polls: the state set last (see feed.ts)
//   GET  /__mock/state     { kind, servedSinceSet, replay }  (for tests and the CLI)
//   PUT  /__mock/frame     { race: RaceStatusRace | null } or { response: FeedResponse };
//                          stops a running replay
//   POST /__mock/replay    { frames: RecordingFrame[], speed?: number, loop?: boolean }
//   DELETE /__mock/replay  stops the replay, keeping the current state
//
// All responses carry permissive CORS headers: the browser fetches the feed cross-origin
// (frontend on :5173 / :8787, timing system on :8080), exactly like the real feed.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { RaceStatusRace } from "@raceoffice/domain";
import { RaceStatusFeed, type FeedResponse } from "./feed.js";
import { parseRecording, type RecordingFrame } from "./recording.js";

export type MockServerOptions = {
  /** Default 8080, the timing system's usual port. Use 0 for a random free port. */
  port?: number;
  host?: string;
  feed?: RaceStatusFeed;
};

export type ReplayState = { running: boolean; index: number; total: number };

export type RaceStatusMockServer = {
  /** Base URL, e.g. "http://127.0.0.1:8080". The feed URL is `${url}/races?filter=current`. */
  url: string;
  port: number;
  feed: RaceStatusFeed;
  /** Plays recorded states with their original timing (scaled by `speed`). */
  replay(frames: RecordingFrame[], options?: { speed?: number; loop?: boolean }): void;
  stopReplay(): void;
  replayState(): ReplayState;
  close(): Promise<void>;
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

function send(res: http.ServerResponse, status: number, body: string, contentType = "application/json"): void {
  res.writeHead(status, { ...CORS_HEADERS, "content-type": contentType });
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function startRaceStatusMockServer(options: MockServerOptions = {}): Promise<RaceStatusMockServer> {
  const feed = options.feed ?? new RaceStatusFeed();
  const hanging = new Set<http.ServerResponse>();

  let replayTimer: NodeJS.Timeout | null = null;
  let replay: ReplayState = { running: false, index: 0, total: 0 };

  const stopReplay = () => {
    if (replayTimer) clearTimeout(replayTimer);
    replayTimer = null;
    replay = { ...replay, running: false };
  };

  const startReplay = (frames: RecordingFrame[], { speed = 1, loop = false } = {}) => {
    stopReplay();
    if (frames.length === 0) return;
    replay = { running: true, index: 0, total: frames.length };

    const playFrom = (index: number) => {
      const frame = frames[index]!;
      feed.setResponse({ kind: "payload", body: frame.payload });
      replay = { running: true, index, total: frames.length };

      const next = index + 1 < frames.length ? index + 1 : loop ? 0 : null;
      if (next === null) {
        replay = { ...replay, running: false };
        return;
      }
      const delay = next === 0 ? 1000 : Math.max(0, (frames[next]!.t - frame.t) / speed);
      replayTimer = setTimeout(() => playFrom(next), delay);
    };

    playFrom(0);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/races")) {
        const response = feed.current();
        if (response.kind === "hang") {
          hanging.add(res);
          res.on("close", () => hanging.delete(res));
          feed.markServed();
          return;
        }
        if (response.kind === "payload") send(res, 200, JSON.stringify(response.body));
        else if (response.kind === "httpError") send(res, response.status, JSON.stringify({ error: "mocked" }));
        else send(res, 200, "{ this is not json");
        feed.markServed();
        return;
      }

      if (req.method === "GET" && url.pathname === "/__mock/state") {
        send(res, 200, JSON.stringify({ kind: feed.current().kind, servedSinceSet: feed.servedSinceSet(), replay }));
        return;
      }

      if (req.method === "PUT" && url.pathname === "/__mock/frame") {
        const body = await readJson(req);
        stopReplay();
        if ("response" in body) feed.setResponse(body.response as FeedResponse);
        else feed.set((body.race ?? null) as RaceStatusRace | null);
        send(res, 200, JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/__mock/replay") {
        const body = await readJson(req);
        startReplay(Array.isArray(body.frames) ? body.frames : [], { speed: body.speed ?? 1, loop: Boolean(body.loop) });
        send(res, 200, JSON.stringify({ ok: true, replay }));
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/__mock/replay") {
        stopReplay();
        send(res, 200, JSON.stringify({ ok: true }));
        return;
      }

      send(res, 404, JSON.stringify({ error: "not_found" }));
    } catch (err) {
      send(res, 400, JSON.stringify({ error: String((err as Error)?.message ?? err) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8080, options.host ?? "127.0.0.1", () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  const host = options.host && options.host !== "0.0.0.0" ? options.host : "127.0.0.1";

  return {
    url: `http://${host}:${port}`,
    port,
    feed,
    replay: startReplay,
    stopReplay,
    replayState: () => replay,
    close: () => {
      stopReplay();
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Remote control for a running mock server, with the same vocabulary as RaceStatusFeed.
 * Used by Playwright tests, which run in a different process than the mock server.
 */
export class HttpRaceStatusFeed {
  constructor(private readonly baseUrl: string) {}

  set(race: RaceStatusRace | null): Promise<void> {
    return this.put({ race });
  }

  setResponse(response: FeedResponse): Promise<void> {
    return this.put({ response });
  }

  async servedSinceSet(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/__mock/state`);
    return ((await res.json()) as { servedSinceSet: number }).servedSinceSet;
  }

  /** Waits until the frontend has polled the state set last at least once. */
  async waitUntilServed(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((await this.servedSinceSet()) < 1) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the frontend to poll the mocked feed");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async put(body: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}/__mock/frame`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Mock server rejected frame: HTTP ${res.status}`);
  }
}

/** Reads a recording file (JSON Lines, see recording.ts). */
export function loadRecording(filePath: string): RecordingFrame[] {
  return parseRecording(fs.readFileSync(filePath, "utf8"));
}

/** Directory with the committed recordings of this package. */
export const RECORDINGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../recordings");

/** All `*.jsonl` recordings in a directory (default: RECORDINGS_DIR), as absolute paths. */
export function listRecordings(dir: string = RECORDINGS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => path.join(dir, f));
}

export { RaceStatusFeed, type FeedResponse } from "./feed.js";
