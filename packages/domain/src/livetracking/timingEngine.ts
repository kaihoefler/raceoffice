/**
 * livetracking/timingEngine
 * -------------------------
 * Pure timing projection engine from normalized passing events to live results.
 *
 * Domain rules covered here:
 * - debounce filtering (duplicate passings at same timing-point)
 * - sequence validation based on ordered timing-points
 * - minimum sector/lap plausibility times
 * - unknown transponder handling
 * - split/last/best-lap derivation
 * - activity status derivation
 */

import type { LiveTrackingAthlete } from "./participantPool.js";
import { normalizeTimingPoints, type LiveTrackingTrack } from "./setup.js";
import {
  createLiveTrackingResultsDocument,
  type LiveTrackingActivityStatus,
  type LiveTrackingAthleteLiveState,
  type LiveTrackingCurrentSplit,
  type LiveTrackingPassingEvent,
  type LiveTrackingResultsDocument,
} from "./results.js";

/**
 * Tuning knobs for projection strictness and output window sizes.
 *
 * Practical guidance:
 * - debounce/minSector/minLap define sporting plausibility filters
 * - keep* values define memory/UI windows (not persistence limits)
 * - synthesizeUnknownTransponders helps operations by still showing unknown chips live
 */
export type LiveTrackingTimingEngineOptions = {
  debounceMs: number;
  minSectorTimeMs: number;
  minLapTimeMs: number;
  activityWindowMs: number;
  keepRecentPassings: number;
  keepRecentLapTimes: number;
  keepCompletedLaps: number;
  keepInvalidEvents: number;
  synthesizeUnknownTransponders: boolean;
};

export const DEFAULT_LIVE_TRACKING_TIMING_ENGINE_OPTIONS: LiveTrackingTimingEngineOptions = {
  debounceMs: 1_000,
  minSectorTimeMs: 500,
  minLapTimeMs: 10_000,
  activityWindowMs: 20_000,
  keepRecentPassings: 300,
  keepRecentLapTimes: 10,
  keepCompletedLaps: 30,
  keepInvalidEvents: 100,
  synthesizeUnknownTransponders: true,
};

/**
 * Internal state machine per athlete while consuming ordered passings.
 *
 * Note:
 * This shape is intentionally not exported. It is an implementation detail used
 * to derive stable public read-model fields in `LiveTrackingResultsDocument`.
 */
type InternalAthleteState = {
  athleteId: string;
  transponderId: string | null;
  lastPassingAt: string | null;
  lastPassingMs: number | null;
  expectedOrder: number | null;
  lapStartedAtMs: number | null;
  lastAcceptedAtMs: number | null;
  lastAcceptedByPointMs: Map<string, number>;
  currentLapSplits: LiveTrackingCurrentSplit[];
  completedLaps: Array<{ lapNumber: number; lapTimeMs: number; valid: boolean; completedAt: string }>;
  recentLapTimesMs: number[];
};

function toMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ensures deterministic processing order.
 *
 * Stable tie-break by id is important for reproducible projections when two
 * passings share identical timestamps.
 */
