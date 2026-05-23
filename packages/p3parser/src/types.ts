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
    TOR_0012_OBSERVED: 0x0012,
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
  /**
   * Optional parse error message when strict parsing failed and stream-level
   * best-effort recovery output was used instead.
   */
  parseError?: string;
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
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
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
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}


export interface P3GetTimeRecord extends P3BaseRecord {
  kind: "get-time";
  tor: typeof P3_TOR.GET_TIME;
  currentDecoderTime?: Date;
  decoderId?: string;
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}


export interface P3SessionRecord extends P3BaseRecord {
  kind: "session";
  tor: typeof P3_TOR.SESSION;
  lastPassingIndex?: number;
  decoderId?: string;
  /** Optional request identifier (field 0x85), kept as decimal string for 64-bit safety. */
  requestId?: string;
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}



/**
 * RESEND command/echo payload.
 *
 * Observed wire shape mirrors the outgoing request fields:
 * - 0x01: from passing number (u32 LE)
 * - 0x02: to passing number (u32 LE)
 * - 0x81: decoder id (Pascal-style reversed byte text)
 */
export interface P3ResendRecord extends P3BaseRecord {
  kind: "resend";
  tor: typeof P3_TOR.RESEND;
  fromPassingNumber?: number;
  toPassingNumber?: number;
  decoderId?: string;
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}


/**
 * Observed discovery reply for TOR 0x0016 (NETWORK_SETTINGS).
 *
  * Evidence-backed mapping from captures:
 * - 0x08 -> decoder IPv4 address
 * - 0x09 -> netmask
 * - 0x0A -> default gateway
 * - 0x05 -> DNS server (often 0.0.0.0 when unset)
 *
 * Other fields remain in `unknownFields` until their semantics are proven.
 */
export interface P3NetworkSettingsRecord extends P3BaseRecord {
  kind: "network-settings";
  tor: typeof P3_TOR.NETWORK_SETTINGS;
  decoderId?: string;

  /** Decoder IPv4 address (field 0x08, little-endian wire bytes). */
  ipAddress?: string;
  /** IPv4 netmask (field 0x09, little-endian wire bytes). */
  netmask?: string;
  /** Default gateway IPv4 (field 0x0A, little-endian wire bytes). */
  defaultGateway?: string;
  /** DNS server IPv4 (field 0x05, little-endian wire bytes). */
  dnsServer?: string;
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}




/**
 * Observed discovery reply for TOR 0x0012.
 *
 * No stable semantic labels from Pascal source are available, so values are exposed
 * by observed field ids.
 */
export interface P3Tor0012ObservedRecord extends P3BaseRecord {
  kind: "tor-0012-observed";
  tor: typeof P3_TOR.TOR_0012_OBSERVED;
  decoderId?: string;
  observedField03?: number;
  observedField04?: number;
  observedField05?: number;
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}


/**
 * Observed discovery reply for TOR 0x004A (TIMELINE).
 */
export interface P3TimelineRecord extends P3BaseRecord {
  kind: "timeline";
  tor: typeof P3_TOR.TIMELINE;
  decoderId?: string;
  timelineName?: string;
  observedField02?: number;
  observedField03?: number;
  observedField04?: number;
  /** Observed field 0x83 (131), represented as little-endian unsigned numeric value. */
  observedField131?: number;
}


/**
 * Typisierte Hülle für SERVER_SETTINGS (0x0013) und GENERAL_SETTINGS (0x0028).
 *
 * Aus den gezeigten Quellen ist derzeit nur gesichert, dass diese TORs existieren.
 * Deshalb werden Felder bewusst als observed/raw gespiegelt statt semantisch benannt.
 */
export interface P3SettingsRecord extends P3BaseRecord {
  kind: "settings";
  tor: typeof P3_TOR.SERVER_SETTINGS | typeof P3_TOR.GENERAL_SETTINGS;
  decoderId?: string;
  observedNumericFields: Array<{ type: number; value: number }>;
  observedAsciiFields: Array<{ type: number; value: string }>;
}

/**
 * Typisierte Hülle für SIGNALS (0x002D).
 */
export interface P3SignalsRecord extends P3BaseRecord {
  kind: "signals";
  tor: typeof P3_TOR.SIGNALS;
  decoderId?: string;
  observedNumericFields: Array<{ type: number; value: number }>;
  observedAsciiFields: Array<{ type: number; value: string }>;
}

/**
 * Typisierte Hülle für GPS_INFO (0x0030).
 */
export interface P3GpsInfoRecord extends P3BaseRecord {
  kind: "gps-info";
  tor: typeof P3_TOR.GPS_INFO;
  decoderId?: string;
  observedNumericFields: Array<{ type: number; value: number }>;
  observedAsciiFields: Array<{ type: number; value: string }>;
}

/**
 * Typisierte Hülle für FIRST_CONTACT (0x0045).
 */
export interface P3FirstContactRecord extends P3BaseRecord {
  kind: "first-contact";
  tor: typeof P3_TOR.FIRST_CONTACT;
  decoderId?: string;
  observedNumericFields: Array<{ type: number; value: number }>;
  observedAsciiFields: Array<{ type: number; value: string }>;
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
  | P3ResendRecord
    | P3NetworkSettingsRecord
  | P3Tor0012ObservedRecord
  | P3TimelineRecord
  | P3SettingsRecord
  | P3SignalsRecord
  | P3GpsInfoRecord
  | P3FirstContactRecord
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
