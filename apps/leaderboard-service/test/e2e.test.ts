/**
 * End to end: fake Orbits (recording over TCP) → service → REST and WebSocket.
 * The REST result must match the Java app at the same line (golden reference of @raceoffice/rmonitor),
 * and a WebSocket consumer applying snapshot + patches must end up with exactly the REST state.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeOrbitsFeeder, normalizeRaces, normalizeRaceTO, type GoldenFile } from "@raceoffice/rmonitor/testing";
import type { RaceTO } from "@raceoffice/rmonitor";
import { getJson, postJson, RaceStreamClient, RMONITOR_FIXTURES, startService, waitFor, type TestService } from "./helpers.js";

const golden = (name: string) =>
  JSON.parse(readFileSync(join(RMONITOR_FIXTURES, "golden", `${name}.golden.json`), "utf8")) as GoldenFile;

describe("Orbits → service → REST/WS", () => {
  let svc: TestService | null = null;
  let feeder: FakeOrbitsFeeder | null = null;
  const clients: RaceStreamClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await feeder?.close();
    await svc?.close();
    feeder = null;
    svc = null;
  });

  async function setup(recording: string) {
    feeder = await FakeOrbitsFeeder.fromRecordingFile(join(RMONITOR_FIXTURES, "recordings", recording));
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port, retryTimeoutMs: 100 }, publish: { coalesceMs: 20 } });
    await postJson(`${svc.baseUrl}/api/client/connect`);
    await feeder.waitForClients(1);
    return { feeder, svc };
  }

  it.each([
    "leaderboard-recording_Elimination_AGI_2018",
    "leaderboard-recording_AGI_2022_pts_Sen_Men",
    "excerpt_race-changes",
  ])("REST matches the Java reference at every checkpoint: %s", async (name) => {
    const ref = golden(name);
    const { feeder, svc } = await setup(ref.recording);

    // The service processes the lines asynchronously: poll until equal (or report the last state).
    const settle = async <T>(read: () => Promise<T>, expected: T): Promise<T> => {
      let got = await read();
      const deadline = Date.now() + 3000;
      while (JSON.stringify(got) !== JSON.stringify(expected) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
        got = await read();
      }
      return got;
    };

    for (const checkpoint of ref.checkpoints) {
      await feeder.sendUntil(checkpoint.afterLines);
      const where = `after line ${checkpoint.afterLines}: ${checkpoint.lastLine}`;
      const expected = normalizeRaceTO(checkpoint.current);
      const current = await settle(
        async () => normalizeRaceTO((await getJson<RaceTO[]>(`${svc.baseUrl}/races?filter=current`)).body[0] as RaceTO),
        expected,
      );
      expect(current, where).toEqual(expected);
      if (checkpoint.races) {
        const expectedRaces = normalizeRaces(checkpoint.races);
        const races = await settle(
          async () => normalizeRaces((await getJson<RaceTO[]>(`${svc.baseUrl}/races`)).body),
          expectedRaces,
        );
        expect(races, `${where} (all races)`).toEqual(expectedRaces);
      }
    }
  }, 60_000);

  it("WebSocket consumer ends with the REST state, without revision gaps", async () => {
    const { feeder, svc } = await setup("leaderboard-recording_500m_kompakt.txt");
    const ws = await RaceStreamClient.connect(`${svc.wsUrl}/ws/race/current`);
    clients.push(ws);
    expect(ws.messages[0]?.type).toBe("snapshot");

    await feeder.play({ speedup: 1000 });
    const final = (await getJson<RaceTO[]>(`${svc.baseUrl}/races?filter=current`)).body[0];
    await waitFor(() => JSON.stringify(ws.state) === JSON.stringify(final), 3000, "ws state = REST");
    expect(ws.gaps).toBe(0);
    // Several races in the recording → several snapshots, mostly patches otherwise.
    expect(ws.count("snapshot")).toBeGreaterThan(1);
    expect(ws.count("patch")).toBeGreaterThan(ws.count("snapshot"));
  });

  it("every heartbeat produces a message, also when the displayed race does not change", async () => {
    const lines = [
      '$B,7,"Race"',
      '$F,0,"00:00:00","12:00:00","00:00:10","Green "',
      '$I,"12:00:01","1 jan 26"',
      // From here the heartbeats belong to the new (unpublished) race; /race still shows race 7.
      '$F,0,"00:00:00","12:00:02","00:00:00","      "',
      '$F,0,"00:00:00","12:00:03","00:00:00","      "',
      '$F,0,"00:00:00","12:00:04","00:00:00","      "',
    ];
    feeder = FakeOrbitsFeeder.fromMessages(lines);
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port }, publish: { coalesceMs: 10 } });
    const s = svc;
    await postJson(`${s.baseUrl}/api/client/connect`);
    await feeder.waitForClients(1);
    const ws = await RaceStreamClient.connect(`${s.wsUrl}/ws/race/current`);
    clients.push(ws);

    await feeder.sendUntil(3);
    await waitFor(() => ws.state?.flagStatus === "FINISH", 2000, "race 7 finished");
    const before = ws.messages.length;
    for (let i = 4; i <= 6; i++) {
      await feeder.sendUntil(i);
      await waitFor(() => ws.messages.length >= before + (i - 3), 2000, `heartbeat ${i}`);
    }
    const ticks = ws.messages.slice(before);
    expect(ticks.every((m) => m.type === "patch" && m.patch.length === 0)).toBe(true);
    expect(ws.state?.raceID).toBe(7);
    expect(ws.gaps).toBe(0);
  });

  it("/ws/race/:id follows one race and starts with null until it exists", async () => {
    feeder = FakeOrbitsFeeder.fromMessages(['$B,1,"One"', '$B,2,"Two"', '$A,"5","5",T,"A","B","GER",1']);
    const { port } = await feeder.start();
    svc = await startService({ client: { host: "127.0.0.1", port }, publish: { coalesceMs: 10 } });
    const s = svc;
    await postJson(`${s.baseUrl}/api/client/connect`);
    await feeder.waitForClients(1);
    const ws = await RaceStreamClient.connect(`${s.wsUrl}/ws/race/2`);
    clients.push(ws);
    expect(ws.state).toBeNull();
    await feeder.sendUntil(3);
    await waitFor(() => ws.state?.competitors.length === 1, 2000, "race 2 with competitor");
    expect(ws.state?.raceName).toBe("Two");
  });
});
