/**
 * TimingConnectionManager – physical decoder connections of the timing layer
 * (doc/timing-architecture.md, 2.2 "Verbindungssteuerung").
 *
 * - Input: the decoders that should be connected (register entries) and why.
 * - Runs one adapter per transport (P3 → p3parser adapter, AMMC/simulator → AMMC adapter) and
 *   keeps their decoder sets in sync; an adapter without decoders is stopped.
 * - Adapters still work with timing-point shaped configs. Each decoder is handed over as such a
 *   config with `id = decoder id` and clock offset 0, so passings come back keyed by decoder id
 *   with the raw decoder time (offsets are applied when reading, not when storing).
 * - Output: passings as timing passings (with connection session id) and the live status per
 *   decoder (connection, hardware info, device status, passing count).
 */
import { randomUUID } from "node:crypto";
import {
  createTimingDecoderStatus,
  type LiveTrackingTimingPoint,
  type TimingConnectionReason,
  type TimingDecoder,
  type TimingDecoderStatus,
  type TimingPassingInput,
} from "@raceoffice/domain";
import { createDecoderSourceAdapter } from "../decoder/adapters/createDecoderSourceAdapter.js";
import type {
  DecoderBackendKind,
  DecoderHealthPatch,
  DecoderSourceAdapter,
  NormalizedPassing,
} from "../decoder/adapters/decoderSourceAdapter.js";

export type DesiredDecoder = { decoder: TimingDecoder; reasons: TimingConnectionReason[] };

export type ConnectionManagerCallbacks = {
  onPassing: (passing: TimingPassingInput, normalized: NormalizedPassing) => void;
  onStatusChange: (statuses: TimingDecoderStatus[]) => void;
  onWarning: (message: string) => void;
};

/** Adapter factory (replaceable in tests). */
export type AdapterFactory = (
  backend: DecoderBackendKind,
  points: LiveTrackingTimingPoint[],
  callbacks: { onPassing: (p: NormalizedPassing) => void; onWarning: (m: string) => void; onHealth: (h: DecoderHealthPatch) => void },
) => DecoderSourceAdapter;

function transportOf(decoder: TimingDecoder): DecoderBackendKind {
  return decoder.backend === "p3" ? "p3parser" : "ammc";
}

/** Adapter config for one physical decoder (timing-point shape, offset 0 = raw decoder time). */
export function decoderToAdapterPoint(decoder: TimingDecoder, order: number): LiveTrackingTimingPoint {
  return {
    id: decoder.id,
    name: decoder.name || decoder.id,
    decoderIp: decoder.ip,
    websocketPortAMM: decoder.port,
    // Always a real (or simulated, see SimulatorProcess) decoder: the AMMC manager must never
    // start a simulator for a decoder connection.
    decoderType: "amb",
    decoderTimestampOffsetSecs: 0,
    order,
    distanceFromPreviousM: 0,
    absolutePositionM: 0,
    // Adapters only connect; roles matter to consumers, not here.
    role: order === 1 ? "start_finish" : "split",
    enabled: true,
  };
}

function connectionState(patch: DecoderHealthPatch["patch"], current: TimingDecoderStatus["connection"]): TimingDecoderStatus["connection"] {
  if (patch.websocketStatus === "connected") return "connected";
  if (patch.websocketStatus === "error" || patch.processStatus === "error") return "error";
  if (patch.websocketStatus === "connecting" || patch.processStatus === "starting") return "connecting";
  if (patch.websocketStatus === "disconnected" || patch.processStatus === "stopped") return "disconnected";
  return current;
}

export class TimingConnectionManager {
  private readonly adapters = new Map<DecoderBackendKind, DecoderSourceAdapter>();
  private desired = new Map<string, DesiredDecoder>();
  private readonly statuses = new Map<string, TimingDecoderStatus>();
  private readonly adapterFactory: AdapterFactory;

  private readonly fetchResumePoint: ((decoderId: string) => Promise<number | null>) | null;

  constructor(
    private readonly callbacks: ConnectionManagerCallbacks,
    options: {
      adapterFactory?: AdapterFactory;
      /** Highest passing number already stored for a decoder (catch-up after reconnecting). */
      fetchResumePoint?: (decoderId: string) => Promise<number | null>;
    } = {},
  ) {
    this.adapterFactory = options.adapterFactory ?? createDecoderSourceAdapter;
    this.fetchResumePoint = options.fetchResumePoint ?? null;
  }

  /** Current status of all decoders that are or were connected in this worker run. */
  get statusList(): TimingDecoderStatus[] {
    return [...this.statuses.values()];
  }

  isConnected(decoderId: string): boolean {
    return this.desired.has(decoderId);
  }

