/**
 * Timing layer: passing store (idempotent, seq, filters, deletes), REST API, passing stream
 * (catch-up, then live, deletions) and the migration of LiveTracking setups into the register.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import {
  createLiveTrackingListDocument,
  createLiveTrackingSetupDocument,
  createLiveTrackingSessionDocument,
  makeLiveTrackingListDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  TIMING_DECODERS_DOC_ID,
  type TimingPassingInput,
  type TimingPassingStreamMessage,
} from "@raceoffice/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { DocStore } from "../src/services/docStore";
import { TimingPassingStore } from "../src/services/timingPassingStore";

let tmpDir: string;

const passing = (n: number, overrides: Partial<TimingPassingInput> = {}): TimingPassingInput => ({
  id: `p-${n}`,
  decoderId: "p3@10.0.0.7:5403",
  connectionSessionId: "c1",
  decoderTime: new Date(Date.UTC(2026, 9, 31, 10, 0, n)).toISOString(),
  timeSource: "rtc",
  receivedAt: new Date(Date.UTC(2026, 9, 31, 10, 0, n, 20)).toISOString(),
  passingNumber: n,
  transponderId: String(1000 + n),
  transponderType: "tranx",
  signalStrength: 100,
  hits: 20,
  lowBattery: false,
  signalKind: null,
  backend: "p3",
  raw: null,
  ...overrides,
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raceoffice-timing-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("TimingPassingStore", () => {
  let docs: DocStore;
  let store: TimingPassingStore;
  beforeEach(() => {
    docs = new DocStore(path.join(tmpDir, "raceoffice.db"));
    store = new TimingPassingStore(docs.database);
  });
  afterEach(() => docs.close());

  it("inserts idempotently and assigns increasing seq", () => {
    const first = store.insert([passing(1), passing(2)]);
    expect(first.inserted.map((p) => p.seq)).toEqual([1, 2]);
    const again = store.insert([passing(2), passing(3)]);
    expect(again).toMatchObject({ duplicates: 1 });
    expect(again.inserted.map((p) => [p.id, p.seq])).toEqual([["p-3", 3]]);
    expect(store.query().passings.map((p) => p.id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(store.query().passings[0]).toEqual({ ...passing(1), seq: 1 });
  });

  it("filters by seq, decoder and time and pages with hasMore", () => {
    store.insert([passing(1), passing(2, { decoderId: "ammc@10.0.0.8:9001", backend: "ammc" }), passing(3), passing(4)]);
    expect(store.query({ sinceSeq: 2 }).passings.map((p) => p.seq)).toEqual([3, 4]);
    expect(store.query({ decoderIds: ["ammc@10.0.0.8:9001"] }).passings.map((p) => p.seq)).toEqual([2]);
    expect(store.query({ from: passing(3).receivedAt }).passings.map((p) => p.seq)).toEqual([3, 4]);
    expect(store.query({ limit: 2 })).toMatchObject({ hasMore: true });
  });

  it("deletes only with a filter or all:true; seq is never reused", () => {
    store.insert([passing(1), passing(2), passing(3, { decoderId: "other" })]);
    expect(store.delete({})).toBe(0);
    expect(store.delete({ decoderIds: ["other"] })).toBe(1);
    expect(store.stats()).toMatchObject({ total: 2, lastSeq: 3 });
    expect(store.delete({ all: true })).toBe(2);
    expect(store.insert([passing(9)]).inserted[0]!.seq).toBe(4);
  });
});

describe("timing API and stream", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function start(seed?: (docs: DocStore) => void) {
    const dbPath = path.join(tmpDir, "raceoffice.db");
    if (seed) {
      const docs = new DocStore(dbPath);
      seed(docs);
      docs.close();
    }
    app = await buildApp({
      dbPath,
      publicDir: path.join(tmpDir, "public"),
      repoRoot: tmpDir,
      liveTrackingServerUrl: "http://127.0.0.1:0",
      logger: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }
  afterEach(async () => app?.close());

  const post = async (url: string, body: unknown) => {
    const res = await fetch(`${baseUrl}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it("uploads, queries and deletes with explicit confirmation", async () => {
    await start();
    expect((await post("/timing/passings", { passings: [passing(1), { nope: 1 }] })).status).toBe(400);
    expect((await post("/timing/passings", { passings: [passing(1), passing(2)] })).body).toMatchObject({ inserted: 2, lastSeq: 2 });
    expect((await post("/timing/passings", { passings: [passing(2)] })).body).toMatchObject({ inserted: 0, duplicates: 1 });

    const q = await (await fetch(`${baseUrl}/timing/passings?sinceSeq=1&decoderIds=p3@10.0.0.7:5403`)).json();
    expect(q.passings.map((p: { id: string }) => p.id)).toEqual(["p-2"]);
    expect(await (await fetch(`${baseUrl}/timing/passings/stats`)).json()).toMatchObject({ total: 2, lastSeq: 2 });

    expect((await post("/timing/passings/delete", { filter: { all: true } })).status).toBe(400);
    expect((await post("/timing/passings/delete", { confirm: true, filter: {} })).status).toBe(400);
    expect((await post("/timing/passings/delete", { confirm: true, filter: { all: true } })).body).toMatchObject({ deleted: 2 });
  });

  it("streams the backlog, then live passings and deletions", async () => {
    await start();
    await post("/timing/passings", { passings: [passing(1), passing(2), passing(3, { decoderId: "other" })] });

    const messages: TimingPassingStreamMessage[] = [];
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/timing/passings/stream?sinceSeq=1&decoderIds=p3@10.0.0.7:5403`);
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    const until = async (pred: () => boolean) => {
      for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(pred()).toBe(true);
    };
    await until(() => messages.some((m) => m.type === "live"));
    expect(messages[0]).toMatchObject({ type: "passings", passings: [{ id: "p-2", seq: 2 }] });

    await post("/timing/passings", { passings: [passing(4), passing(5, { decoderId: "other" })] });
    await until(() => messages.filter((m) => m.type === "passings").length === 2);
    expect(messages.at(-1)).toMatchObject({ type: "passings", passings: [{ id: "p-4" }] });

    await post("/timing/passings/delete", { confirm: true, filter: { decoderIds: ["other"] } });
    await until(() => messages.at(-1)?.type === "deleted");
    expect(messages.at(-1)).toMatchObject({ deleted: 2, filter: { decoderIds: ["other"] } });
    ws.close();
  });

  it("registers the decoders of existing LiveTracking setups at startup", async () => {
    await start((docs) => {
      const setup = createLiveTrackingSetupDocument({ setupId: "s1", eventId: null, name: "Arena" });
      const point = {
        id: "tp-1",
        name: "Ziel",
        decoderIp: "10.0.0.7",
        websocketPortAMM: 0,
        order: 1,
        distanceFromPreviousM: 0,
        absolutePositionM: 0,
        role: "start_finish" as const,
        enabled: true,
      };
      docs.saveDoc(makeLiveTrackingSetupDocId("s1"), {
        rev: 1,
        data: { ...setup, decoderBackend: "p3parser", track: { ...setup.track, timingPoints: [point] } },
      });
      docs.saveDoc(makeLiveTrackingListDocId(), {
        rev: 1,
        data: { ...createLiveTrackingListDocument(), setups: [{ setupId: "s1", name: "Arena", updatedAt: null }] },
      });
    });
    const docs = new DocStore(path.join(tmpDir, "raceoffice.db"));
    const register = docs.loadDoc(TIMING_DECODERS_DOC_ID).data;
    docs.close();
    expect(register.decoders).toEqual([expect.objectContaining({ id: "p3@10.0.0.7:5403", name: "Ziel", backend: "p3" })]);
  });

  it("migrates an old session document (prepare/ready) at startup", async () => {
    await start((docs) => {
      docs.saveDoc(makeLiveTrackingSessionDocId(), {
        rev: 3,
        data: { ...createLiveTrackingSessionDocument({ setupId: "s1", eventId: "" }), state: "ready", desiredState: "ready" },
      });
    });
    const docs = new DocStore(path.join(tmpDir, "raceoffice.db"));
    const session = docs.loadDoc(makeLiveTrackingSessionDocId());
    docs.close();
    expect(session).toMatchObject({ rev: 4, data: { state: "idle", desiredState: "idle" } });
  });
});
