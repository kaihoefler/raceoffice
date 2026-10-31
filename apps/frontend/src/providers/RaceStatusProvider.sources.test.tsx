// RaceStatusProvider sources: automatic selection, leaderboard service via WebSocket (snapshot +
// JSON patch), polling fallback while the WebSocket is down, Java emergency URL.
// fetch and WebSocket are stubbed; time is real (short waits).

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRace, startField } from "@raceoffice/race-status-mock";

import { DEFAULT_JAVA_URL, RaceStatusProvider, SERVICE_REST_PATH, useRaceStatus } from "./RaceStatusProvider";

const greenRace = (raceID: number, raceName: string) =>
  ({ ...buildRace({ raceName, flag: "GREEN", competitors: startField([11, 12]) }), raceID });

function Probe() {
  const s = useRaceStatus();
  return (
    <output aria-label="state">
      {JSON.stringify({
        source: s.source,
        transport: s.transport,
        endpoint: s.endpoint,
        race: s.currentRace?.raceName ?? null,
        lapsComplete: s.currentRace?.lapsComplete ?? null,
        available: s.leaderboard?.available ?? null,
      })}
    </output>
  );
}

const state = () =>
  JSON.parse(screen.getByRole("status", { name: "state" }).textContent!) as {
    source: string;
    transport: string;
    endpoint: string;
    race: string | null;
    lapsComplete: number | null;
    available: boolean | null;
  };

/** Minimal WebSocket stand-in; tests drive it via `sockets`. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send() {}
  close() {
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => this.onclose?.(), 0);
  }
  emit(message: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
}

let leaderboardAvailable = true;
let requests: string[] = [];

beforeEach(() => {
  localStorage.clear();
  FakeSocket.instances = [];
  requests = [];
  leaderboardAvailable = true;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === "/leaderboard-service/status") {
      return new Response(
        JSON.stringify({ mode: "managed", available: leaderboardAvailable, externalUrl: null, process: { state: "running" }, service: null }),
      );
    }
    if (url === SERVICE_REST_PATH) return new Response(JSON.stringify([greenRace(3, "Polled from service")]));
    if (url === DEFAULT_JAVA_URL) return new Response(JSON.stringify([greenRace(9, "From Java")]));
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RaceStatusProvider sources", () => {
  it("auto: uses the leaderboard service via WebSocket and applies snapshot + patches", async () => {
    render(
      <RaceStatusProvider pollIntervalMs={250}>
        <Probe />
      </RaceStatusProvider>,
    );
    await waitFor(() => expect(state().transport).toBe("ws"));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.instances[0]!;
    expect(ws.url).toMatch(/\/leaderboard\/ws\/race\/current$/);

    ws.emit({ type: "snapshot", raceId: 3, rev: 1, data: greenRace(3, "Elimination") });
    await waitFor(() => expect(state().race).toBe("Elimination"));
    ws.emit({ type: "patch", raceId: 3, rev: 2, baseRev: 1, patch: [{ op: "replace", path: "/lapsComplete", value: 7 }] });
    await waitFor(() => expect(state().lapsComplete).toBe(7));
    // No REST polling while the WebSocket delivers.
    expect(requests.filter((r) => r === SERVICE_REST_PATH)).toHaveLength(0);
  });

  it("reconnects on a revision gap and polls the service REST endpoint while the WebSocket is down", async () => {
    render(
      <RaceStatusProvider pollIntervalMs={250}>
        <Probe />
      </RaceStatusProvider>,
    );
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.instances[0]!;
    ws.emit({ type: "snapshot", raceId: 3, rev: 1, data: greenRace(3, "Elimination") });
    // baseRev 5 does not match rev 1 → the client drops the socket.
    ws.emit({ type: "patch", raceId: 3, rev: 6, baseRev: 5, patch: [] });
    await waitFor(() => expect(ws.closed).toBe(true));
    await waitFor(() => expect(state().race).toBe("Polled from service"));
    expect(state().transport).toBe("poll");
    // …and a new socket is opened in the background.
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1), { timeout: 3000 });
  });

  it("auto: falls back to the Java leaderboard URL when the service is not available", async () => {
    leaderboardAvailable = false;
    render(
      <RaceStatusProvider pollIntervalMs={250}>
        <Probe />
      </RaceStatusProvider>,
    );
    await waitFor(() => expect(state().race).toBe("From Java"));
    expect(state()).toMatchObject({ source: "auto", transport: "poll", endpoint: DEFAULT_JAVA_URL, available: false });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("remembers the selected source in the browser", async () => {
    localStorage.setItem("raceoffice.liveSource", JSON.stringify({ source: "java" }));
    render(
      <RaceStatusProvider pollIntervalMs={250}>
        <Probe />
      </RaceStatusProvider>,
    );
    await waitFor(() => expect(state().race).toBe("From Java"));
    expect(state().source).toBe("java");
    // The Java emergency source does not even ask the RaceOffice server.
    expect(requests).not.toContain("/leaderboard-service/status");
  });
});
