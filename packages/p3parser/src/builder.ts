import { escapeMessage, normalizeBytes } from "./parser.js";
import { P3_CONTROL, P3_TOR } from "./types.js";

/**
 * Request frame plus metadata useful for diagnostics and logging.
 *
 * `frame` is de-escaped and ready for CRC inspection.
 * `escapedFrame` is what should be sent on the socket.
 */
export interface P3BuiltRequest {
  name: string;
  tor: number;
  torName: string;
  frame: Uint8Array;
  escapedFrame: Uint8Array;
  frameHex: string;
  escapedFrameHex: string;
  notes?: string;
}

/**
 * Low-level field representation for outbound TLV-style payload pieces.
 *
 * This is intentionally generic. Some requests in the Pascal code are built as raw
 * byte sequences rather than through a semantic field model, so this library keeps
 * both options available.
 */
export interface P3OutboundField {
  type: number;
  value: Uint8Array | string;
}

/**
 * Build a full unescaped P3 frame and its escaped wire representation.
 *
 * The CRC is calculated over the unescaped frame, matching the Pascal implementation.
 */
export function buildP3Request(params: {
  name: string;
  version: number;
  flags?: number;
  tor: number;
  body: Uint8Array | string;
  notes?: string;
}): P3BuiltRequest {
  const body = normalizeBytes(params.body);
  const flags = params.flags ?? 0;

  // 1 start + 1 version + 2 length + 2 crc + 2 flags + 2 tor + body + 1 end
  const length = 11 + body.length;
  const frame = new Uint8Array(length);
  frame[0] = P3_CONTROL.START;
  frame[1] = params.version & 0xff;
  writeU16Le(frame, 2, length);
  writeU16Le(frame, 4, 0);
  writeU16Le(frame, 6, flags);
  writeU16Le(frame, 8, params.tor);
  frame.set(body, 10);
  frame[length - 1] = P3_CONTROL.END;

  const crc = calcCrc16(frame);
  writeU16Le(frame, 4, crc);

  const escapedFrame = escapeMessage(frame);

  return {
    name: params.name,
    tor: params.tor,
    torName: torName(params.tor),
    frame,
    escapedFrame,
    frameHex: bytesToHex(frame),
    escapedFrameHex: bytesToHex(escapedFrame),
    notes: params.notes,
  };
}

/**
 * Build an outbound TLV field.
 *
 * Use this only where the protocol shape is actually known. The builder does not
 * invent semantics for fields that the Pascal code leaves opaque.
 */
export function buildOutboundField(field: P3OutboundField): Uint8Array {
  const value = normalizeBytes(field.value);
  if (value.length > 0xff) {
    throw new Error(`Field 0x${field.type.toString(16)} too large: ${value.length} bytes`);
  }

  const out = new Uint8Array(2 + value.length);
  out[0] = field.type & 0xff;
  out[1] = value.length & 0xff;
  out.set(value, 2);
  return out;
}

/** Concatenate multiple outbound field byte arrays. */
export function concatFields(...fields: Array<Uint8Array | string>): Uint8Array {
  const normalized = fields.map((field) => normalizeBytes(field));
  const total = normalized.reduce((sum, field) => sum + field.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const field of normalized) {
    out.set(field, offset);
    offset += field.length;
  }
  return out;
}

/** Convert a 32-bit unsigned value to little-endian bytes. */
export function u32Le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`u32Le value out of range: ${value}`);
  }
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

/**
 * Convert a decoder ID like `40-24-04-00` or `40240400` to four raw bytes.
 *
 * This matches the wire order used by GetResendPhrase/GetSessionPhrase in the Pascal code.
 */
export function decoderIdToWireBytes(decoderId: string): Uint8Array {
  const clean = decoderId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (clean.length !== 8) {
    throw new Error(`Decoder ID must contain exactly 4 bytes, got ${decoderId}`);
  }
  return normalizeBytes(clean);
}

/**
 * Version/decoder search request exactly as hard-coded in GetDecoderSearchPhrase().
 *
 * The Pascal implementation provides this as a literal frame. The semantic meaning of
 * the body fields is not derived in that code, so this helper preserves the exact wire image.
 */
export function buildDecoderSearchRequest(): P3BuiltRequest {
  return buildFromKnownFrameHex(
    "decoder-search",
    "8E001900A53900000300010002000300040008000A000C008F",
    "Exact frame from GetDecoderSearchPhrase() in the Pascal implementation.",
  );
}

