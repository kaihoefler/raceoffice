/**
 * livetracking/setup
 * ------------------
 * Track and decoder setup model.
 *
 * Scope in phase 3:
 * - Define durable setup/document types.
 * - Keep timing-point ordering deterministic and gap-free.
 * - Derive absolute positions from segment distances.
 * - Provide non-throwing validation for UI/server workflows.
 */

export type LiveTrackingTimingPointRole = "start_finish" | "split";

/**
 * Decoder execution mode per timing point.
 * - `amb`: connect to a physical decoder/converter endpoint
 * - `sim`: run AMM simulator process for deterministic test passings
 */
export type LiveTrackingDecoderType = "amb" | "sim";

export type LiveTrackingTimingPoint = {

  id: string;
  name: string;
    decoderId: string;
  decoderIp: string;
  websocketPortAMM: number;

  /** Process mode for this timing point (`amb` live device vs `sim` local simulator). */
  decoderType?: LiveTrackingDecoderType;

  /** Simulator-only transponder ids (used when `decoderType === "sim"`). */
  simTranCodes?: string[];

  /** Simulator-only passing delay argument (string to support fixed/range formats). */
  simPassingDelay?: string;

    /** Simulator-only startup delay in seconds (for controlled ordering between points). */
  simStartupDelaySecs?: number;

  /**
   * Decoder-side timestamp offset in seconds.
   *
   * Domain rule:
   * - applied later by ingestion/parser layer to align decoder-local clocks
   * - positive values shift passings into the future, negative into the past
   * - default is `0` (no correction)
   */
  decoderTimestampOffsetSecs?: number;

  /** Logical order around the track (1..N). */

  order: number;

  /** Distance from the previous timing-point in meters. */
  distanceFromPreviousM: number;

  /** Derived cumulative distance from track origin in meters. */
  absolutePositionM: number;

  role: LiveTrackingTimingPointRole;
  enabled: boolean;
};

export type LiveTrackingTrack = {
  id: string;
  name: string;
  lengthM: number;
  timingPoints: LiveTrackingTimingPoint[];
};

export type LiveTrackingSetupDocument = {
  kind: "liveTrackingSetup";
  version: 1;

  /** Stable setup identity (for setup-based sessions). */
  setupId: string;

  /** Optional owning event (for event-based setup addressing). */
  eventId: string | null;

  /**
   * Setup-scoped participant pool references.
   *
   * Domain rule:
   * - contains unique, non-empty pool ids
   * - order is preserved as configured by operations
   */
    participantPoolIds?: string[];


  /**
   * Active pool id used by setup-based participant sourcing.
   *
   * Domain rule:
   * - null means "not selected yet"
   * - when set, it should reference one id from `participantPoolIds`
   */
    activeParticipantPoolId?: string | null;


  name: string;
  track: LiveTrackingTrack;
  updatedAt: string | null;
};


export type LiveTrackingSetupValidationIssue = {
  code:
    | "track_length_invalid"
    | "timing_points_missing"
    | "timing_point_order_invalid"
    | "timing_point_order_duplicate"
    | "timing_point_order_not_contiguous"
    | "timing_point_start_finish_count"
    | "timing_point_distance_invalid"
    | "timing_point_duplicate_id"
        | "timing_point_duplicate_decoder_endpoint"
    | "timing_point_absolute_position_exceeds_track_length"
    | "timing_point_decoder_time_offset_invalid";

  message: string;
  timingPointId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toFiniteInt(value: unknown, fallback = 0): number {
  return Math.floor(toFiniteNumber(value, fallback));
}

function toFiniteLocaleNumber(value: unknown, fallback = 0): number {
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
  }

  return toFiniteNumber(value, fallback);
}

// Hard safety bounds to avoid accidental multi-day shifts from malformed setup data.
const MAX_ABS_DECODER_TIMESTAMP_OFFSET_SECS = 86_400;

/**
 * Normalize decoder clock offset with millisecond precision (0.001 s).
 *
 * Domain decision:
 * - keep UX-level fine-tuning (e.g. 1.234 s)
 * - clamp to a safe absolute range to avoid accidental multi-day shifts
 */
function normalizeDecoderTimestampOffsetSecs(value: unknown): number {
  const raw = toFiniteLocaleNumber(value, 0);
  const clamped = Math.max(-MAX_ABS_DECODER_TIMESTAMP_OFFSET_SECS, Math.min(MAX_ABS_DECODER_TIMESTAMP_OFFSET_SECS, raw));
  return Math.round(clamped * 1000) / 1000;
}

