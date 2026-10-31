/**
 * timing/decoders
 * ---------------
 * Decoder register of the timing layer (doc/timing-architecture.md): the physical decoders,
 * independent of any setup.
 *
 * Domain rules:
 * - Every physical decoder has a stable id. It is the hardware id the device reports (P3,
 *   e.g. "40-24-04-00", when taken over from the network scan) or one derived from its address
 *   (`makeTimingDecoderAddressId`) for devices without an own id (AMMC, simulator) and for
 *   decoders migrated from old setups.
 * - Passings are stored per decoder id. Setups map timing points to decoder ids.
 * - The clock offset belongs to the device and is applied when reading passings, never when
 *   storing them (raw decoder time stays correctable).
 */

/** How the timing worker talks to the device. */
export type TimingDecoderBackend =
  /** MYLAPS P3 directly over TCP (port 5403) via @raceoffice/p3parser. */
  | "p3"
  /** AMB/MYLAPS decoder through the external AMMC converter process (WebSocket). */
  | "ammc"
  /** Local AMMC simulator (`ammc-sim`) – generates passings for tests and training. */
  | "sim";

export type TimingDecoderSimulation = {
  /** Transponder ids the simulator emits. */
  transponderIds: string[];
  /** Delay between passings in ms, fixed ("1000") or as range ("800-1200"). */
  passingDelay: string;
  /** Delay before the first passing in seconds (orders several simulators around a track). */
  startupDelaySecs: number;
};

export type TimingDecoder = {
  id: string;
  /** Display name, e.g. "Ziel" or "P3 Gegengerade". */
  name: string;
  backend: TimingDecoderBackend;
  /** Device address (P3/AMMC) – for the simulator 127.0.0.1. */
  ip: string;
  /** P3: TCP port (5403). AMMC/simulator: local WebSocket port of the converter process. */
  port: number;
  /** Correction of the decoder clock in seconds; applied when reading passings. */
  clockOffsetSecs: number;
  /** Id the device reported on its last connection (P3), for display and plausibility. */
  hardwareId: string | null;
  /** Only for `backend === "sim"`. */
  simulation: TimingDecoderSimulation | null;
  updatedAt: string | null;
};

export type TimingDecodersDocument = {
  kind: "timingDecoders";
  version: 1;
  decoders: TimingDecoder[];
  updatedAt: string | null;
};

/** Default TCP port of MYLAPS P3 decoders. */
export const P3_DEFAULT_PORT = 5403;

export function createTimingDecodersDocument(): TimingDecodersDocument {
  return { kind: "timingDecoders", version: 1, decoders: [], updatedAt: null };
}

/**
 * Stable id for a decoder without an own hardware id, derived from how it is reached,
 * e.g. "p3@192.168.1.50:5403". Deterministic, so migrating the same setup twice (or two setups
 * pointing to the same device) yields the same decoder.
 */
export function makeTimingDecoderAddressId(backend: TimingDecoderBackend, ip: string, port: number): string {
  return `${backend}@${String(ip ?? "").trim()}:${Number(port) || 0}`;
}

export function findTimingDecoder(doc: TimingDecodersDocument | null | undefined, id: string): TimingDecoder | null {
  return doc?.decoders.find((d) => d.id === id) ?? null;
}

const BACKENDS: readonly TimingDecoderBackend[] = ["p3", "ammc", "sim"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isTimingDecoder(value: unknown): value is TimingDecoder {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    typeof value.name === "string" &&
    BACKENDS.includes(value.backend as TimingDecoderBackend) &&
    typeof value.ip === "string" &&
    typeof value.port === "number" &&
    typeof value.clockOffsetSecs === "number" &&
    (value.hardwareId === null || typeof value.hardwareId === "string") &&
    (value.simulation === null || isRecord(value.simulation))
  );
}

export function isTimingDecodersDocument(value: unknown): value is TimingDecodersDocument {
  if (!isRecord(value)) return false;
  return (
    value.kind === "timingDecoders" &&
    value.version === 1 &&
    Array.isArray(value.decoders) &&
    value.decoders.every(isTimingDecoder)
  );
}

/**
 * Applies a decoder clock offset to a raw decoder time (ISO string).
 * Positive offsets shift into the future. Invalid times are returned unchanged.
 */
export function applyTimingClockOffset(decoderTime: string, offsetSecs: number): string {
  const ms = Date.parse(decoderTime);
  if (!Number.isFinite(ms) || !offsetSecs) return decoderTime;
  return new Date(ms + Math.round(offsetSecs * 1000)).toISOString();
}
