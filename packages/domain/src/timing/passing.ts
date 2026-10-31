/**
 * timing/passing
 * --------------
 * A passing as stored by the timing layer: one line crossing reported by a physical decoder.
 *
 * Domain rules (doc/timing-architecture.md):
 * - Stored per physical decoder only – no setup, no timing point. Consumers map decoder ids to
 *   timing points through a setup.
 * - `decoderTime` is the raw decoder time; the decoder's clock offset is applied when reading.
 * - Immutable and append-only; `seq` (assigned by the store) increases strictly and is the basis
 *   for measurement windows and catch-up.
 * - `id` is stable for the same physical passing, so a repeated upload never duplicates it.
 */
import type { TimingDecoderBackend } from "./decoders.js";

export type TimingPassingInput = {
  id: string;
  decoderId: string;
  connectionSessionId: string | null;
  /** Raw decoder time (ISO 8601), without clock offset. */
  decoderTime: string;
  timeSource: "rtc" | "utc" | null;
  /** When the timing worker received it (ISO 8601). */
  receivedAt: string;
  passingNumber: number | null;
  transponderId: string;
  transponderType: "tranx" | "prochip" | null;
  signalStrength: number | null;
  hits: number | null;
  lowBattery: boolean | null;
  /** Set for decoder signals that are no athlete passing (e.g. start signal). */
  signalKind: string | null;
  backend: TimingDecoderBackend;
  /** Raw payload as received (JSON/text), for diagnostics. */
  raw: string | null;
};

export type TimingPassing = TimingPassingInput & { seq: number };

const BACKENDS: readonly TimingDecoderBackend[] = ["p3", "ammc", "sim"];

const nullableNumber = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const nullableString = (v: unknown) => v === null || typeof v === "string";

export function isTimingPassingInput(value: unknown): value is TimingPassingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    p.id !== "" &&
    typeof p.decoderId === "string" &&
    p.decoderId !== "" &&
    nullableString(p.connectionSessionId) &&
    typeof p.decoderTime === "string" &&
    Number.isFinite(Date.parse(p.decoderTime)) &&
    (p.timeSource === null || p.timeSource === "rtc" || p.timeSource === "utc") &&
    typeof p.receivedAt === "string" &&
    nullableNumber(p.passingNumber) &&
    typeof p.transponderId === "string" &&
    (p.transponderType === null || p.transponderType === "tranx" || p.transponderType === "prochip") &&
    nullableNumber(p.signalStrength) &&
    nullableNumber(p.hits) &&
    (p.lowBattery === null || typeof p.lowBattery === "boolean") &&
    nullableString(p.signalKind) &&
    BACKENDS.includes(p.backend as TimingDecoderBackend) &&
    nullableString(p.raw)
  );
}

/** Messages on the passing stream (WS /timing/passings/stream). */
export type TimingPassingStreamMessage =
  /** Catch-up or live: passings in `seq` order. */
  | { type: "passings"; passings: TimingPassing[] }
  /** Catch-up is complete; everything after this is live. */
  | { type: "live"; lastSeq: number }
  /** Passings were deleted on the timing layer; consumers recompute. */
  | { type: "deleted"; deleted: number; filter: TimingPassingDeleteFilter };

/** Filter for deleting passings; all fields optional, `all: true` needed to delete everything. */
export type TimingPassingDeleteFilter = {
  decoderIds?: string[];
  /** Received from (inclusive, ISO 8601). */
  from?: string;
  /** Received until (exclusive, ISO 8601). */
  to?: string;
  all?: boolean;
};
