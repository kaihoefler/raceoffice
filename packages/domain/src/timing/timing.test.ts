import { describe, expect, it } from "vitest";
import { initialDocumentData } from "../documentBootstrap.js";
import { createLiveTrackingSetupDocument, type LiveTrackingSetupDocument, type LiveTrackingTimingPoint } from "../livetracking/setup.js";
import {
  applyTimingClockOffset,
  assignLegacyDecoderIds,
  createTimingConnectionDocument,
  createTimingDecodersDocument,
  isTimingDecodersDocument,
  isTimingPassingInput,
  mergeLegacySetupDecoders,
  resolveTimingPointDecoderId,
  setTimingDecoderConnected,
  TIMING_CONNECTION_DOC_ID,
  TIMING_DECODERS_DOC_ID,
  TIMING_STATUS_DOC_ID,
  getSetupDecoderIds,
  toTimingPointPassings,
  type TimingPassing,
  type TimingPassingInput,
} from "./index.js";

const point = (overrides: Partial<LiveTrackingTimingPoint>): LiveTrackingTimingPoint => ({
  id: "tp-1",
  name: "Ziel",
  decoderIp: "192.168.1.50",
  websocketPortAMM: 9001,
  decoderType: "amb",
  decoderTimestampOffsetSecs: 0,
  order: 1,
  distanceFromPreviousM: 0,
  absolutePositionM: 0,
  role: "start_finish",
  enabled: true,
  ...overrides,
});

function setup(points: LiveTrackingTimingPoint[], decoderBackend: "ammc" | "p3parser" = "ammc"): LiveTrackingSetupDocument {
  const doc = createLiveTrackingSetupDocument({ setupId: "s1", eventId: null, name: "Setup" });
  return { ...doc, decoderBackend, track: { ...doc.track, timingPoints: points } };
}

describe("timing documents", () => {
  it("bootstraps the timing singletons", () => {
    expect(initialDocumentData(TIMING_DECODERS_DOC_ID)).toEqual(createTimingDecodersDocument());
    expect(initialDocumentData(TIMING_CONNECTION_DOC_ID)).toEqual(createTimingConnectionDocument());
    expect(initialDocumentData(TIMING_STATUS_DOC_ID)).toMatchObject({ kind: "timingStatus", decoders: [] });
  });

  it("toggles decoder connection wishes", () => {
    const doc = createTimingConnectionDocument();
    const on = setTimingDecoderConnected(doc, "p3@1.2.3.4:5403", true, "t1");
    expect(on.connectedDecoderIds).toEqual(["p3@1.2.3.4:5403"]);
    expect(setTimingDecoderConnected(on, "p3@1.2.3.4:5403", true, "t2")).toBe(on);
    expect(setTimingDecoderConnected(on, "p3@1.2.3.4:5403", false, "t3").connectedDecoderIds).toEqual([]);
  });

  it("applies the clock offset when reading, not when storing", () => {
    expect(applyTimingClockOffset("2026-10-31T10:00:00.000Z", -1.25)).toBe("2026-10-31T09:59:58.750Z");
    expect(applyTimingClockOffset("2026-10-31T10:00:00.000Z", 0)).toBe("2026-10-31T10:00:00.000Z");
  });

  it("validates passings for the store", () => {
    const passing: TimingPassingInput = {
      id: "x",
      decoderId: "p3@1.2.3.4:5403",
      connectionSessionId: null,
      decoderTime: "2026-10-31T10:00:00.000Z",
      timeSource: "rtc",
      receivedAt: "2026-10-31T10:00:00.010Z",
      passingNumber: 7,
      transponderId: "1234567",
      transponderType: "tranx",
      signalStrength: 120,
      hits: 30,
      lowBattery: false,
      signalKind: null,
      backend: "p3",
      raw: null,
    };
    expect(isTimingPassingInput(passing)).toBe(true);
    expect(isTimingPassingInput({ ...passing, decoderTime: "nonsense" })).toBe(false);
    expect(isTimingPassingInput({ ...passing, backend: "p3parser" })).toBe(false);
  });
});