function sortTimingPointsByOrder(points: LiveTrackingTimingPoint[]): LiveTrackingTimingPoint[] {

  const list = Array.isArray(points) ? [...points] : [];
  list.sort((a, b) => toFiniteInt(a.order, 0) - toFiniteInt(b.order, 0));
  return list;
}

function normalizeParticipantPoolIds(poolIds: unknown): string[] {
  const unique = new Set<string>();
  for (const raw of Array.isArray(poolIds) ? poolIds : []) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    unique.add(id);
  }
  return [...unique];
}

export function createLiveTrackingSetupDocument(args?: {
  setupId?: string;
  eventId?: string | null;
  participantPoolIds?: string[];
  activeParticipantPoolId?: string | null;
  name?: string;
}): LiveTrackingSetupDocument {
  const participantPoolIds = normalizeParticipantPoolIds(args?.participantPoolIds);
  const requestedActiveId = args?.activeParticipantPoolId == null ? null : String(args.activeParticipantPoolId).trim();
  const activeParticipantPoolId = requestedActiveId && participantPoolIds.includes(requestedActiveId) ? requestedActiveId : null;

  return {
    kind: "liveTrackingSetup",
    version: 1,
    setupId: String(args?.setupId ?? "").trim(),
    eventId: args?.eventId == null ? null : String(args.eventId).trim(),
    participantPoolIds,
    activeParticipantPoolId,
    name: String(args?.name ?? "").trim(),
    track: {
      id: "",
      name: "",
      lengthM: 0,
      timingPoints: [],
    },
    updatedAt: null,
  };
}


/**
 * Returns timing-points sorted by `order` with recalculated `absolutePositionM`.
 *
 * Core domain rule:
 * - `absolutePositionM` is always derived from `distanceFromPreviousM`.
 * - provided `absolutePositionM` inputs are ignored intentionally.
 */
export function normalizeTimingPoints(points: LiveTrackingTimingPoint[]): LiveTrackingTimingPoint[] {
  const sorted = sortTimingPointsByOrder(points);

  let absolute = 0;
  return sorted.map((point, index) => {
    const distance = index === 0 ? 0 : Math.max(0, toFiniteNumber(point.distanceFromPreviousM, 0));
    absolute += distance;

    return {
      ...point,
      order: index + 1,
      distanceFromPreviousM: distance,
      absolutePositionM: absolute,
            websocketPortAMM: Math.max(0, toFiniteInt(point.websocketPortAMM, 0)),
      decoderType: point.decoderType === "sim" ? "sim" : "amb",
      simTranCodes: Array.isArray(point.simTranCodes)
        ? point.simTranCodes.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [],
            simPassingDelay: String(point.simPassingDelay ?? "1000").trim() || "1000",
      simStartupDelaySecs: Math.max(0, toFiniteInt(point.simStartupDelaySecs, 0)),
            decoderTimestampOffsetSecs: normalizeDecoderTimestampOffsetSecs(point.decoderTimestampOffsetSecs),

      enabled: Boolean(point.enabled),


    };
  });
}