  /** Reconciles connections with the desired decoders. */
  sync(desired: readonly DesiredDecoder[]): void {
    const next = new Map(desired.map((d) => [d.decoder.id, d]));
    const previous = this.desired;
    let statusChanged = false;

    // Newly desired decoders start a connection session; removed ones end it.
    for (const [id, entry] of next) {
      const status = this.statuses.get(id) ?? createTimingDecoderStatus(id);
      const wasDesired = this.desired.has(id);
      const reasonsChanged = JSON.stringify(status.reasons) !== JSON.stringify(entry.reasons);
      if (!wasDesired) {
        this.statuses.set(id, {
          ...status,
          connection: "connecting",
          reasons: entry.reasons,
          connectionSessionId: randomUUID(),
          connectedSince: null,
          lastError: null,
          passingCount: 0,
        });
        statusChanged = true;
      } else if (reasonsChanged) {
        this.statuses.set(id, { ...status, reasons: entry.reasons });
        statusChanged = true;
      }
    }
    for (const id of this.desired.keys()) {
      if (next.has(id)) continue;
      const status = this.statuses.get(id);
      if (status) {
        this.statuses.set(id, { ...status, connection: "disconnected", reasons: [], connectionSessionId: null, connectedSince: null });
        statusChanged = true;
      }
    }
    this.desired = next;

    // One adapter per transport with exactly its decoders.
    const byTransport = new Map<DecoderBackendKind, LiveTrackingTimingPoint[]>();
    for (const { decoder } of next.values()) {
      const transport = transportOf(decoder);
      const points = byTransport.get(transport) ?? [];
      points.push(decoderToAdapterPoint(decoder, points.length + 1));
      byTransport.set(transport, points);
    }
    for (const transport of ["p3parser", "ammc"] as const) {
      const points = byTransport.get(transport) ?? [];
      const adapter = this.adapters.get(transport);
      if (points.length === 0) {
        if (adapter) {
          adapter.stop().catch(() => {});
          this.adapters.delete(transport);
        }
        continue;
      }
      if (adapter) {
        adapter.syncPoints(points);
        continue;
      }
      const created = this.adapterFactory(transport, points, {
        onPassing: (p) => this.handlePassing(p),
        onWarning: (m) => this.callbacks.onWarning(m),
        onHealth: (h) => this.handleHealth(h),
      });
      this.adapters.set(transport, created);
      created.start().catch((err: unknown) => {
        this.callbacks.onWarning(`[timing] ${transport} adapter start failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    // Newly connected decoders: tell the adapter where the stored passings end.
    if (this.fetchResumePoint) {
      for (const [id, entry] of next) {
        if (previous.has(id)) continue;
        const adapter = this.adapters.get(transportOf(entry.decoder));
        if (!adapter?.resumeFrom) continue;
        this.fetchResumePoint(id)
          .then((n) => adapter.resumeFrom?.(id, n))
          .catch(() => adapter.resumeFrom?.(id, null));
      }
    }

    if (statusChanged) this.callbacks.onStatusChange(this.statusList);
  }

  async stop(): Promise<void> {
    const adapters = [...this.adapters.values()];
    this.adapters.clear();
    await Promise.allSettled(adapters.map((a) => a.stop()));
    this.sync([]);
  }

  private handlePassing(normalized: NormalizedPassing): void {
    // Adapters report the adapter config id, which is the decoder id here.
    const decoderId = normalized.timingPointId;
    const entry = this.desired.get(decoderId);
    if (!entry) return; // late message after disconnect
    const status = this.statuses.get(decoderId) ?? createTimingDecoderStatus(decoderId);
    const receivedAt = new Date().toISOString();
    this.statuses.set(decoderId, { ...status, passingCount: status.passingCount + 1, lastMessageAt: receivedAt });

    const passing: TimingPassingInput = {
      // Adapter ids already start with the config id (= decoder id) and contain the passing number.
      id: normalized.passingId,
      decoderId,
      connectionSessionId: status.connectionSessionId,
      decoderTime: normalized.timestamp,
      timeSource: normalized.passingTimeSource ?? null,
      receivedAt,
      passingNumber: Number.isFinite(normalized.passingNumber) ? normalized.passingNumber : null,
      transponderId: normalized.transponderId,
      transponderType: normalized.transponderType ?? null,
      signalStrength: Number.isFinite(normalized.signalStrength) ? normalized.signalStrength : null,
      hits: Number.isFinite(normalized.hits) ? normalized.hits : null,
      lowBattery: typeof normalized.lowBattery === "boolean" ? normalized.lowBattery : null,
      signalKind: normalized.signalKind ?? null,
      backend: entry.decoder.backend,
      raw: typeof normalized.raw === "string" ? normalized.raw : null,
    };
    this.callbacks.onPassing(passing, normalized);
    this.callbacks.onStatusChange(this.statusList);
  }

  private handleHealth(update: DecoderHealthPatch): void {
    const decoderId = update.timingPointId;
    if (!this.desired.has(decoderId)) return;
    const status = this.statuses.get(decoderId) ?? createTimingDecoderStatus(decoderId);
    const { patch } = update;
    const connection = connectionState(patch, status.connection);
    const next: TimingDecoderStatus = {
      ...status,
      connection,
      connectedSince: connection === "connected" ? (status.connectedSince ?? patch.lastConnectedAt ?? new Date().toISOString()) : null,
      lastMessageAt: patch.lastMessageAt ?? status.lastMessageAt,
      lastError: patch.lastError !== undefined ? patch.lastError : status.lastError,
      hardware: patch.hardware ?? status.hardware,
      device: patch.device ?? status.device,
      sequence: patch.sequence ?? status.sequence ?? null,
    };
    this.statuses.set(decoderId, next);
    this.callbacks.onStatusChange(this.statusList);
  }
}
