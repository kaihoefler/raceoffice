import { pickCurrentRace } from "@raceoffice/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRace, serializeFrame, parseRecording } from "../src/index";
import { HttpRaceStatusFeed, startRaceStatusMockServer, type RaceStatusMockServer } from "../src/server";

let server: RaceStatusMockServer;
let control: HttpRaceStatusFeed;

beforeEach(async () => {
  server = await startRaceStatusMockServer({ port: 0 });
  control = new HttpRaceStatusFeed(server.url);
});

afterEach(async () => {
  await server.close();
});

const poll = () => fetch(`${server.url}/races?filter=current`);

describe("race status mock server", () => {
  it("serves the state set via the control API with CORS headers, until the next one", async () => {
    await control.set(buildRace({ raceName: "Elim Final A", lapsComplete: 7 }));

    const res = await poll();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(pickCurrentRace(await res.json())).toMatchObject({ raceName: "Elim Final A", lapsComplete: 7 });
    expect(pickCurrentRace(await (await poll()).json())?.lapsComplete).toBe(7);
    expect(await control.servedSinceSet()).toBe(2);

    await control.set(null);
    expect(await (await poll()).json()).toEqual([]);
  });

  it("waitUntilServed resolves after the frontend polled the new state", async () => {
    await control.set(buildRace());
    const waiting = control.waitUntilServed(2000);
    await poll();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("answers CORS preflight requests", async () => {
    const res = await fetch(`${server.url}/races?filter=current`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("simulates failures: HTTP error, malformed JSON, stalled request", async () => {
    await control.setResponse({ kind: "httpError", status: 500 });
    expect((await poll()).status).toBe(500);

    await control.setResponse({ kind: "malformedJson" });
    await expect((await poll()).json()).rejects.toThrow();

    await control.setResponse({ kind: "hang" });
    await expect(fetch(`${server.url}/races`, { signal: AbortSignal.timeout(300) })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("replays recorded states in order and stops at the end", async () => {
    const frames = parseRecording(
      [1, 2, 3].map((lap, i) => serializeFrame({ t: i * 20, payload: [buildRace({ lapsComplete: lap })] })).join("\n"),
    );

    server.replay(frames);
    expect(pickCurrentRace(await (await poll()).json())?.lapsComplete).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(server.replayState()).toEqual({ running: false, index: 2, total: 3 });
    expect(pickCurrentRace(await (await poll()).json())?.lapsComplete).toBe(3);
  });

  it("setting a state stops a running replay", async () => {
    const frames = parseRecording(
      [1, 2].map((lap, i) => serializeFrame({ t: i * 10_000, payload: [buildRace({ lapsComplete: lap })] })).join("\n"),
    );
    server.replay(frames);
    await control.set(buildRace({ lapsComplete: 42 }));

    expect(server.replayState().running).toBe(false);
    expect(pickCurrentRace(await (await poll()).json())?.lapsComplete).toBe(42);
  });
});
