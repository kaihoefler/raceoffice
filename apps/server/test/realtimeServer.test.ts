import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { makeLiveTrackingRuntimeDocId } from "@raceoffice/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { connectDoc, isAck, isError, isPatch, isSnapshot, type DocClient } from "./helpers/realtimeClient";

let tmpDir: string;
let dbPath: string;
let app: FastifyInstance;
let baseUrl: string;
const clients: DocClient[] = [];

async function startServer(): Promise<void> {
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

async function open(docId: string): Promise<DocClient> {
  const client = await connectDoc(baseUrl, docId);
  clients.push(client);
  return client;
}

async function closeAll(): Promise<void> {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await app.close();
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "raceoffice-realtime-"));
  dbPath = path.join(tmpDir, "raceoffice.db");
  await startServer();
});

afterEach(async () => {
  await closeAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("WebSocket protocol /ws/:docId", () => {
  it("sends a bootstrap snapshot on connect", async () => {
    const client = await open("eventList");

    expect(await client.next(isSnapshot)).toEqual({
      type: "snapshot",
      docId: "eventList",
      rev: 0,
      data: { activeEventId: null, events: [] },
    });
  });

  it("acks an accepted write, broadcasts it to every subscriber and persists it", async () => {
    const writer = await open("doc1");
    const reader = await open("doc1");
    await writer.next(isSnapshot);
    await reader.next(isSnapshot);

    const patch = [{ op: "add", path: "/title", value: "Hello" }];
    writer.send({ baseRev: 0, patch });

    expect(await writer.next(isAck)).toEqual({ ok: true, rev: 1 });
    expect(await reader.next(isPatch)).toEqual({ docId: "doc1", rev: 1, patch });

    const late = await open("doc1");
    expect(await late.next(isSnapshot)).toMatchObject({ rev: 1, data: { title: "Hello" } });
  });

  it("rejects a stale baseRev with rev_mismatch, re-syncs the sender and broadcasts nothing", async () => {
    const writer = await open("doc1");
    const reader = await open("doc1");
    await writer.next(isSnapshot);
    await reader.next(isSnapshot);

    writer.send({ baseRev: 0, patch: [{ op: "add", path: "/n", value: 1 }] });
    await writer.next(isAck);
    await reader.next(isPatch);

    writer.send({ baseRev: 0, patch: [{ op: "replace", path: "/n", value: 99 }] });
    expect(await writer.next(isError)).toEqual({
      type: "error",
      docId: "doc1",
      code: "rev_mismatch",
      message: "Client baseRev is stale",
      rev: 1,
      retryable: true,
    });
    expect(await writer.next(isSnapshot)).toMatchObject({ rev: 1, data: { n: 1 } });

    // The rejected write must not reach other subscribers: the next patch they see is rev 2.
    writer.send({ baseRev: 1, patch: [{ op: "replace", path: "/n", value: 2 }] });
    expect(await reader.next(isPatch)).toMatchObject({ rev: 2, patch: [{ op: "replace", path: "/n", value: 2 }] });
  });

  it("reports invalid_json and invalid_payload without a revision or re-sync", async () => {
    const client = await open("doc1");
    await client.next(isSnapshot);

    client.send("{not json");
    expect(await client.next(isError)).toEqual({
      type: "error",
      docId: "doc1",
      code: "invalid_json",
      message: "Message must be valid JSON",
    });

    client.send({ baseRev: "0", patch: [] });
    expect(await client.next(isError)).toMatchObject({ code: "invalid_payload" });
  });

  it("survives a `null` frame (used to crash the whole server process)", async () => {
    const client = await open("doc1");
    await client.next(isSnapshot);

    client.send("null");
    expect(await client.next(isError)).toMatchObject({ code: "invalid_payload" });

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
  });

  it("rejects a failing patch with patch_apply_failed and leaves the document unchanged", async () => {
    const client = await open("doc1");
    await client.next(isSnapshot);
    client.send({ baseRev: 0, patch: [{ op: "add", path: "/title", value: "kept" }] });
    await client.next(isAck);

    client.send({ baseRev: 1, patch: [{ op: "test", path: "/title", value: "other" }] });
    const error = await client.next(isError);
    expect(error).toMatchObject({ code: "patch_apply_failed", rev: 1, retryable: true });
    expect(error.message).toMatch(/^TEST_OPERATION_FAILED:/);
    expect(await client.next(isSnapshot)).toMatchObject({ rev: 1, data: { title: "kept" } });
  });

  it("keeps documents after a server restart on the same database file", async () => {
    const client = await open("doc1");
    await client.next(isSnapshot);
    client.send({ baseRev: 0, patch: [{ op: "add", path: "/persisted", value: true }] });
    await client.next(isAck);

    await closeAll();
    await startServer();

    const reconnected = await open("doc1");
    expect(await reconnected.next(isSnapshot)).toMatchObject({ rev: 1, data: { persisted: true } });
  });

  it("broadcasts server-originated updates as a full-document replace", async () => {
    const runtimeDocId = makeLiveTrackingRuntimeDocId();
    const client = await open(runtimeDocId);
    const snapshot = await client.next(isSnapshot);

    // Stopping a worker that is not running still records it as offline in the runtime doc.
    const res = await fetch(`${baseUrl}/live-tracking/worker/stop`, { method: "POST" });
    expect(res.status).toBe(200);

    const update = await client.next(isPatch);
    expect(update.rev).toBe(snapshot.rev + 1);
    expect(update.patch).toEqual([
      { op: "replace", path: "", value: expect.objectContaining({ workerStatus: "offline" }) },
    ]);
  });
});

describe("SSE stream /sse/:docId", () => {
  it("sends a snapshot event, then patch events for accepted writes", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/sse/doc1`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Reads the next SSE block that carries data (skips control blocks such as `retry:`).
    const nextEvent = async (): Promise<{ event: string; data: any }> => {
      for (;;) {
        while (!buffer.includes("\n\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error("SSE stream ended");
          buffer += decoder.decode(value, { stream: true });
        }
        const idx = buffer.indexOf("\n\n");
        const lines = buffer.slice(0, idx).split("\n");
        buffer = buffer.slice(idx + 2);
        const field = (name: string) => lines.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();
        const data = field("data");
        if (data !== undefined) return { event: field("event") ?? "message", data: JSON.parse(data) };
      }
    };

    try {
      expect(await nextEvent()).toEqual({ event: "snapshot", data: { docId: "doc1", rev: 0, data: {} } });

      const writer = await open("doc1");
      await writer.next(isSnapshot);
      const patch = [{ op: "add", path: "/x", value: 1 }];
      writer.send({ baseRev: 0, patch });

      expect(await nextEvent()).toEqual({ event: "patch", data: { docId: "doc1", rev: 1, patch } });
    } finally {
      controller.abort();
    }
  });
});

describe("HTTP endpoints", () => {
  it("GET /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /current_race_result is 404 without an active race and returns the race once seeded", async () => {
    const empty = await fetch(`${baseUrl}/current_race_result`);
    expect(empty.status).toBe(404);
    expect((await empty.json()).error).toBe("no_current_race");

    const race = {
      id: "race-1",
      name: "Senior Men Points",
      slug: "senior_men_points",
      racemode: { isPointsRace: true, isEliminationRace: false },
      stage: "final",
      stage_value: "A",
      distance_value: "10000",
      ageGroupId: "ag-1",
      eventId: "event-1",
      raceResults: [],
      raceStarters: [],
      raceActivities: [],
    };

    const eventDoc = await open("Event-event-1");
    await eventDoc.next(isSnapshot);
    eventDoc.send({
      baseRev: 0,
      patch: [{
        op: "replace",
        path: "",
        value: { id: "event-1", slug: "event-1", name: "Event 1", activeRaceId: "race-1", races: [race], athletes: [], ageGroups: [] },
      }],
    });
    await eventDoc.next(isAck);

    const eventList = await open("eventList");
    await eventList.next(isSnapshot);
    eventList.send({ baseRev: 0, patch: [{ op: "replace", path: "/activeEventId", value: "event-1" }] });
    await eventList.next(isAck);

    const res = await fetch(`${baseUrl}/current_race_result`);
    expect(res.status).toBe(200);
    expect((await res.json()).Race).toEqual({ Name: "Senior Men Points", Type: "Points", ID: "race-1" });
  });
});
