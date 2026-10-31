/**
 * timing/status
 * -------------
 * Live state of the physical decoders, written only by the timing worker.
 *
 * Kept apart from the register (operator-edited configuration) so frequent status writes never
 * conflict with configuration changes.
 */

import type { TimingSimulatorStatus } from "./simulator.js";

export type TimingDecoderConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** Why the worker holds a connection (phase 1: explicit wish or a running LiveTracking session). */
export type TimingConnectionReason = "explicit" | "livetracking";

export type TimingDecoderHardwareInfo = {
  hardwareId: string;
  decoderType: string | null;
  firmwareVersion: string | null;
};

/** Device status as far as the protocol reports it (P3 STATUS record). */
export type TimingDecoderDeviceStatus = {
  noise: number | null;
  gpsLocked: boolean | null;
  temperatureC: number | null;
  voltage: number | null;
  at: string;
};

export type TimingDecoderStatus = {
  decoderId: string;
  connection: TimingDecoderConnectionState;
  reasons: TimingConnectionReason[];
  /** Start of the current connection session (passings carry its id). */
  connectionSessionId: string | null;
  connectedSince: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
  /** Passings received in the current connection session. */
  passingCount: number;
  hardware: TimingDecoderHardwareInfo | null;
  device: TimingDecoderDeviceStatus | null;
  /**
   * Lost passings requested again from the decoder (P3 RESEND) in this worker run:
   * requested, recovered, and still open (open > 0 after retries = passings are missing).
   */
  sequence: { requested: number; recovered: number; open: number } | null;
  /** AMMC: local WebSocket port of the converter process, assigned by the worker (diagnostics). */
  localPort?: number | null;
};

export type TimingStatusDocument = {
  kind: "timingStatus";
  version: 1;
  workerHeartbeatAt: string | null;
  decoders: TimingDecoderStatus[];
  /** Decoder simulator run by the worker (absent in documents of earlier versions). */
  simulator?: TimingSimulatorStatus | null;
  updatedAt: string | null;
};

export function createTimingStatusDocument(): TimingStatusDocument {
  return { kind: "timingStatus", version: 1, workerHeartbeatAt: null, decoders: [], updatedAt: null };
}

export function createTimingDecoderStatus(decoderId: string): TimingDecoderStatus {
  return {
    decoderId,
    connection: "disconnected",
    reasons: [],
    connectionSessionId: null,
    connectedSince: null,
    lastMessageAt: null,
    lastError: null,
    passingCount: 0,
    hardware: null,
    device: null,
    sequence: null,
  };
}

export function isTimingStatusDocument(value: unknown): value is TimingStatusDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  return doc.kind === "timingStatus" && doc.version === 1 && Array.isArray(doc.decoders);
}

/** A connected decoder that has been silent this long is shown with a warning. */
export const TIMING_DECODER_SILENCE_WARNING_MS = 30_000;
