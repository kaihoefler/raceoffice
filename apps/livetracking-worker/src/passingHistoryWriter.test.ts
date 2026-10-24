import { describe, expect, it } from "vitest";
import {
  createLiveTrackingPassingHistoryDocument,
  type LiveTrackingPassingEvent,
  type LiveTrackingPassingHistoryDocument,
} from "@raceoffice/domain";

import { PassingHistoryWriter, type PassingHistoryDocClient } from "./passingHistoryWriter.js";

/** In-memory stand-in for RealtimeDocClient: writes stay unconfirmed until `ack`/`reject`. */
class FakeHistoryClient implements PassingHistoryDocClient {
  data: LiveTrackingPassingHistoryDocument | null = createLiveTrackingPassingHistoryDocument();
  rev = 0;
  connected = true;
  private sent: LiveTrackingPassingHistoryDocument | null = null;

  update(mutator: (prev: LiveTrackingPassingHistoryDocument) => LiveTrackingPassingHistoryDocument): boolean {
    if (!this.connected || !this.data) return false;
    this.sent = mutator(structuredClone(this.data));
    return true;
  }

  ack() {
    this.data = this.sent;
    this.sent = null;
    this.rev += 1;
  }

  /** Server rejected the write; client resyncs to a (possibly changed) snapshot. */
  resync(data: LiveTrackingPassingHistoryDocument) {
    this.sent = null;
    this.data = data;
    this.rev += 1;
  }
}

function p(id: string): LiveTrackingPassingEvent {
  return { id, timestamp: "2026-01-01T10:00:00.000Z", transponderId: "1", timingPointId: "sf", decoderId: "d" };
}

const ids = (list: LiveTrackingPassingEvent[] | null) => (list ?? []).map((x) => x.id);

describe("PassingHistoryWriter", () => {
  it("appends pending passings in one batch and exposes them before confirmation", () => {
    const client = new FakeHistoryClient();
    const writer = new PassingHistoryWriter(client);

    writer.append(p("a"));
    writer.append(p("b"));
    expect(ids(writer.allPassings())).toEqual(["a", "b"]);

    expect(writer.flush()).toBe(true);
    expect(ids(writer.allPassings())).toEqual(["a", "b"]);

    client.ack();
    writer.onDocumentChanged();
    expect(ids(client.data!.passings)).toEqual(["a", "b"]);
    expect(ids(writer.allPassings())).toEqual(["a", "b"]);
  });

  it("does not send a second batch while the first is unconfirmed", () => {
    const client = new FakeHistoryClient();
    const writer = new PassingHistoryWriter(client);

    writer.append(p("a"));
    writer.flush();
    writer.append(p("b"));
    expect(writer.flush()).toBe(false);

    client.ack();
    writer.onDocumentChanged();
    expect(writer.flush()).toBe(true);
    client.ack();
    writer.onDocumentChanged();
    expect(ids(client.data!.passings)).toEqual(["a", "b"]);
  });

  it("re-queues a rejected batch", () => {
    const client = new FakeHistoryClient();
    const writer = new PassingHistoryWriter(client);

    writer.append(p("a"));
    writer.flush();
    client.resync({ ...createLiveTrackingPassingHistoryDocument(), passings: [] });
    writer.onDocumentChanged();

    expect(writer.hasPending()).toBe(true);
    writer.flush();
    client.ack();
    writer.onDocumentChanged();
    expect(ids(client.data!.passings)).toEqual(["a"]);
  });

  it("drops the in-flight batch when the history was reset meanwhile", () => {
    const client = new FakeHistoryClient();
    const writer = new PassingHistoryWriter(client);

    writer.append(p("a"));
    writer.flush();
    client.ack();
    writer.onDocumentChanged();

    writer.append(p("b"));
    writer.flush();
    client.resync({ ...createLiveTrackingPassingHistoryDocument(), passings: [] }); // reset
    writer.onDocumentChanged();

    expect(writer.hasPending()).toBe(false);
    expect(ids(writer.allPassings())).toEqual([]);
  });

  it("keeps passings pending while disconnected", () => {
    const client = new FakeHistoryClient();
    client.connected = false;
    const writer = new PassingHistoryWriter(client);

    writer.append(p("a"));
    expect(writer.flush()).toBe(false);
    expect(writer.hasPending()).toBe(true);
  });

  it("returns null until the history document has loaded", () => {
    const client = new FakeHistoryClient();
    client.data = null;
    expect(new PassingHistoryWriter(client).allPassings()).toBeNull();
  });
});
