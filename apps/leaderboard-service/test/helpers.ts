/**
 * Test helpers: a service instance on an ephemeral port with a temp data dir, plus a WebSocket
 * client that applies snapshot/patch messages like a real consumer.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastJsonPatch from "fast-json-patch";
import WebSocket from "ws";
import type { LeaderboardWsMessage, RaceStatusRace } from "@raceoffice/domain";
import { defaultConfig, mergeConfig, type ConfigLayer, type LeaderboardConfig } from "../src/config.js";
import { buildApp } from "../src/http/app.js";
import { LeaderboardService } from "../src/service.js";

export const RMONITOR_FIXTURES = join(import.meta.dirname, "../../../packages/rmonitor/test/fixtures");

export type TestService = {
  service: LeaderboardService;
  config: LeaderboardConfig;
  baseUrl: string;
  wsUrl: string;
  close(): Promise<void>;
};

export async function startService(layer: ConfigLayer = {}): Promise<TestService> {
  const dataDir = mkdtempSync(join(tmpdir(), "leaderboard-test-"));
  const config = mergeConfig(defaultConfig(), { dataDir, logLevel: "silent", server: { host: "127.0.0.1", port: 0 } }, layer);
  const service = new LeaderboardService(config);
  const app = await buildApp(service, { uiDir: null, logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    service,
    config,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    async close() {
      await service.shutdown();
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function getJson<T = unknown>(url: string, init?: RequestInit): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

export async function postJson<T = unknown>(url: string, body?: unknown, headers: Record<string, string> = {}) {
  return getJson<T>(url, {
    method: "POST",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Polls `check` until it returns a truthy value or the timeout expires. */
export async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 5000, label = "condition"): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await check();
    if (last) return last as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** WebSocket consumer of /ws/race/*: keeps the state by applying snapshots and patches. */
export class RaceStreamClient {
  readonly messages: LeaderboardWsMessage[] = [];
  state: RaceStatusRace | null = null;
  rev: number | null = null;
  /** baseRev mismatches seen (must stay 0). */
  gaps = 0;
  private constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => this.onMessage(JSON.parse(String(raw)) as LeaderboardWsMessage));
  }

  static async connect(url: string): Promise<RaceStreamClient> {
    const socket = new WebSocket(url);
    const client = new RaceStreamClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    await waitFor(() => client.messages.length > 0, 5000, "first snapshot");
    return client;
  }

  count(type: LeaderboardWsMessage["type"]): number {
    return this.messages.filter((m) => m.type === type).length;
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(m: LeaderboardWsMessage): void {
    this.messages.push(m);
    if (m.type === "snapshot") {
      this.state = m.data;
      this.rev = m.rev;
    } else if (m.type === "patch") {
      if (m.baseRev !== this.rev) this.gaps++;
      this.state = fastJsonPatch.applyPatch(structuredClone(this.state), m.patch, true, false).newDocument;
      this.rev = m.rev;
    }
  }
}
