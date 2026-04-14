/**
 * AMM payload normalization layer.
 *
 * Goal:
 * - convert decoder/vendor specific websocket payloads into the canonical
 *   `LiveTrackingRuntimePassingEvent` shape consumed by runtime + timing engine.
 *
 * Strategy:
 * - strict about required fields for sporting correctness (timestamp + transponder)
 * - tolerant about optional/variant fields to keep ingestion robust across firmware variants
 */
import type { LiveTrackingRuntimePassingEvent, LiveTrackingTimingPoint } from "@raceoffice/domain";

/**
 * Minimal AMM payload shape based on bundled `tools/ammc/passing.schema.json`.
 * The parser remains tolerant because real decoders may omit optional fields.
 */
type AmmPassingPayload = {
  msg?: string;
  decoder_id?: string | null;
  passing_number?: number | null;
  request_id?: number | null;
  transponder?: number | string | null;
  tran_code?: string | null;
  rtc_time?: string | null;
};

export type AmmNormalizedPassing = {
  passing: LiveTrackingRuntimePassingEvent;
  warnings: string[];
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = new Date(value).toISOString();
  return iso === "Invalid Date" ? null : iso;
}

function normalizeTransponder(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function buildEventId(args: {
  timingPointId: string;
  decoderId: string;
  timestamp: string;
  transponderId: string;
  sequence: string;
}) {
  return `${args.timingPointId}:${args.decoderId}:${args.timestamp}:${args.transponderId}:${args.sequence}`;
}

/**
 * Normalizes one AMM payload into a deterministic passing event.
 *
 * The function is intentionally strict on required event fields
 * (timestamp + transponder), but tolerant on message kind and optional fields.
 */
export function normalizeAmmPayloadToPassing(args: {
  payload: unknown;
  timingPoint: Pick<LiveTrackingTimingPoint, "id" | "decoderId">;
}): AmmNormalizedPassing | null {
  const record = toRecord(args.payload);
  if (!record) return null;

  const payload = record as AmmPassingPayload;
  const warnings: string[] = [];

  const timestamp = normalizeTimestamp(payload.rtc_time);
  if (!timestamp) return null;

  // Real-world AMM payloads may use either `transponder` or `tran_code`.
  // We accept both and normalize to one canonical transponder id string.
  const transponderId = normalizeTransponder(payload.tran_code ?? payload.transponder);
  if (!transponderId) return null;

  const msg = typeof payload.msg === "string" ? payload.msg.trim().toLowerCase() : "";
  if (msg && msg !== "passing") {
    warnings.push(`Unexpected AMM msg type '${payload.msg}', treated as passing payload.`);
  }

  const decoderId =
    typeof payload.decoder_id === "string" && payload.decoder_id.trim()
      ? payload.decoder_id.trim()
      : args.timingPoint.decoderId;

  const sequence =
    payload.passing_number != null
      ? String(payload.passing_number)
      : payload.request_id != null
        ? String(payload.request_id)
        : "na";

  return {
    passing: {
      id: buildEventId({
        timingPointId: args.timingPoint.id,
        decoderId,
        timestamp,
        transponderId,
        sequence,
      }),
      timestamp,
      transponderId,
      timingPointId: args.timingPoint.id,
      decoderId,
    },
    warnings,
  };
}

/**
 * AMM websocket messages can be one object or arrays of objects.
 */
export function explodeAmmPayloads(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [value];
}
