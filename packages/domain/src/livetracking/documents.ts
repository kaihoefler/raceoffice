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
  const parsed = parseLiveTrackingDocId(docId);
  if (!parsed) return null;

  if (parsed.kind === "participants") return createLiveTrackingParticipantPoolDocument(parsed.eventId);

  if (parsed.kind === "setup") {
    return createLiveTrackingSetupDocument({
      setupId: parsed.setupRef,
      eventId: null,
      name: "",
    });
  }

  if (parsed.kind === "session") {
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

export function isLiveTrackingDocument(value: unknown): value is LiveTrackingDocument {
  return (
    isLiveTrackingParticipantPoolDocument(value) ||
    isLiveTrackingSetupDocument(value) ||
    isLiveTrackingSessionDocument(value) ||
    isLiveTrackingRuntimeDocument(value) ||
    isLiveTrackingResultsDocument(value)
  );
}