/**
 * SmartDecoder workaround request exactly as hard-coded in GetDecoderSearchPhraseSmartDecoderBug().
 *
 * This is intentionally exposed as a raw known-good frame, not a semantic builder, because the
 * provided Pascal code does not explain the body structure beyond the literal request bytes.
 */
export function buildDecoderSearchSmartDecoderBugRequest(): P3BuiltRequest {
  return buildFromKnownFrameHex(
    "decoder-search-smartdecoder-bug",
    "8E0021007CE3000016000800090006000A0005000E0085080A01010A000000008F",
    "Exact frame from GetDecoderSearchPhraseSmartDecoderBug() in the Pascal implementation.",
  );
}

/**
 * Build a GET_TIME / RTC query.
 *
 * This reproduces GetRtcPhrase() from the Pascal code, but computes the CRC dynamically.
 */
export function buildGetTimeRequest(): P3BuiltRequest {
  return buildP3Request({
    name: "get-time",
    version: 0x02,
    tor: P3_TOR.GET_TIME,
    body: "010002000300040008000A000C00",
    notes: "Body shape taken from GetRtcPhrase() in the Pascal implementation.",
  });
}

/**
 * Build a SESSION query for a specific decoder ID.
 *
 * This reproduces GetSessionPhrase(DecoderId) from the Pascal code.
 */
export function buildSessionRequest(decoderId: string): P3BuiltRequest {
  const body = concatFields(
    "010002043271F45503000400",
    buildOutboundField({ type: 0x81, value: decoderIdToWireBytes(decoderId) }),
  );

  return buildP3Request({
    name: "session",
    version: 0x00,
    tor: P3_TOR.SESSION,
    body,
    notes: "Built from GetSessionPhrase(DecoderId) in the Pascal implementation.",
  });
}

/**
 * Build a RESEND query for a passing-number interval and decoder ID.
 *
 * This reproduces GetResendPhrase(FromPassingNr, ToPassingNr, DecoderId)
 * from the Pascal code.
 */
export function buildResendRequest(
  fromPassingNumber: number,
  toPassingNumber: number,
  decoderId: string,
): P3BuiltRequest {
  const body = concatFields(
    buildOutboundField({ type: 0x01, value: u32Le(fromPassingNumber) }),
    buildOutboundField({ type: 0x02, value: u32Le(toPassingNumber) }),
    buildOutboundField({ type: 0x81, value: decoderIdToWireBytes(decoderId) }),
  );

  return buildP3Request({
    name: "resend",
    version: 0x00,
    tor: P3_TOR.RESEND,
    body,
    notes: "Built from GetResendPhrase(FromPassingNr, ToPassingNr, DecoderId) in the Pascal implementation.",
  });
}

/**
 * Convert a built request into a socket-writeable Buffer.
 */
export function toNodeBuffer(request: P3BuiltRequest): Buffer {
  return Buffer.from(request.escapedFrame);
}

/**
 * Re-wrap a known-good full frame literal into a P3BuiltRequest.
 *
 * Useful where the Pascal implementation only gives us a stable wire image but not a
 * semantic field model.
 */
export function buildFromKnownFrameHex(name: string, frameHex: string, notes?: string): P3BuiltRequest {
  const frame = normalizeBytes(frameHex);
  const escapedFrame = escapeMessage(frame);
  const tor = frame.length >= 10 ? readU16Le(frame, 8) : -1;

  return {
    name,
    tor,
    torName: tor >= 0 ? torName(tor) : "UNKNOWN",
    frame,
    escapedFrame,
    frameHex: bytesToHex(frame),
    escapedFrameHex: bytesToHex(escapedFrame),
    notes,
  };
}

export function calcCrc16(input: Uint8Array | string): number {
  const bytes = normalizeBytes(input);
  const table = createCrcTable();
  let crc = 0xffff;

  for (const b of bytes) {
    crc = ((table[(crc >> 8) & 0xff] ^ ((crc << 8) & 0xffff) ^ b) & 0xffff) >>> 0;
  }

  return crc;
}

function writeU16Le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function torName(tor: number): string {
  const entry = Object.entries(P3_TOR).find(([, value]) => value === tor);
  return entry?.[0] ?? `UNKNOWN_0x${tor.toString(16).padStart(4, "0").toUpperCase()}`;
}

function createCrcTable(): Uint16Array {
  const table = new Uint16Array(256);

  for (let i = 0; i < 256; i += 1) {
    let crc = (i << 8) & 0xffff;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
    table[i] = crc;
  }

  return table;
}
