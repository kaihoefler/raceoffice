import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeLiveTrackingListDocId } from "@raceoffice/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocStore } from "../src/services/docStore";

let dbDir: string;
let store: DocStore;

beforeEach(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "raceoffice-docstore-"));
  store = new DocStore(path.join(dbDir, "raceoffice.db"));
});

afterEach(() => {
  store.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("DocStore — bootstrap defaults", () => {
  it("bootstraps eventList with the dedicated core default shape", () => {
    const doc = store.loadDoc("eventList");
    expect(doc).toEqual({ rev: 0, data: { activeEventId: null, events: [] } });
  });

  it("bootstraps known LiveTracking ids via domain defaults", () => {
    const doc = store.loadDoc(makeLiveTrackingListDocId());
    expect(doc.rev).toBe(0);
    expect(doc.data).toEqual({
      kind: "liveTrackingList",
      version: 1,
      setups: [],
      participantPools: [],
    });
  });

  it("falls back to an empty object for unknown ids (backward compatibility)", () => {
    const doc = store.loadDoc("someUnknownDocId");
    expect(doc).toEqual({ rev: 0, data: {} });
  });

  it("persists the bootstrap document immediately so repeated loads are stable", () => {
    const first = store.loadDoc("eventList");
    const second = store.loadDoc("eventList");
    expect(second).toEqual(first);
  });
});

describe("DocStore — save/load round-trip (upsert)", () => {
  it("round-trips a freshly inserted document", () => {
    store.saveDoc("myDoc", { rev: 3, data: { foo: "bar" } });

    expect(store.loadDoc("myDoc")).toEqual({ rev: 3, data: { foo: "bar" } });
  });

  it("overwrites an existing document on the update path (ON CONFLICT DO UPDATE)", () => {
    store.saveDoc("myDoc", { rev: 1, data: { count: 1 } });
    store.saveDoc("myDoc", { rev: 2, data: { count: 2 } });

    expect(store.loadDoc("myDoc")).toEqual({ rev: 2, data: { count: 2 } });
  });

  it("keeps documents isolated by id", () => {
    store.saveDoc("docA", { rev: 1, data: { which: "A" } });
    store.saveDoc("docB", { rev: 1, data: { which: "B" } });

    expect(store.loadDoc("docA").data).toEqual({ which: "A" });
    expect(store.loadDoc("docB").data).toEqual({ which: "B" });
  });
});

describe("DocStore — persistence across instances", () => {
  it("survives closing and reopening the same db file", () => {
    const dbPath = path.join(dbDir, "reopen.db");
    const first = new DocStore(dbPath);
    first.saveDoc("persisted", { rev: 5, data: { ok: true } });
    first.close();

    const reopened = new DocStore(dbPath);
    expect(reopened.loadDoc("persisted")).toEqual({ rev: 5, data: { ok: true } });
    reopened.close();
  });
});
