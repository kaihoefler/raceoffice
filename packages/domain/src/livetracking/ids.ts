/**
 * livetracking/ids
 * ----------------
 * Central helpers for LiveTracking document-id conventions.
 *
 * Why this module exists:
 * - Keep doc-id naming in one place so frontend/server/worker never diverge.
 * - Provide lightweight parsing for server bootstrap and routing logic.
 */

export const LIVE_TRACKING_DOC_PREFIX = "liveTracking" as const;

export type LiveTrackingDocKind = "participants" | "setup" | "session" | "runtime" | "results";

export type LiveTrackingDocRef =
  | { kind: "participants"; eventId: string }
  | { kind: "setup"; setupRef: string }
  | { kind: "session"; sessionId: string }
  | { kind: "runtime"; sessionId: string }
  | { kind: "results"; sessionId: string };

function cleanId(value: string): string {
  return String(value ?? "").trim();
}

/**
 * Primary helper for the event-level participant pool document.
 */
export function makeLiveTrackingParticipantPoolDocId(eventId: string): string {
  return `${LIVE_TRACKING_DOC_PREFIX}Participants:${cleanId(eventId)}`;
}

/**
 * Setup supports event-based and setup-based addressing:
 * - liveTrackingSetup:{eventId}
 * - liveTrackingSetup:{setupId}
 */
export function makeLiveTrackingSetupDocId(setupRef: string): string {
  return `${LIVE_TRACKING_DOC_PREFIX}Setup:${cleanId(setupRef)}`;
}

/**
 * Session/runtime/results are singleton docs by domain rule:
 * there is exactly one active live-tracking session at a time.
 *
 * Document ids themselves no longer carry a `:sessionId` suffix.
 */
export function makeLiveTrackingSessionDocId(_sessionId?: string): string {
  return `${LIVE_TRACKING_DOC_PREFIX}Session`;
}

export function makeLiveTrackingRuntimeDocId(_sessionId?: string): string {
  return `${LIVE_TRACKING_DOC_PREFIX}Runtime`;
}

export function makeLiveTrackingResultsDocId(_sessionId?: string): string {
  return `${LIVE_TRACKING_DOC_PREFIX}Results`;
}

/**
 * Parses a doc-id into a typed reference.
 * Returns null for non-livetracking ids.
 */
export function parseLiveTrackingDocId(docId: string): LiveTrackingDocRef | null {
  const raw = String(docId ?? "").trim();
  if (!raw) return null;

  // Singleton ids without suffix
  if (raw === `${LIVE_TRACKING_DOC_PREFIX}Session`) {
    return { kind: "session", sessionId: "" };
  }
  if (raw === `${LIVE_TRACKING_DOC_PREFIX}Runtime`) {
    return { kind: "runtime", sessionId: "" };
  }
  if (raw === `${LIVE_TRACKING_DOC_PREFIX}Results`) {
    return { kind: "results", sessionId: "" };
  }

  // Legacy ids with suffix are still accepted for backward compatibility.
  const splitAt = raw.indexOf(":");
  if (splitAt <= 0) return null;

  const head = raw.slice(0, splitAt);
  const tail = raw.slice(splitAt + 1).trim();
  if (!tail) return null;

  if (head === `${LIVE_TRACKING_DOC_PREFIX}Participants`) return { kind: "participants", eventId: tail };
  if (head === `${LIVE_TRACKING_DOC_PREFIX}Setup`) return { kind: "setup", setupRef: tail };
  if (head === `${LIVE_TRACKING_DOC_PREFIX}Session`) return { kind: "session", sessionId: tail };
  if (head === `${LIVE_TRACKING_DOC_PREFIX}Runtime`) return { kind: "runtime", sessionId: tail };
  if (head === `${LIVE_TRACKING_DOC_PREFIX}Results`) return { kind: "results", sessionId: tail };

  return null;
}
