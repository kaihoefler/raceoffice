/**
 * livetracking/passingHistory
 * ---------------------------
 * Complete, append-only list of athlete passings of the current session.
 *
 * Why a separate document:
 * - `runtime.recentPassings` is a small rolling window for the passing log. With large
 *   fields it holds only a few seconds of passings, so projecting results from it loses
 *   laps and corrupts the ranking.
 * - The timing engine recomputes results from scratch, so it needs every passing of the
 *   session. Keeping them in a persisted document also survives worker restarts.
 *
 * Write rules:
 * - Only the worker appends (in batches, to keep the number of full-document writes low).
 * - Clients only clear it on reset, together with the runtime buffers.
 * - Decoder signals (`signalKind`) are not stored here; they are irrelevant for results.
 */

import { isLiveTrackingPassingEvent, type LiveTrackingPassingEvent } from "./results.js";

export type LiveTrackingPassingHistoryDocument = {
  kind: "liveTrackingPassingHistory";
  version: 1;
  /** Oldest first. */
  passings: LiveTrackingPassingEvent[];
  updatedAt: string | null;
};

export function createLiveTrackingPassingHistoryDocument(): LiveTrackingPassingHistoryDocument {
  return {
    kind: "liveTrackingPassingHistory",
    version: 1,
    passings: [],
    updatedAt: null,
  };
}

export function isLiveTrackingPassingHistoryDocument(value: unknown): value is LiveTrackingPassingHistoryDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;

  return (
    doc.kind === "liveTrackingPassingHistory" &&
    doc.version === 1 &&
    Array.isArray(doc.passings) &&
    doc.passings.every(isLiveTrackingPassingEvent) &&
    (typeof doc.updatedAt === "string" || doc.updatedAt === null)
  );
}
