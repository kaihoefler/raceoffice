/**
 * Clean public API types for the P3 client layer.
 *
 * These types intentionally abstract all P3 wire-protocol details.
 * Consumers never need to import from types.ts / parser.ts / builder.ts.
 */

export type DecoderConfig = {
  ip: string;
  /** Default: 5403 */
  port?: number;
  /** Human-readable label, e.g. "Start", "Ziel", "Sektor 1". Not interpreted by the client. */
  label?: string;
};

export type ConnectionState = "disconnected" | "connecting" | "connected";

// ---------------------------------------------------------------------------
// Events emitted by a connected decoder
// ---------------------------------------------------------------------------

export type PassingEvent = {
  passingNumber: number;
  /** Transponder identifier string. Numeric string for tranx ("12345"), formatted for prochip ("AA-12345"). */
  transponderId: string;
  transponderType: "tranx" | "prochip";
  time: Date;
  timeSource: "rtc" | "utc";
  signalStrength: number;
  hits: number;
  lowBattery: boolean;
  decoderId: string;
};

export type DecoderStatusEvent = {
  noise: number;
  gpsLocked: boolean;
  temperature: number;
  voltage: number;
  decoderId: string;
};

export type DecoderInfoEvent = {
  decoderType: string;
  firmwareVersion: string;
  decoderId: string;
};

// ---------------------------------------------------------------------------
// Discovery result
// ---------------------------------------------------------------------------

export type DiscoveredDecoder = {
  ip: string;
  port: number;
  decoderId: string;
  decoderType: string;
  firmwareVersion: string;
};