describe("migration of LiveTracking setups", () => {
  it("derives one decoder per address; the same device in two setups is one decoder", () => {
    const a = setup([point({ id: "tp-1", name: "Ziel" }), point({ id: "tp-2", name: "Split", decoderIp: "192.168.1.51", decoderTimestampOffsetSecs: -0.5 })]);
    const b = setup([point({ id: "tp-9", name: "Ziel (Setup B)" })]);
    const doc = mergeLegacySetupDecoders(createTimingDecodersDocument(), [a, b], "now");
    expect(isTimingDecodersDocument(doc)).toBe(true);
    expect(doc.decoders.map((d) => [d.id, d.name, d.clockOffsetSecs])).toEqual([
      ["ammc@192.168.1.50:9001", "Ziel", 0],
      ["ammc@192.168.1.51:9001", "Split", -0.5],
    ]);
    // Idempotent: nothing new, same object.
    expect(mergeLegacySetupDecoders(doc, [a, b], "later")).toBe(doc);
  });

  it("maps P3 setups to the P3 port and simulators with their parameters", () => {
    const p3 = setup([point({ decoderIp: "10.0.0.7" })], "p3parser");
    const sim = setup([point({ decoderIp: "127.0.0.1", websocketPortAMM: 9100, decoderType: "sim", simTranCodes: ["1", "2"], simPassingDelay: "900" })]);
    const doc = mergeLegacySetupDecoders(createTimingDecodersDocument(), [p3, sim], "now");
    expect(doc.decoders[0]).toMatchObject({ id: "p3@10.0.0.7:5403", backend: "p3", port: 5403, simulation: null });
    expect(doc.decoders[1]).toMatchObject({
      id: "sim@127.0.0.1:9100",
      backend: "sim",
      simulation: { transponderIds: ["1", "2"], passingDelay: "900", startupDelaySecs: 0 },
    });
  });

  it("keeps operator edits and assigned ids", () => {
    const edited = { ...createTimingDecodersDocument(), decoders: [] as ReturnType<typeof createTimingDecodersDocument>["decoders"] };
    const first = mergeLegacySetupDecoders(edited, [setup([point({})])], "now");
    const renamed = { ...first, decoders: first.decoders.map((d) => ({ ...d, name: "Ziel (umbenannt)" })) };
    expect(mergeLegacySetupDecoders(renamed, [setup([point({ name: "Anders" })])], "later")).toBe(renamed);

    const assigned = point({ decoderId: "40-24-04-00" });
    expect(resolveTimingPointDecoderId(assigned, "p3parser")).toBe("40-24-04-00");
  });

  it("writes decoder ids into timing points without changing the old fields", () => {
    const s = setup([point({}), point({ id: "tp-2", decoderId: "40-24-04-00" })]);
    const migrated = assignLegacyDecoderIds(s);
    expect(migrated.track.timingPoints.map((p) => p.decoderId)).toEqual(["ammc@192.168.1.50:9001", "40-24-04-00"]);
    expect(migrated.track.timingPoints[0]).toMatchObject({ decoderIp: "192.168.1.50", websocketPortAMM: 9001 });
    expect(assignLegacyDecoderIds(migrated)).toBe(migrated);
  });
});

describe("setup mapping (consumer side)", () => {
  const stored = (n: number, decoderId: string, overrides: Partial<TimingPassing> = {}): TimingPassing => ({
    seq: n,
    id: `p${n}`,
    decoderId,
    connectionSessionId: null,
    decoderTime: "2026-10-31T10:00:00.000Z",
    timeSource: "rtc",
    receivedAt: "2026-10-31T10:00:00.000Z",
    passingNumber: n,
    transponderId: "1234",
    transponderType: "tranx",
    signalStrength: null,
    hits: null,
    lowBattery: null,
    signalKind: null,
    backend: "p3",
    raw: null,
    ...overrides,
  });

  it("maps decoder passings to timing points with the register offset; two setups share the passings", () => {
    const decoders = mergeLegacySetupDecoders(createTimingDecodersDocument(), [setup([point({})])], "t");
    const withOffset = { ...decoders, decoders: decoders.decoders.map((d) => ({ ...d, clockOffsetSecs: 1 })) };
    const a = setup([point({ id: "finish", decoderId: "ammc@192.168.1.50:9001" })]);
    const b = setup([point({ id: "ziel-b", decoderId: "ammc@192.168.1.50:9001" }), point({ id: "off", enabled: false, decoderId: "x" })]);
    const passings = [stored(1, "ammc@192.168.1.50:9001"), stored(2, "other"), stored(3, "ammc@192.168.1.50:9001", { signalKind: "start_signal" })];

    expect(getSetupDecoderIds(a)).toEqual(["ammc@192.168.1.50:9001"]);
    expect(toTimingPointPassings(passings, a, withOffset)).toEqual([
      { id: "finish:p1", timestamp: "2026-10-31T10:00:01.000Z", transponderId: "1234", timingPointId: "finish", decoderId: "ammc@192.168.1.50:9001" },
    ]);
    expect(toTimingPointPassings(passings, b, withOffset).map((p) => p.timingPointId)).toEqual(["ziel-b"]);
  });

  it("uses the timing point offset for decoders missing in the register", () => {
    const s = setup([point({ decoderTimestampOffsetSecs: -2 })]);
    expect(toTimingPointPassings([stored(1, "ammc@192.168.1.50:9001")], s, null)[0]?.timestamp).toBe("2026-10-31T09:59:58.000Z");
  });
});