function sortPassingsStable(passings: LiveTrackingPassingEvent[]): LiveTrackingPassingEvent[] {
  return [...passings].sort((a, b) => {
    const ta = toMs(a.timestamp) ?? 0;
    const tb = toMs(b.timestamp) ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function appendBounded<T>(list: T[], value: T, max: number): T[] {
  const next = [...list, value];
  return next.length > max ? next.slice(next.length - max) : next;
}

function activityStatus(lastPassingMs: number | null, generatedAtMs: number, windowMs: number): LiveTrackingActivityStatus {
  if (lastPassingMs === null) return "inactive";
  return generatedAtMs - lastPassingMs <= windowMs ? "active" : "inactive";
}

/**
 * Computes a deterministic live results projection.
 */
export function buildLiveTrackingResultsProjection(args: {
  passings: LiveTrackingPassingEvent[];
  track: LiveTrackingTrack;
  athletes: LiveTrackingAthlete[];
  generatedAt?: string;
  warnings?: string[];
  options?: Partial<LiveTrackingTimingEngineOptions>;
}): LiveTrackingResultsDocument {
  const options: LiveTrackingTimingEngineOptions = {
    ...DEFAULT_LIVE_TRACKING_TIMING_ENGINE_OPTIONS,
    ...(args.options ?? {}),
  };

  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const generatedAtMs = toMs(generatedAt) ?? Date.now();

  const doc = createLiveTrackingResultsDocument();
  doc.generatedAt = generatedAt;
  doc.warnings = [...(args.warnings ?? [])];

  const points = normalizeTimingPoints(args.track.timingPoints).filter((p) => p.enabled);
  const pointById = new Map(points.map((p) => [p.id, p]));
  const maxOrder = points.reduce((max, p) => Math.max(max, p.order), 0);

  const startFinish = points.find((p) => p.role === "start_finish") ?? null;
  if (!startFinish) {
    doc.warnings.push("No enabled start_finish timing point in setup track.");
  }

  const athleteById = new Map<string, LiveTrackingAthlete>(args.athletes.map((athlete) => [athlete.id, athlete]));
  const transponderToAthlete = new Map<string, { athleteId: string; transponderId: string }>();
  for (const athlete of args.athletes) {
    for (const raw of athlete.transponderIds) {
      const transponderId = String(raw ?? "").trim();
      if (!transponderId) continue;

      if (transponderToAthlete.has(transponderId)) {
        doc.warnings.push(`Duplicate transponder mapping detected: ${transponderId}`);
        continue;
      }

      transponderToAthlete.set(transponderId, { athleteId: athlete.id, transponderId });
    }
  }

  const stateByAthlete = new Map<string, InternalAthleteState>();

  function ensureState(athleteId: string, transponderId: string): InternalAthleteState {
    const existing = stateByAthlete.get(athleteId);
    if (existing) return existing;

    const created: InternalAthleteState = {
      athleteId,
      transponderId,
      lastPassingAt: null,
      lastPassingMs: null,
      expectedOrder: null,
      lapStartedAtMs: null,
      lastAcceptedAtMs: null,
      lastAcceptedByPointMs: new Map(),
      currentLapSplits: [],
      completedLaps: [],
      recentLapTimesMs: [],
    };
    stateByAthlete.set(athleteId, created);
    return created;
  }

  const unknownTransponders = new Set<string>();
  const acceptedPassings: LiveTrackingPassingEvent[] = [];

  // Core acceptance pipeline: validate -> map transponder -> plausibility checks -> apply.
  for (const passing of sortPassingsStable(args.passings)) {
    const eventMs = toMs(passing.timestamp);
    if (eventMs === null) {
      doc.invalidEvents = appendBounded(doc.invalidEvents, {
        passingEventId: passing.id,
        reason: "invalid_timestamp",
      }, options.keepInvalidEvents);
      continue;
    }

    const point = pointById.get(passing.timingPointId);
    if (!point) {
      doc.invalidEvents = appendBounded(doc.invalidEvents, {
        passingEventId: passing.id,
        reason: "unknown_timing_point",
      }, options.keepInvalidEvents);
      continue;
    }

    let participant = transponderToAthlete.get(passing.transponderId);
    if (!participant) {
      unknownTransponders.add(passing.transponderId);

      // Strict mode: unknown chips are rejected and tracked as invalid events.
      if (!options.synthesizeUnknownTransponders) {
        doc.invalidEvents = appendBounded(
          doc.invalidEvents,
          {
            passingEventId: passing.id,
            reason: "unknown_transponder",
          },
          options.keepInvalidEvents,
        );
        continue;
      }

      // Ops-friendly mode: create synthetic live athlete so unknown chips remain visible.
      const syntheticAthleteId = `unknown:transponder:${passing.transponderId}`;
      if (!athleteById.has(syntheticAthleteId)) {
        athleteById.set(syntheticAthleteId, {
          id: syntheticAthleteId,
          bib: null,
          firstName: "",
          lastName: passing.transponderId,
          nation: null,
          ageGroupId: null,
          transponderIds: [passing.transponderId],
        });
      }

      participant = {
        athleteId: syntheticAthleteId,
        transponderId: passing.transponderId,
      };
      transponderToAthlete.set(passing.transponderId, participant);
    }

    const athlete = ensureState(participant.athleteId, participant.transponderId);

    const lastAtPointMs = athlete.lastAcceptedByPointMs.get(point.id) ?? null;
    if (lastAtPointMs !== null && eventMs - lastAtPointMs < options.debounceMs) {
      doc.invalidEvents = appendBounded(doc.invalidEvents, {
        passingEventId: passing.id,
        reason: "debounce",
      }, options.keepInvalidEvents);
      continue;
    }

    if (athlete.expectedOrder !== null && point.order !== athlete.expectedOrder) {
      doc.invalidEvents = appendBounded(doc.invalidEvents, {
        passingEventId: passing.id,
        reason: "sequence",
      }, options.keepInvalidEvents);
      continue;
    }

    if (athlete.lastAcceptedAtMs !== null && eventMs - athlete.lastAcceptedAtMs < options.minSectorTimeMs) {
      doc.invalidEvents = appendBounded(doc.invalidEvents, {
        passingEventId: passing.id,
        reason: "min_sector_time",
      }, options.keepInvalidEvents);
      continue;
    }

    athlete.lastPassingAt = passing.timestamp;
    athlete.lastPassingMs = eventMs;
    athlete.lastAcceptedAtMs = eventMs;
    athlete.lastAcceptedByPointMs.set(point.id, eventMs);

    const nextOrder = maxOrder > 0 ? (point.order >= maxOrder ? 1 : point.order + 1) : null;
    athlete.expectedOrder = nextOrder;

    // Lap boundary handling is anchored on start/finish timing point.
    if (startFinish && point.id === startFinish.id) {
      if (athlete.lapStartedAtMs !== null) {
        const lapTimeMs = eventMs - athlete.lapStartedAtMs;
        if (lapTimeMs < options.minLapTimeMs) {
          doc.invalidEvents = appendBounded(doc.invalidEvents, {
            passingEventId: passing.id,
            reason: "min_lap_time",
          }, options.keepInvalidEvents);
          continue;
        }

        const lapNumber = athlete.completedLaps.length + 1;
        athlete.completedLaps = appendBounded(
          athlete.completedLaps,
          {
            lapNumber,
            lapTimeMs,
            valid: true,
            completedAt: passing.timestamp,
          },
          options.keepCompletedLaps,
        );
        athlete.recentLapTimesMs = appendBounded(athlete.recentLapTimesMs, lapTimeMs, options.keepRecentLapTimes);
      }

      athlete.lapStartedAtMs = eventMs;
      athlete.currentLapSplits = [];
    } else if (athlete.lapStartedAtMs !== null) {
      const splitTimeMs = eventMs - athlete.lapStartedAtMs;
      if (splitTimeMs >= options.minSectorTimeMs) {
        const existingIndex = athlete.currentLapSplits.findIndex((s) => s.timingPointId === point.id);
        const split: LiveTrackingCurrentSplit = {
          timingPointId: point.id,
          splitTimeMs,
        };

        if (existingIndex >= 0) {
          athlete.currentLapSplits = athlete.currentLapSplits.map((s, idx) => (idx === existingIndex ? split : s));
        } else {
          athlete.currentLapSplits = [...athlete.currentLapSplits, split];
        }
      }
    }

    acceptedPassings.push(passing);
  }

  const athleteStates: LiveTrackingAthleteLiveState[] = [];
  for (const athlete of athleteById.values()) {
    const state = stateByAthlete.get(athlete.id);
    const recentLapTimes = state?.recentLapTimesMs ?? [];
    const bestLap = recentLapTimes.length ? Math.min(...recentLapTimes) : null;
    const lastLap = recentLapTimes.length ? recentLapTimes[recentLapTimes.length - 1] : null;
    const status = activityStatus(state?.lastPassingMs ?? null, generatedAtMs, options.activityWindowMs);

    athleteStates.push({
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      transponderId: state?.transponderId ?? athlete.transponderIds[0] ?? null,
      activityStatus: status,
      isActive: status === "active",
      lastPassingAt: state?.lastPassingAt ?? null,
      lapsCompleted: state?.completedLaps.length ?? 0,
      currentLapSplits: [...(state?.currentLapSplits ?? [])],
      recentLapTimesMs: [...recentLapTimes],
      completedLaps: [...(state?.completedLaps ?? [])],
      lastLapTimeMs: lastLap,
      bestLapTimeMs: bestLap,
    });
  }

  // Final projection assembly: athlete board + qualifying ranking + debug channels.
  doc.athleteLiveStates = athleteStates;
  doc.qualifyingRanking = athleteStates
    .filter((s) => typeof s.bestLapTimeMs === "number")
    .sort((a, b) => (a.bestLapTimeMs as number) - (b.bestLapTimeMs as number))
    .map((state, index) => ({
      athleteId: state.athleteId,
      bestLapTimeMs: state.bestLapTimeMs as number,
      rank: index + 1,
    }));

  doc.recentPassings = acceptedPassings.slice(-options.keepRecentPassings);
  doc.unknownTransponders = [...unknownTransponders];

  return doc;
}
