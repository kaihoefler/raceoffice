/**
 * timing
 * ------
 * Timing layer of the layered timing architecture (doc/timing-architecture.md): decoder
 * register, connection control, decoder status and passings – independent of LiveTracking and
 * any other consumer.
 */
import { createTimingConnectionDocument } from "./connection.js";
import { createTimingDecodersDocument } from "./decoders.js";
import { createTimingSimulatorDocument } from "./simulator.js";
import { createTimingStatusDocument } from "./status.js";

export * from "./connection.js";
export * from "./decoders.js";
export * from "./legacySetup.js";
export * from "./passing.js";
export * from "./setupMapping.js";
export * from "./simulator.js";
export * from "./status.js";

/** Singleton realtime documents of the timing layer. */
export const TIMING_DECODERS_DOC_ID = "timingDecoders";
export const TIMING_CONNECTION_DOC_ID = "timingConnection";
export const TIMING_STATUS_DOC_ID = "timingStatus";
export const TIMING_SIMULATOR_DOC_ID = "timingSimulator";

/** Initial content for a timing document id, or null for other ids. */
export function createInitialTimingDocument(docId: string): unknown {
  if (docId === TIMING_DECODERS_DOC_ID) return createTimingDecodersDocument();
  if (docId === TIMING_CONNECTION_DOC_ID) return createTimingConnectionDocument();
  if (docId === TIMING_STATUS_DOC_ID) return createTimingStatusDocument();
  if (docId === TIMING_SIMULATOR_DOC_ID) return createTimingSimulatorDocument();
  return null;
}
