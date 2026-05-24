import type { LiveTrackingRuntimePassingEvent } from "@raceoffice/domain";
import type { NormalizedPassing } from "./decoderSourceAdapter.js";

export function createPassingId(args: {
  timingPointId: string;
  decoderId: string;
  timestamp: string;
  transponderId: string;
  sequence: string;
}): string {
  return `${args.timingPointId}:${args.decoderId}:${args.timestamp}:${args.transponderId}:${args.sequence}`;
}

/** Konvertiert ein NormalizedPassing in das Domain-Typ für runtime.recentPassings. */
export function normalizedToRuntimePassing(n: NormalizedPassing): LiveTrackingRuntimePassingEvent {
  return {
    id: n.passingId,
    timestamp: n.timestamp,
    transponderId: n.transponderId,
    timingPointId: n.timingPointId,
    decoderId: n.decoderId,
    transponderType: n.transponderType,
    ...(n.passingTimeSource !== undefined ? { passingTimeSource: n.passingTimeSource } : {}),
    signalStrength: n.signalStrength,
    hits: n.hits,
    lowBattery: n.lowBattery,
    backend: n.backend,
  };
}
