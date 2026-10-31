/**
 * timing/legacySetup
 * ------------------
 * Bridge from LiveTracking setups (decoder address inside each timing point) to the decoder
 * register of the timing layer.
 *
 * Migration rules (doc/timing-architecture.md, section 8):
 * - Every timing point yields one register entry; same backend + address = same decoder
 *   (deterministic address id, so the migration is idempotent).
 * - Non-destructive: the old fields stay in the setup, the timing point additionally gets
 *   `decoderId`. Existing register entries are never overwritten (operator edits win).
 */
import type { LiveTrackingSetupDocument, LiveTrackingTimingPoint } from "../livetracking/setup.js";
import {
  makeTimingDecoderAddressId,
  P3_DEFAULT_PORT,
  type TimingDecoder,
  type TimingDecoderBackend,
  type TimingDecodersDocument,
} from "./decoders.js";

type SetupBackend = LiveTrackingSetupDocument["decoderBackend"];

function legacyBackend(point: LiveTrackingTimingPoint, setupBackend: SetupBackend): TimingDecoderBackend {
  if ((setupBackend ?? "ammc") === "p3parser") return "p3";
  return point.decoderType === "sim" ? "sim" : "ammc";
}

function legacyAddress(point: LiveTrackingTimingPoint, backend: TimingDecoderBackend): { ip: string; port: number } {
  if (backend === "p3") return { ip: String(point.decoderIp ?? "").trim(), port: P3_DEFAULT_PORT };
  return { ip: String(point.decoderIp ?? "").trim(), port: Number(point.websocketPortAMM) || 0 };
}

/**
 * Decoder id of a timing point: the assigned register id, otherwise the id derived from the
 * decoder address stored in the point (setups written before the register existed).
 */
export function resolveTimingPointDecoderId(point: LiveTrackingTimingPoint, setupBackend: SetupBackend): string {
  const assigned = String(point.decoderId ?? "").trim();
  if (assigned) return assigned;
  const backend = legacyBackend(point, setupBackend);
  const { ip, port } = legacyAddress(point, backend);
  return makeTimingDecoderAddressId(backend, ip, port);
}

/** Register entry described by a legacy timing point. */
export function timingDecoderFromLegacyPoint(
  point: LiveTrackingTimingPoint,
  setupBackend: SetupBackend,
  updatedAt: string | null = null,
): TimingDecoder {
  const backend = legacyBackend(point, setupBackend);
  const { ip, port } = legacyAddress(point, backend);
  return {
    id: resolveTimingPointDecoderId(point, setupBackend),
    name: String(point.name ?? "").trim() || ip,
    backend,
    ip,
    port,
    clockOffsetSecs: Number(point.decoderTimestampOffsetSecs ?? 0) || 0,
    hardwareId: null,
    simulation:
      backend === "sim"
        ? {
            transponderIds: [...(point.simTranCodes ?? [])],
            passingDelay: String(point.simPassingDelay ?? "1000"),
            startupDelaySecs: Number(point.simStartupDelaySecs ?? 0) || 0,
          }
        : null,
    updatedAt,
  };
}

/**
 * Adds register entries for all timing points of the given setups that are not yet known.
 * Returns the same document object when nothing was added.
 */
export function mergeLegacySetupDecoders(
  doc: TimingDecodersDocument,
  setups: readonly LiveTrackingSetupDocument[],
  updatedAt: string,
): TimingDecodersDocument {
  const known = new Set(doc.decoders.map((d) => d.id));
  const added: TimingDecoder[] = [];
  for (const setup of setups) {
    for (const point of setup.track?.timingPoints ?? []) {
      const decoder = timingDecoderFromLegacyPoint(point, setup.decoderBackend, updatedAt);
      if (!decoder.ip || known.has(decoder.id)) continue;
      known.add(decoder.id);
      added.push(decoder);
    }
  }
  if (added.length === 0) return doc;
  return { ...doc, decoders: [...doc.decoders, ...added], updatedAt };
}

/**
 * Writes the resolved `decoderId` into every timing point that has none yet.
 * Returns the same setup object when nothing changed.
 */
export function assignLegacyDecoderIds(setup: LiveTrackingSetupDocument): LiveTrackingSetupDocument {
  let changed = false;
  const timingPoints = (setup.track?.timingPoints ?? []).map((point) => {
    if (String(point.decoderId ?? "").trim()) return point;
    changed = true;
    return { ...point, decoderId: resolveTimingPointDecoderId(point, setup.decoderBackend) };
  });
  return changed ? { ...setup, track: { ...setup.track, timingPoints } } : setup;
}
