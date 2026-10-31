/**
 * Timing layer in the worker: connection manager (one adapter per transport, explicit decoder
 * set, raw decoder time, status incl. P3 hardware/device info) and the reliable passing upload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTrackingTimingPoint, TimingDecoder, TimingDecoderStatus, TimingPassingInput } from "@raceoffice/domain";
import type { DecoderHealthPatch, DecoderSourceAdapter, NormalizedPassing } from "../decoder/adapters/decoderSourceAdapter.js";
import { TimingConnectionManager, type AdapterFactory } from "./connectionManager.js";
import { TimingPassingUploader } from "./passingUploader.js";

type Callbacks = Parameters<AdapterFactory>[2];

class FakeAdapter implements DecoderSourceAdapter {
  started = false;
  stopped = false;
  constructor(
    readonly backend: string,
    public points: LiveTrackingTimingPoint[],
    readonly cb: Callbacks,
  ) {}
  async start() {
    this.started = true;
  }
  async stop() {
    this.stopped = true;
  }
  syncPoints(points: LiveTrackingTimingPoint[]) {
    this.points = points;
  }
  onPassing() {}
  onWarning() {}
  onHealth() {}
}

const decoder = (id: string, backend: TimingDecoder["backend"], overrides: Partial<TimingDecoder> = {}): TimingDecoder => ({
  id,
  name: id,
  backend,
  ip: "10.0.0.7",
  port: backend === "p3" ? 5403 : 9001,
  clockOffsetSecs: -2,
  hardwareId: null,
  updatedAt: null,
  ...overrides,
});

const normalized = (pointId: string, overrides: Partial<NormalizedPassing> = {}): NormalizedPassing => ({
  passingId: `${pointId}:40-24-04-00:2026-10-31T10:00:00.000Z:1234:7`,
  timestamp: "2026-10-31T10:00:00.000Z",
  passingTimeSource: "rtc",
  passingNumber: 7,
  transponderId: "1234",
  transponderType: "tranx",
  decoderId: "40-24-04-00",
  timingPointId: pointId,
  signalStrength: 110,
  hits: 25,
  lowBattery: false,
  backend: "p3parser",
  ...overrides,
});

function setup() {
  const adapters: FakeAdapter[] = [];
  const passings: TimingPassingInput[] = [];
  let statuses: TimingDecoderStatus[] = [];
  const manager = new TimingConnectionManager(
    {
      onPassing: (p) => passings.push(p),
      onStatusChange: (s) => (statuses = s),
      onWarning: () => {},
    },
    {
      adapterFactory: (backend, points, cb) => {
        const a = new FakeAdapter(backend, points, cb);
        adapters.push(a);
        return a;
      },
    },
  );
  return { manager, adapters, passings, statuses: () => statuses };
}

describe("TimingConnectionManager", () => {
  it("connects nothing without desired decoders and one adapter per transport otherwise", () => {
    const { manager, adapters } = setup();
    manager.sync([]);
    expect(adapters).toHaveLength(0);

    manager.sync([
      { decoder: decoder("p3@10.0.0.7:5403", "p3"), reasons: ["explicit"] },
      { decoder: decoder("ammc@127.0.0.1:9100", "ammc", { ip: "127.0.0.1", port: 9100 }), reasons: ["livetracking"] },
    ]);
    expect(adapters.map((a) => a.backend).sort()).toEqual(["ammc", "p3parser"]);
    const p3 = adapters.find((a) => a.backend === "p3parser")!;
    // Adapter config keyed by decoder id, raw time (offset 0 – applied when reading).
    expect(p3.points[0]).toMatchObject({ id: "p3@10.0.0.7:5403", decoderIp: "10.0.0.7", decoderTimestampOffsetSecs: 0 });
    expect(adapters.find((a) => a.backend === "ammc")!.points[0]).toMatchObject({ decoderType: "amb", decoderIp: "127.0.0.1", websocketPortAMM: 9100 });

    manager.sync([{ decoder: decoder("p3@10.0.0.7:5403", "p3"), reasons: ["explicit"] }]);
    expect(adapters.find((a) => a.backend === "ammc")!.stopped).toBe(true);
    expect(p3.stopped).toBe(false);
  });

  it("turns adapter passings into timing passings with decoder id, raw time and session id", () => {
    const { manager, adapters, passings, statuses } = setup();
    manager.sync([{ decoder: decoder("p3@10.0.0.7:5403", "p3"), reasons: ["explicit"] }]);
    const session = statuses()[0]!.connectionSessionId;
    expect(session).toBeTruthy();

    adapters[0]!.cb.onPassing(normalized("p3@10.0.0.7:5403"));
    expect(passings[0]).toMatchObject({
      decoderId: "p3@10.0.0.7:5403",
      decoderTime: "2026-10-31T10:00:00.000Z",
      connectionSessionId: session,
      passingNumber: 7,
      backend: "p3",
    });
    expect(passings[0]!.id.startsWith("p3@10.0.0.7:5403:")).toBe(true);
    expect(statuses()[0]).toMatchObject({ passingCount: 1 });

    // After disconnecting, late messages are ignored and the status shows it.
    manager.sync([]);
    adapters[0]!.cb.onPassing(normalized("p3@10.0.0.7:5403"));
    expect(passings).toHaveLength(1);
    expect(statuses()[0]).toMatchObject({ connection: "disconnected", connectionSessionId: null, reasons: [] });
  });

  it("tracks connection state, hardware and device status from adapter health", () => {
    const { manager, adapters, statuses } = setup();
    manager.sync([{ decoder: decoder("p3@10.0.0.7:5403", "p3"), reasons: ["explicit", "livetracking"] }]);
    expect(statuses()[0]).toMatchObject({ connection: "connecting", reasons: ["explicit", "livetracking"] });
    const health = (patch: DecoderHealthPatch["patch"]) =>
      adapters[0]!.cb.onHealth({ timingPointId: "p3@10.0.0.7:5403", decoderName: "Ziel", patch });

    health({
      websocketStatus: "connected",
      processStatus: "running",
      lastConnectedAt: "t1",
      hardware: { hardwareId: "40-24-04-00", decoderType: "X2", firmwareVersion: "4.5" },
    });
    health({ device: { noise: 12, gpsLocked: false, temperatureC: 41, voltage: 12.4, at: "t2" }, lastMessageAt: "t2" });
    expect(statuses()[0]).toMatchObject({
      connection: "connected",
      connectedSince: "t1",
      lastMessageAt: "t2",
      hardware: { hardwareId: "40-24-04-00", firmwareVersion: "4.5" },
      device: { noise: 12, gpsLocked: false, voltage: 12.4 },
    });

    health({ websocketStatus: "error", lastError: "ECONNRESET" });
    expect(statuses()[0]).toMatchObject({ connection: "error", lastError: "ECONNRESET", connectedSince: null });
  });
});

describe("resume point for catch-up", () => {
  it("tells the adapter the highest stored passing number of a newly connected decoder", async () => {
    const resumed: Array<[string, number | null]> = [];
    const manager = new TimingConnectionManager(
      { onPassing: () => {}, onStatusChange: () => {}, onWarning: () => {} },
      {
        adapterFactory: (backend, points, cb) => {
          const a = new FakeAdapter(backend, points, cb) as FakeAdapter & { resumeFrom: (id: string, n: number | null) => void };
          a.resumeFrom = (id, n) => resumed.push([id, n]);
          return a;
        },
        fetchResumePoint: async (id) => (id === "p3@10.0.0.7:5403" ? 41 : null),
      },
    );
    manager.sync([{ decoder: decoder("p3@10.0.0.7:5403", "p3"), reasons: ["explicit"] }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(resumed).toEqual([["p3@10.0.0.7:5403", 41]]);
    // Already connected: no second resume on the next sync.
    manager.sync([{ decoder: decoder("p3@10.0.0.7:5403", "p3"), reasons: ["explicit", "livetracking"] }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(resumed).toHaveLength(1);
  });
});

describe("TimingPassingUploader", () => {
  afterEach(() => vi.useRealTimers());

  const input = (n: number) => ({ id: `p-${n}` }) as TimingPassingInput;

  it("batches, keeps failed batches and retries with backoff", async () => {
    vi.useFakeTimers();
    const bodies: string[][] = [];
    let fail = true;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push((JSON.parse(String(init?.body)) as { passings: TimingPassingInput[] }).passings.map((p) => p.id));
      return new Response("{}", { status: fail ? 503 : 200 });
    }) as unknown as typeof fetch;
    const warnings: string[] = [];
    const uploader = new TimingPassingUploader("http://x", { intervalMs: 100, fetchImpl, onWarning: (w) => warnings.push(w) });

    uploader.add(input(1));
    uploader.add(input(2));
    await vi.advanceTimersByTimeAsync(100);
    expect(bodies).toEqual([["p-1", "p-2"]]);
    expect(uploader.pending).toBe(2);
    expect(warnings[0]).toMatch(/retry in 1000 ms/);

    fail = false;
    uploader.add(input(3));
    await vi.advanceTimersByTimeAsync(1000);
    expect(bodies.at(-1)).toEqual(["p-1", "p-2", "p-3"]);
    expect(uploader.pending).toBe(0);
  });

  it("drops the oldest passings when the queue is full", () => {
    const warnings: string[] = [];
    const uploader = new TimingPassingUploader("http://x", { maxQueue: 2, intervalMs: 60_000, onWarning: (w) => warnings.push(w) });
    uploader.add(input(1));
    uploader.add(input(2));
    uploader.add(input(3));
    expect(uploader.pending).toBe(2);
    expect(warnings[0]).toMatch(/dropped 1/);
    uploader.stop();
  });
});