export function validateLiveTrackingTrack(track: LiveTrackingTrack): LiveTrackingSetupValidationIssue[] {
  const issues: LiveTrackingSetupValidationIssue[] = [];

  if (!Number.isFinite(track.lengthM) || track.lengthM <= 0) {
    issues.push({
      code: "track_length_invalid",
      message: "Track length must be a positive number.",
    });
  }

  const rawPoints = Array.isArray(track.timingPoints) ? track.timingPoints : [];
  if (rawPoints.length === 0) {
    issues.push({
      code: "timing_points_missing",
      message: "At least one timing point is required.",
    });
    return issues;
  }

  const ids = new Set<string>();
  const decoderEndpoints = new Set<string>();
  const orders: number[] = [];

  for (const point of rawPoints) {
    const id = String(point.id ?? "").trim();
    if (id) {
      if (ids.has(id)) {
        issues.push({
          code: "timing_point_duplicate_id",
          message: "Timing-point ids must be unique.",
          timingPointId: id,
        });
      }
      ids.add(id);
    }

    const endpoint = `${String(point.decoderIp ?? "").trim()}:${toFiniteInt(point.websocketPortAMM, -1)}`;
    if (endpoint !== ":-1") {
      if (decoderEndpoints.has(endpoint)) {
        issues.push({
          code: "timing_point_duplicate_decoder_endpoint",
          message: "Each timing point should use a unique decoder endpoint (ip:port).",
          timingPointId: id || undefined,
        });
      }
      decoderEndpoints.add(endpoint);
    }

        const order = toFiniteInt(point.order, 0);
    orders.push(order);
    if (order < 1) {
      issues.push({
        code: "timing_point_order_invalid",
        message: "Timing-point order must be an integer >= 1.",
        timingPointId: id || undefined,
      });
    }

        const rawOffsetSecs = point.decoderTimestampOffsetSecs;
    if (rawOffsetSecs !== undefined) {
      const offsetSecs = toFiniteLocaleNumber(rawOffsetSecs, Number.NaN);
      if (!Number.isFinite(offsetSecs) || Math.abs(offsetSecs) > MAX_ABS_DECODER_TIMESTAMP_OFFSET_SECS) {
        issues.push({
          code: "timing_point_decoder_time_offset_invalid",
          message: `Decoder time offset must be a finite number between -${MAX_ABS_DECODER_TIMESTAMP_OFFSET_SECS} and +${MAX_ABS_DECODER_TIMESTAMP_OFFSET_SECS} seconds.`,
          timingPointId: id || undefined,
        });
      }
    }


  }

  const validOrders = orders.filter((x) => x >= 1).sort((a, b) => a - b);
  for (let i = 1; i < validOrders.length; i += 1) {
    if (validOrders[i] === validOrders[i - 1]) {
      issues.push({
        code: "timing_point_order_duplicate",
        message: "Timing-point order values must be unique.",
      });
      break;
    }
  }

  if (validOrders.length > 0) {
    for (let expected = 1; expected <= validOrders.length; expected += 1) {
      if (validOrders[expected - 1] !== expected) {
        issues.push({
          code: "timing_point_order_not_contiguous",
          message: "Timing-point order must be contiguous and start at 1.",
        });
        break;
      }
    }
  }

  const normalized = normalizeTimingPoints(rawPoints);

  const sfCount = normalized.filter((p) => p.role === "start_finish" && p.enabled).length;
  if (sfCount !== 1) {
    issues.push({
      code: "timing_point_start_finish_count",
      message: "Exactly one enabled start/finish timing point is required.",
    });
  }

  normalized.forEach((point, index) => {
    const isFirst = index === 0;
    const distanceOk = isFirst ? point.distanceFromPreviousM === 0 : point.distanceFromPreviousM > 0;

    if (!distanceOk) {
      issues.push({
        code: "timing_point_distance_invalid",
        message: "First timing point must have 0 distance; all following points must have distance > 0.",
        timingPointId: point.id,
      });
    }

    if (Number.isFinite(track.lengthM) && track.lengthM > 0 && point.absolutePositionM > track.lengthM) {
      issues.push({
        code: "timing_point_absolute_position_exceeds_track_length",
        message: "Timing-point absolute position cannot exceed track length.",
        timingPointId: point.id,
      });
    }
  });

  return issues;
}

export function isLiveTrackingTimingPoint(value: unknown): value is LiveTrackingTimingPoint {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.decoderId === "string" &&
    typeof value.decoderIp === "string" &&
        typeof value.websocketPortAMM === "number" &&
    (value.decoderType === undefined || value.decoderType === "amb" || value.decoderType === "sim") &&
    (value.simTranCodes === undefined || (Array.isArray(value.simTranCodes) && value.simTranCodes.every((x) => typeof x === "string"))) &&
        (value.simPassingDelay === undefined || typeof value.simPassingDelay === "string") &&
    (value.simStartupDelaySecs === undefined || typeof value.simStartupDelaySecs === "number") &&
    (value.decoderTimestampOffsetSecs === undefined || typeof value.decoderTimestampOffsetSecs === "number") &&
    typeof value.order === "number" &&


    typeof value.distanceFromPreviousM === "number" &&
    typeof value.absolutePositionM === "number" &&
    (value.role === "start_finish" || value.role === "split") &&
    typeof value.enabled === "boolean"
  );
}

export function isLiveTrackingTrack(value: unknown): value is LiveTrackingTrack {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.lengthM === "number" &&
    Array.isArray(value.timingPoints) &&
    value.timingPoints.every(isLiveTrackingTimingPoint)
  );
}

export function isLiveTrackingSetupDocument(value: unknown): value is LiveTrackingSetupDocument {
  if (!isRecord(value)) return false;

  return (
    value.kind === "liveTrackingSetup" &&
    value.version === 1 &&
    typeof value.setupId === "string" &&
    (typeof value.eventId === "string" || value.eventId === null) &&
        (value.participantPoolIds === undefined ||
      (Array.isArray(value.participantPoolIds) && value.participantPoolIds.every((x) => typeof x === "string"))) &&
    (value.activeParticipantPoolId === undefined ||
      typeof value.activeParticipantPoolId === "string" ||
      value.activeParticipantPoolId === null) &&

    typeof value.name === "string" &&
    isLiveTrackingTrack(value.track) &&
    (typeof value.updatedAt === "string" || value.updatedAt === null)
  );
}

