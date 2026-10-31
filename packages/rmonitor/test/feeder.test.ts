/**
 * FakeOrbitsFeeder over real TCP, consumed by LineDecoder + RaceStateStore – the same path the
 * leaderboard service will use.
 */
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LineDecoder, parseLine, RaceStateStore, toRaceTO } from "../src/index.js";
import { FakeOrbitsFeeder } from "../src/testing/index.js";

const RECORDING = join(import.meta.dirname, "fixtures/recordings/leaderboard-Dobbin_simu.txt");

type Client = { socket: Socket; store: RaceStateStore; lines: string[]; waitFor(n: number): Promise<void> };

async function connectClient(port: number): Promise<Client> {
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const decoder = new LineDecoder();
  const store = new RaceStateStore();
  const lines: string[] = [];
  let waiters: Array<() => boolean> = [];
  socket.on("data", (chunk: Buffer) => {
    for (const line of decoder.push(chunk)) {
      lines.push(line);
      store.apply(parseLine(line));
    }
    waiters = waiters.filter((w) => !w());
  });
  return {
    socket,
    store,
    lines,
    waitFor: (n) =>
      new Promise<void>((resolve) => {
        const check = () => (lines.length >= n ? (resolve(), true) : false);
        if (!check()) waiters.push(check);
      }),
  };
}

describe("FakeOrbitsFeeder", () => {
  let feeder: FakeOrbitsFeeder | null = null;
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.socket.destroy();
    await feeder?.close();
    feeder = null;
  });

  it("sends exactly the requested lines and stops", async () => {
    feeder = await FakeOrbitsFeeder.fromRecordingFile(RECORDING);
    const { port } = await feeder.start();
    const client = await connectClient(port);
    clients.push(client);
    await feeder.waitForClients(1);

    await feeder.sendUntil(13); // up to the first $B
    await client.waitFor(13);
    expect(feeder.position).toBe(13);
    expect(client.lines.at(-1)).toBe('$B,57,"Test"');
    expect(client.store.current.id).toBe(57);

    // Nothing more arrives on its own.
    await new Promise((r) => setTimeout(r, 50));
    expect(client.lines.length).toBe(13);

    await feeder.sendUntil(feeder.length);
    await client.waitFor(feeder.length);
    expect(toRaceTO(client.store.displayRace)).toMatchObject({ raceID: 57, flagStatus: "FINISH", lapsComplete: 2 });
  });

  it("broadcasts to all clients; late clients only get new lines", async () => {
    feeder = FakeOrbitsFeeder.fromMessages(['$B,1,"Race"', '$A,"1","1",T,"Jörg","Ä","GER",1', '$G,1,"1",1,"00:00:10"']);
    const { port } = await feeder.start();
    const a = await connectClient(port);
    clients.push(a);
    await feeder.waitForClients(1);
    await feeder.sendNext(2);
    const b = await connectClient(port);
    clients.push(b);
    await feeder.waitForClients(2);
    await feeder.sendNext();
    await a.waitFor(3);
    await b.waitFor(1);
    expect(a.store.current.competitors.get("1")?.firstName).toBe("Jörg");
    expect(b.lines).toEqual(['$G,1,"1",1,"00:00:10"']);
  });

  it("play() replays with the recording timing", async () => {
    feeder = await FakeOrbitsFeeder.fromRecordingFile(RECORDING);
    const { port } = await feeder.start();
    const client = await connectClient(port);
    clients.push(client);
    await feeder.waitForClients(1);

    const started = Date.now();
    // Lines 1..9 span ~8 s in the recording; at speedup 40 that is ~200 ms.
    await feeder.play({ speedup: 40, until: 9 });
    const elapsed = Date.now() - started;
    await client.waitFor(9);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  });

  it("supports split writes and reconnects", async () => {
    feeder = FakeOrbitsFeeder.fromMessages(['$B,9,"Split"']);
    const { port } = await feeder.start();
    const client = await connectClient(port);
    clients.push(client);
    await feeder.waitForClients(1);
    await feeder.sendRaw(Buffer.from('$B,9,"Sp'));
    await feeder.sendRaw(Buffer.from('lit"\r\n'));
    await client.waitFor(1);
    expect(client.store.current.name).toBe("Split");

    feeder.disconnectClients();
    await new Promise((r) => client.socket.once("close", r));
    const again = await connectClient(port);
    clients.push(again);
    await feeder.waitForClients(1);
    expect(feeder.clientCount).toBe(1);
  });
});
