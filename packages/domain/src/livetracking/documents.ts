/**
 * livetracking/documents
 * ----------------------
 * Aggregated document helpers for LiveTracking.
 *
 * This file keeps bootstrap/default creation logic centralized so server code can
 * ask the domain package for initial document state without duplicating rules.
 */

import { parseLiveTrackingDocId } from "./ids.js";
import {
  createLiveTrackingParticipantPoolDocument,
  isLiveTrackingParticipantPoolDocument,
  type LiveTrackingParticipantPoolDocument,
} from "./participantPool.js";
import {
  createLiveTrackingSetupDocument,
  isLiveTrackingSetupDocument,
  type LiveTrackingSetupDocument,
} from "./setup.js";
import {
  createLiveTrackingSessionDocument,
  isLiveTrackingSessionDocument,
  type LiveTrackingSessionDocument,
} from "./session.js";
import {
  createLiveTrackingRuntimeDocument,
  isLiveTrackingRuntimeDocument,
  type LiveTrackingRuntimeDocument,
} from "./runtime.js";
import {
  createLiveTrackingResultsDocument,
  isLiveTrackingResultsDocument,
  type LiveTrackingResultsDocument,
} from "./results.js";

/**
 * Union of all known LiveTracking document payloads.
 *
 * This is useful for bootstrap/read-path code that handles document ids first
 * and concrete payload types second.
 */
export type LiveTrackingDocument =
  | LiveTrackingParticipantPoolDocument
  | LiveTrackingSetupDocument
  | LiveTrackingSessionDocument
  | LiveTrackingRuntimeDocument
  | LiveTrackingResultsDocument;

/**
 * Creates default data for a known LiveTracking doc-id.
 * Returns null for non-LiveTracking doc ids.
 */
export function createInitialLiveTrackingDocument(docId: string): LiveTrackingDocument | null {
  // Resolve by id convention first; unknown ids are intentionally ignored here.
  const parsed = parseLiveTrackingDocId(docId);
  if (!parsed) return null;

    if (parsed.kind === "participants") {
    // Backward compatibility choice:
    // - When only doc-id suffix is known, we use it as pool identity.
    // - We also mirror it into `eventId` so legacy event-scoped flows keep working.
    return createLiveTrackingParticipantPoolDocument({
      poolId: parsed.poolRef,
      eventId: parsed.poolRef,
      setupId: null,
      name: "",
    });
  }


  if (parsed.kind === "setup") {
    return createLiveTrackingSetupDocument({
      setupId: parsed.setupRef,
      eventId: null,
      name: "",
    });
  }

  if (parsed.kind === "session") {
    // Session starts in idle/training with empty setup references.
    return createLiveTrackingSessionDocument({
      setupId: "",
      eventId: "",
      mode: "training",
    });
  }

  if (parsed.kind === "runtime") return createLiveTrackingRuntimeDocument();
  if (parsed.kind === "results") return createLiveTrackingResultsDocument();

  return null;
}

/**
 * Runtime type guard for dynamic document payloads.
 */
export function isLiveTrackingDocument(value: unknown): value is LiveTrackingDocument {
  return (
    isLiveTrackingParticipantPoolDocument(value) ||
    isLiveTrackingSetupDocument(value) ||
    isLiveTrackingSessionDocument(value) ||
    isLiveTrackingRuntimeDocument(value) ||
    isLiveTrackingResultsDocument(value)
  );
}
