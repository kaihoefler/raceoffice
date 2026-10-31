/**
 * timing/setupMapping
 * -------------------
 * Consumer side of the timing layer: turns passings of physical decoders into passings at the
 * timing points of a setup (doc/timing-architecture.md, section 3).
 *
 * - Only enabled timing points; a decoder used by two points yields a passing at each.
 * - The clock offset comes from the decoder register (applied when reading). For a decoder
 *   that is not registered (old setup) the offset stored in the timing point is used.
 * - Decoder signals (`signalKind`, e.g. start signal) are skipped: they are no athlete passings.
 */
import type { LiveTrackingPassingEvent } from "../livetracking/results.js";
import { normalizeTimingPoints, type LiveTrackingSetupDocument } from "../livetracking/setup.js";
import { applyTimingClockOffset, findTimingDecoder, type TimingDecodersDocument } from "./decoders.js";
import { resolveTimingPointDecoderId } from "./legacySetup.js";
import type { TimingPassing } from "./passing.js";

/** Decoder ids of the enabled timing points of a setup. */
export function getSetupDecoderIds(setup: LiveTrackingSetupDocument): string[] {
  const ids = normalizeTimingPoints(setup.track.timingPoints)
    .filter((p) => p.enabled)
    .map((p) => resolveTimingPointDecoderId(p, setup.decoderBackend));
  return [...new Set(ids)];
}

export function toTimingPointPassings(
  passings: readonly TimingPassing[],
  setup: LiveTrackingSetupDocument,
  decoders: TimingDecodersDocument | null,
): LiveTrackingPassingEvent[] {
  const pointsByDecoder = new Map<string, Array<{ id: string; offsetSecs: number }>>();
  for (const point of normalizeTimingPoints(setup.track.timingPoints)) {
    if (!point.enabled) continue;
    const decoderId = resolveTimingPointDecoderId(point, setup.decoderBackend);
    const registered = findTimingDecoder(decoders, decoderId);
    const offsetSecs = registered ? registered.clockOffsetSecs : Number(point.decoderTimestampOffsetSecs ?? 0) || 0;
    const list = pointsByDecoder.get(decoderId) ?? [];
    list.push({ id: point.id, offsetSecs });
    pointsByDecoder.set(decoderId, list);
  }

  const result: LiveTrackingPassingEvent[] = [];
  for (const passing of passings) {
    if (passing.signalKind) continue;
    for (const point of pointsByDecoder.get(passing.decoderId) ?? []) {
      result.push({
        id: `${point.id}:${passing.id}`,
        timestamp: applyTimingClockOffset(passing.decoderTime, point.offsetSecs),
        transponderId: passing.transponderId,
        timingPointId: point.id,
        decoderId: passing.decoderId,
      });
    }
  }
  return result;
}
