/**
 * timing/decoders
 * ---------------
 * Decoder register of the timing layer (doc/timing-architecture.md): the physical decoders,
 * independent of any setup.
 *
 * Domain rules:
 * - Every physical decoder has a stable id. It is the hardware id the device reports (P3,
 *   e.g. "40-24-04-00", when taken over from the network scan) or one derived from its address
 *   (`makeTimingDecoderAddressId`) for devices without an own id (AMMC) and for
 *   decoders migrated from old setups.
 * - Passings are stored per decoder id. Setups map timing points to decoder ids.
 * - The clock offset belongs to the device and is applied when reading passings, never when
 *   storing them (raw decoder time stays correctable).
 */

/**
 * How the timing worker talks to the device. The decoder simulator is no backend: it replaces
 * the hardware, and a P3/AMMC decoder at 127.0.0.1 connects to it (timing/simulator.ts).
 */
export type TimingDecoderBackend =
  /** MYLAPS P3 directly over TCP (port 5403) via @raceoffice/p3parser. */
  | "p3"
  /** AMB/MYLAPS decoder through the external AMMC converter process (WebSocket). */
  | "ammc";

export type TimingDecoder = {
  id: string;
  /** Display name, e.g. "Ziel" or "P3 Gegengerade". */
  name: string;
  backend: TimingDecoderBackend;
  /** Device address (127.0.0.1 for the decoder simulator on this machine). */
  ip: string;
  /** P3: TCP port (5403). AMMC: local WebSocket port of the converter process. */
  port: number;
  /** Correction of the decoder clock in seconds; applied when reading passings. */
  clockOffsetSecs: number;
  /** Id the device reported on its last connection (P3), for display and plausibility. */
  hardwareId: string | null;
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

const BACKENDS: readonly TimingDecoderBackend[] = ["p3", "ammc"];

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
    (value.hardwareId === null || typeof value.hardwareId === "string")
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

/** Simulator settings found in a register entry of the former type "sim". */
export type LegacySimulatorSettings = { transponderIds: string[]; passingDelay: string; startupDelaySecs: number };

/**
 * Migrates register documents of earlier versions: entries of the former type "sim" become AMMC
 * decoders at the same address (that is how the old setups connected to the simulator); their
 * simulator settings are returned separately. Returns the same document when it is current.
 */
export function normalizeTimingDecodersDocument(value: unknown): { doc: TimingDecodersDocument; legacySimulator: LegacySimulatorSettings | null } | null {
  if (!isRecord(value) || value.kind !== "timingDecoders" || !Array.isArray(value.decoders)) return null;
  let legacySimulator: LegacySimulatorSettings | null = null;
  let changed = false;
  const decoders = value.decoders.map((entry) => {
    if (!isRecord(entry)) return entry;
    const hasSimField = "simulation" in entry;
    if (entry.backend !== "sim" && !hasSimField) return entry;
    changed = true;
    const { simulation, ...rest } = entry as Record<string, unknown> & { simulation?: Record<string, unknown> | null };
    if (entry.backend === "sim" && simulation && !legacySimulator) {
      legacySimulator = {
        transponderIds: Array.isArray(simulation.transponderIds) ? simulation.transponderIds.map(String) : [],
        passingDelay: String(simulation.passingDelay ?? "1000"),
        startupDelaySecs: Number(simulation.startupDelaySecs ?? 0) || 0,
      };
    }
    return { ...rest, backend: entry.backend === "sim" ? "ammc" : entry.backend };
  });
  const doc = (changed ? { ...value, decoders } : value) as unknown;
  return isTimingDecodersDocument(doc) ? { doc, legacySimulator } : null;
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
