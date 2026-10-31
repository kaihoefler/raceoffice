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
 *   `timingDecoderId`. Existing register entries are never overwritten (operator edits win).
 * - Old setups carry a field `decoderId` with another meaning (AMMC decoder label, e.g. "SF");
 *   it is ignored. An early migration took it for the register id – such entries are removed
 *   again (removeMisderivedLegacyDecoders).
 */
import type { LiveTrackingSetupDocument, LiveTrackingTimingPoint } from "../livetracking/setup.js";
import {
  makeTimingDecoderAddressId,
  P3_DEFAULT_PORT,
  type LegacySimulatorSettings,
  type TimingDecoder,
  type TimingDecoderBackend,
  type TimingDecodersDocument,
} from "./decoders.js";

type SetupBackend = LiveTrackingSetupDocument["decoderBackend"];

/**
 * P3 setups connect directly; AMMC setups through the converter. A "simulation" timing point of
 * an old setup connected an AMMC converter to the simulator at its address – so it is an AMMC
 * decoder too; its simulator parameters move to the simulator (legacySimulatorSettings).
 */
function legacyBackend(_point: LiveTrackingTimingPoint, setupBackend: SetupBackend): TimingDecoderBackend {
  return (setupBackend ?? "ammc") === "p3parser" ? "p3" : "ammc";
}

/** Simulator parameters of the first "simulation" timing point of old setups, if any. */
export function legacySimulatorSettings(setups: readonly LiveTrackingSetupDocument[]): LegacySimulatorSettings | null {
  for (const setup of setups) {
    const point = (setup.track?.timingPoints ?? []).find((p) => p.decoderType === "sim");
    if (point) {
      return {
        transponderIds: [...(point.simTranCodes ?? [])],
        passingDelay: String(point.simPassingDelay ?? "1000"),
        startupDelaySecs: Number(point.simStartupDelaySecs ?? 0) || 0,
      };
    }
  }
  return null;
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
  const assigned = String(point.timingDecoderId ?? "").trim();
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
 * Writes the resolved `timingDecoderId` into every timing point that has none yet.
 * Returns the same setup object when nothing changed.
 */
export function assignLegacyDecoderIds(setup: LiveTrackingSetupDocument): LiveTrackingSetupDocument {
  let changed = false;
  const timingPoints = (setup.track?.timingPoints ?? []).map((point) => {
    if (String(point.timingDecoderId ?? "").trim()) return point;
    changed = true;
    return { ...point, timingDecoderId: resolveTimingPointDecoderId(point, setup.decoderBackend) };
  });
  return changed ? { ...setup, track: { ...setup.track, timingPoints } } : setup;
}

/**
 * Removes register entries an early migration derived from the old AMMC label field
 * `decoderId` of timing points: entry id equals that label and backend/address equal the
 * point's address. Returns the same document when there are none.
 */
export function removeMisderivedLegacyDecoders(
  doc: TimingDecodersDocument,
  setups: readonly LiveTrackingSetupDocument[],
  updatedAt: string,
): TimingDecodersDocument {
  const misderived = new Set<string>();
  for (const setup of setups) {
    for (const point of setup.track?.timingPoints ?? []) {
      const label = String((point as { decoderId?: unknown }).decoderId ?? "").trim();
      if (!label) continue;
      const backend = legacyBackend(point, setup.decoderBackend);
      const { ip, port } = legacyAddress(point, backend);
      const entry = doc.decoders.find((d) => d.id === label);
      if (entry && entry.backend === backend && entry.ip === ip && entry.port === port && entry.hardwareId === null) misderived.add(label);
    }
  }
  if (misderived.size === 0) return doc;
  return { ...doc, decoders: doc.decoders.filter((d) => !misderived.has(d.id)), updatedAt };
}
