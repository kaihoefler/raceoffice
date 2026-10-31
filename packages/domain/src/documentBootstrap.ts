/**
 * documentBootstrap
 * -----------------
 * Initial content of a realtime document that has never been written.
 *
 * The server persists this at rev 0 on first access (apps/server, DocStore.loadDoc), so all
 * clients start from the same state. The in-memory fake server for frontend component tests
 * uses the same rule, so pages see the same defaults in tests as in production.
 *
 * - `eventList`: the core entry document (no events, none active)
 * - known LiveTracking ids: their typed domain defaults (createInitialLiveTrackingDocument)
 * - timing layer singletons (timingDecoders, timingConnection, timingStatus)
 * - any other id: an empty object (backward compatibility)
 */

import { createInitialLiveTrackingDocument } from "./livetracking/index.js";
import { createInitialTimingDocument } from "./timing/index.js";

export function initialDocumentData(docId: string): unknown {
  if (docId === "eventList") return { activeEventId: null, events: [] };
  return createInitialLiveTrackingDocument(docId) ?? createInitialTimingDocument(docId) ?? {};
}
