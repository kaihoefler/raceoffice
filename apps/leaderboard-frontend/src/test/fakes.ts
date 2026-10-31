// Test doubles: a controllable WebSocket (per URL) and a recording fetch stub.

import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { LeaderboardServiceStatus, LeaderboardWsMessage, RaceStatusRace } from "@raceoffice/domain";

export class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send() {}
  close() {
    this.closed = true;
  }
  static find(pathEnd: string): FakeSocket | undefined {
    return [...FakeSocket.all].reverse().find((s) => s.url.endsWith(pathEnd) && !s.closed);
  }
  emit(message: LeaderboardWsMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
  drop() {
    act(() => {
      this.closed = true;
      this.onclose?.();
    });
  }
}

export type FetchCall = { url: string; method: string; body: unknown };

export function installFakes(responses: Record<string, unknown | ((call: FetchCall) => Response | unknown)> = {}) {
  FakeSocket.all = [];
  const calls: FetchCall[] = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : (init?.body ?? null);
    const call = { url, method, body };
    calls.push(call);
    const key = `${method} ${url.replace(/^.*?\/api\//, "api/")}`;
    const handler = responses[key];
    const result = typeof handler === "function" ? (handler as (c: FetchCall) => unknown)(call) : handler;
    if (result instanceof Response) return result;
    if (result === undefined) {
      if (url.includes("api/recordings") && method === "GET") return Response.json([]);
      if (url.includes("api/config")) return Response.json(defaultConfig());
      return Response.json(defaultStatus());
    }
    return Response.json(result);
  });
  return calls;
}

export function defaultConfig() {
  return {
    client: { host: "192.168.1.20", port: 50000, encoding: "windows-1252", autoConnect: false, retryMax: -1, retryTimeoutMs: 5000 },
    recorder: { autoStart: false, name: "recording" },
    player: { file: null, speedup: 1, fileEncoding: "auto", skipGaps: true },
    publish: { coalesceMs: 100 },
    state: { corrections: "apply", maxRaces: 200 },
    compat: { catchAllRace: true },
  };
}

export function defaultStatus(overrides: Partial<LeaderboardServiceStatus> = {}): LeaderboardServiceStatus {
  return {
    version: "0.1.0",
    mode: "standalone",
    source: "none",
    client: {
      state: "stopped",
      host: "192.168.1.20",
      port: 50000,
      encoding: "windows-1252",
      lastMessageAt: null,
      messagesPerMinute: 0,
      retry: { attempt: 0, max: -1, nextAttemptAt: null },
      lastError: null,
    },
    recorder: { active: false, file: null, lines: 0, startedAt: null },
    player: { state: "idle", file: null, speedup: 1, progress: 0, positionMs: 0, durationMs: 0 },
    server: { port: 8080, wsClients: 1, restRequestsPerMinute: 0 },
    race: { currentId: null, currentName: null, flag: null },
    ...overrides,
  };
}

export function race(overrides: Partial<RaceStatusRace> = {}): RaceStatusRace {
  return {
    raceName: "Elimination U17m",
    raceID: 12,
    flagStatus: "GREEN",
    elapsedTime: "4:12",
    timeOfDay: "14:03:22",
    lapsComplete: 7,
    lapsToGo: 13,
    trackName: "Groß-Gerau",
    trackLength: 0.2,
    competitors: [
      { number: "17", position: 1, lapsComplete: 7, firstName: "Max", lastName: "Muster (GER)", totalTime: "4:11.532", bestLap: "0:21.004", lastLap: "0:21.310", qualiPosition: 0 },
      { number: "23", position: 2, lapsComplete: 7, firstName: "Tim", lastName: "Beispiel (NED)", totalTime: "4:11.564", bestLap: "0:21.120", lastLap: "0:21.120", qualiPosition: 0 },
      { number: "5", position: 3, lapsComplete: 6, firstName: "Ole", lastName: "Hinten (BEL)", totalTime: "4:30.000", bestLap: "0:22.500", lastLap: "0:23.000", qualiPosition: 0 },
    ],
    ...overrides,
  };
}
