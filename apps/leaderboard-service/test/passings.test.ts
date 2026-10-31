/**
 * Finish line log: passings from $J, completed by the following $G, marked by $COR; ring buffer;
 * REST and WebSocket (snapshot + incremental updates converge to the REST state).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { LeaderboardPassing, LeaderboardWsMessage } from "@raceoffice/domain";
import { parseLine, parseRecordingBytes, RaceStateStore } from "@raceoffice/rmonitor";
import { PassingLog } from "../src/passings.js";
import { getJson, postJson, RMONITOR_FIXTURES, startService, waitFor, type TestService } from "./helpers.js";

const SPRINT = join(RMONITOR_FIXTURES, "recordings/excerpt_sprint-correction.txt");

function feed(lines: string[], log = new PassingLog()) {
  const store = new RaceStateStore();
  for (const line of lines) {
    const msg = parseLine(line);
    if (store.apply(msg).changed) log.observe(store, msg);
  }
  return { store, log };
}

describe("PassingLog", () => {
  it("creates an entry per $J and fills in position and lap from the following $G", () => {
    const { log } = feed([
      `$B,3,"500m Sprint"`,
      `$A,"193","193",1,"Anna","Muster (GER)","GER",1`,
      `$F,2,"00:00:00","10:00:39","00:00:14","Green "`,
      `$J,"193","00:00:00.000","00:00:13.776"`,
      `$G,1,"193",1,"00:00:13.776"`,
      `$H,1,"193",0,"00:00:00"`,
      `$G,2,"193",1,"00:00:13.776"`, // later position change: does not rewrite the passing
    ]);
    expect(log.list(3)).toEqual([
      {
        seq: 1,
        raceId: 3,
        regNumber: "193",
        number: "193",
        firstName: "Anna",
        lastName: "Muster (GER)",
        timeOfDay: "10:00:39",
        elapsedTime: "0:14",
        lapTime: "0:00",
        totalTime: "0:13.776",
        lap: 1,
        position: 1,
      },
    ]);
  });

  it("marks the corrected lap of a photo finish ($COR)", () => {
    const lines = parseRecordingBytes(readFileSync(SPRINT)).map((e) => new TextDecoder("windows-1252").decode(e.raw));
    const { store, log } = feed(lines);
    const passings = log.list(store.displayRace.id);
    expect(passings.length).toBeGreaterThan(10);
    const corrected = passings.find((p) => p.regNumber === "193" && p.lap === 3);
    expect(corrected).toMatchObject({ correctionMs: -48, totalTime: "0:46.517" });
    expect(passings.filter((p) => p.correctionMs !== undefined).length).toBeGreaterThanOrEqual(3);
    // Every passing got its position from the following $G.
    expect(passings.every((p) => p.position !== null)).toBe(true);
  });

  it("keeps the last N passings per race and a limited number of races", () => {
    const log = new PassingLog(3, 2);
    const lines: string[] = [];
    for (const race of [1, 2, 3]) {
      lines.push(`$B,${race},"Race ${race}"`);
      for (let i = 1; i <= 5; i++) lines.push(`$J,"7","00:00:10.000","00:00:${String(i * 10).padStart(2, "0")}.000"`);
    }
    feed(lines, log);
    expect(log.list(1)).toEqual([]);
    expect(log.list(3).map((p) => p.totalTime)).toEqual(["0:30", "0:40", "0:50"]);
  });
});

describe("passings over REST and WebSocket", () => {
  let svc: TestService | null = null;
  afterEach(async () => {
    await svc?.close();
    svc = null;
  });

  it("streams a snapshot and updates that end in the same state as REST", async () => {
    svc = await startService({ publish: { coalesceMs: 0 }, player: { skipGaps: true } });
    const s = svc;
    await getJson(`${s.baseUrl}/api/recordings/sprint.txt`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: readFileSync(SPRINT),
    });

    const messages: LeaderboardWsMessage[] = [];
    const ws = new WebSocket(`${s.wsUrl}/ws/race/current/passings`);
    ws.on("message", (raw) => messages.push(JSON.parse(String(raw)) as LeaderboardWsMessage));
    await waitFor(() => messages.length > 0, 3000, "initial snapshot");
    expect(messages[0]).toEqual({ type: "passings", raceId: null, passings: [] });

    // Slow enough that passings arrive one by one, not as a single burst snapshot.
    await postJson(`${s.baseUrl}/api/player/start`, { file: "sprint.txt", speedup: 20 });
    await waitFor(async () => (await getJson<{ player: { state: string } }>(`${s.baseUrl}/api/status`)).body.player.state === "idle", 20_000, "replay finished");
    await new Promise((r) => setTimeout(r, 150));
    ws.close();

    // Client view: last snapshot + upserts by seq.
    let view: LeaderboardPassing[] = [];
    for (const m of messages) {
      if (m.type === "passings") view = [...m.passings];
      else if (m.type === "passing") {
        const i = view.findIndex((p) => p.seq === m.passing.seq);
        if (i >= 0) view[i] = m.passing;
        else view.push(m.passing);
      }
    }
    expect(messages.some((m) => m.type === "passing")).toBe(true);
    const rest = await getJson<LeaderboardPassing[]>(`${s.baseUrl}/api/race/current/passings`);
    expect(rest.body.length).toBeGreaterThan(10);
    expect(view).toEqual(rest.body);
    expect((await getJson(`${s.baseUrl}/api/race/abc/passings`)).status).toBe(400);
  }, 30_000);
});
