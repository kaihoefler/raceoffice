/**
 * Types for a MYLAPS P3 protocol parser.
 *
 * Design goal:
 * - only model behavior evidenced by the provided Pascal implementation
 * - preserve undecoded data instead of guessing
 * - work both for offline packet analysis and live TCP stream decoding
 */

export const P3_CONTROL = {
  START: 0x8e,
  ESC: 0x8d,
  END: 0x8f,
} as const;

export const P3_TOR = {
  RESET: 0x0000,
  PASSING: 0x0001,
  STATUS: 0x0002,
  VERSION_DECODER: 0x0003,
  RESEND: 0x0004,
  CLEAR_PASSING: 0x0005,
  SERVER_SETTINGS: 0x0013,
  SESSION: 0x0015,
  NETWORK_SETTINGS: 0x0016,
  WATCHDOG: 0x0018,
  PING: 0x0020,
  GET_TIME: 0x0024,
  GENERAL_SETTINGS: 0x0028,
  SIGNALS: 0x002d,
  LOOP_TRIGGER: 0x002f,
  GPS_INFO: 0x0030,
  FIRST_CONTACT: 0x0045,
  TIMELINE: 0x004a,
  ERROR: 0xffff,
} as const;

export type P3KnownTor = typeof P3_TOR[keyof typeof P3_TOR];

export interface P3Header {
  start: number;
  version: number;
  length: number;
  crc: number;
  flags: number;
  tor: number;
  end: number;
}

export interface P3TlvField {
  /** Field type / type-of-field / field-of-message byte. */
  type: number;
  /** Declared payload length in bytes. */
  length: number;
  /** Raw value bytes in wire order, as present in the TLV value. */
  raw: Uint8Array;
  /** Hex string of raw value bytes in wire order. */
  rawHex: string;
  /** Hex string reversed like the Pascal implementation does for numeric fields. */
  reversedHex: string;
}

export interface P3Frame {
  /** Original escaped bytes exactly as received from the stream. */
  escapedFrame: Uint8Array;
  /** Same frame after de-escaping. */
  frame: Uint8Array;
  header: P3Header;
  /** Body bytes between TOR and END. */
  body: Uint8Array;
  /** All TLV fields extracted from the body. */
  tlvs: P3TlvField[];
  /** True if header CRC equals calculated CRC over the de-escaped frame. */
  crcValid: boolean;
  /** CRC computed from the current frame bytes. */
  computedCrc: number;
}

export interface P3BaseRecord {
  kind: string;
  tor: number;
  torName: string;
  header: P3Header;
  crcValid: boolean;
  computedCrc: number;
  bodyHex: string;
  rawFrameHex: string;
  frameHex: string;
  tlvs: P3TlvField[];
  /** TLVs not promoted into typed properties. */
  unknownFields: P3TlvField[];
}

export interface P3PassingRecord extends P3BaseRecord {
  kind: "passing";
  tor: typeof P3_TOR.PASSING;
  passingNumber?: number;
  transponderId?: string;
  /** "tranx", "prochip-flexchip", or undefined if not evidenced. */
  transponderType?: "tranx" | "prochip-flexchip";
  passingTime?: Date;
  passingTimeSource?: "rtc" | "utc";
  signalStrength?: number;
  hits?: number;
  sport?: number;
  decoderId?: string;
  lowBatteryWarning?: boolean;
}

export interface P3StatusRecord extends P3BaseRecord {
  kind: "status";
  tor: typeof P3_TOR.STATUS;
  noise?: number;
  gps?: boolean;
  temperature?: number;
  inputVoltage?: number;
  decoderId?: string;
}

export interface P3VersionDecoderRecord extends P3BaseRecord {
  kind: "version-decoder";
  tor: typeof P3_TOR.VERSION_DECODER;
  firmwareVersion?: string;
  decoderType?: string;
  decoderId?: string;
}

export interface P3GetTimeRecord extends P3BaseRecord {
  kind: "get-time";
  tor: typeof P3_TOR.GET_TIME;
  currentDecoderTime?: Date;
  decoderId?: string;
}

export interface P3SessionRecord extends P3BaseRecord {
  kind: "session";
  tor: typeof P3_TOR.SESSION;
  lastPassingIndex?: number;
  decoderId?: string;
}

export interface P3UnknownRecord extends P3BaseRecord {
  kind: "unknown";
}

export type P3Record =
  | P3PassingRecord
  | P3StatusRecord
  | P3VersionDecoderRecord
  | P3GetTimeRecord
  | P3SessionRecord
  | P3UnknownRecord;

export interface P3ParserOptions {
  /**
   * If true, reject malformed frames with thrown errors.
   * If false, best-effort parsing is used and undecodable content is surfaced.
   * Default: true
   */
  strict?: boolean;

  /**
   * If true, CRC mismatch throws in strict mode.
   * If false, records still parse with crcValid=false.
   * Default: false
   */
  rejectOnCrcMismatch?: boolean;
}

export interface P3StreamChunkResult {
  records: P3Record[];
  /** Remaining bytes kept internally for the next chunk. */
  bufferedHex: string;
}
