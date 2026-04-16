import {
  P3_CONTROL,
  P3Frame,
  P3GetTimeRecord,
  P3Header,
  P3ParserOptions,
  P3PassingRecord,
  P3Record,
  P3SessionRecord,
  P3StatusRecord,
  P3TlvField,
  P3_TOR,
  P3UnknownRecord,
  P3VersionDecoderRecord,
} from "./types.js";

const PASSING_FIELD = {
  PASSING_NUMBER: 0x01,
  TRANSPONDER_ID_TYPE_TRANX: 0x03,
  RTC_TIME: 0x04,
  STRENGTH: 0x05,
  HITS: 0x06,
  FLAGS: 0x08,
  TRANSPONDER_ID_TYPE_PROCHIPFLEXCHIP: 0x0a,
  USER_FLAG: 0x0e,
  DRIVER_ID: 0x0f,
  UTC_TIME: 0x10,
  RTC_ID: 0x13,
  SPORT: 0x14,
  VOLTAGE: 0x30,
  TEMPERATURE: 0x31,
  DECODER_ID: 0x81,
} as const;

const STATUS_FIELD = {
  NOISE: 0x01,
  GPS: 0x06,
  TEMPERATURE: 0x07,
  SAT_IN_USE: 0x0a,
  LOOP_TRIGGERS: 0x0b,
  INPUT_VOLTAGE: 0x0c,
  DECODER_ID: 0x81,
} as const;

const RTC_FIELD = {
  RTC: 0x01,
  DECODER_ID: 0x81,
} as const;

const SESSION_FIELD = {
  LAST_PASSING_INDEX: 0x04,
  DECODER_ID: 0x81,
  REQUEST_ID: 0x85,
} as const;

const VERSION_FIELD = {
  DECODER_TYPE: 0x02,
  FIRMWARE: 0x03,
  DECODER_ID: 0x81,
} as const;

export class P3Parser {
  private readonly strict: boolean;
  private readonly rejectOnCrcMismatch: boolean;
  private readonly crcTable: Uint16Array;

  constructor(options: P3ParserOptions = {}) {
    this.strict = options.strict ?? true;
    this.rejectOnCrcMismatch = options.rejectOnCrcMismatch ?? false;
    this.crcTable = createCrcTable();
  }

  parseFrame(input: Uint8Array | string): P3Frame {
    const escapedFrame = normalizeBytes(input);
    const frame = deEscapeMessage(escapedFrame);

    if (frame.length < 11) {
      throw new Error(`Frame too short: ${frame.length} bytes`);
    }

    const header = parseHeader(frame);
    const body = frame.slice(9, frame.length - 1);
    const tlvs = parseTlvs(body, this.strict);
    const computedCrc = this.calcCrc16(frame);
    const crcValid = computedCrc === header.crc;

    if (this.rejectOnCrcMismatch && !crcValid) {
      throw new Error(
        `CRC mismatch: expected 0x${toHex(header.crc, 4)}, computed 0x${toHex(computedCrc, 4)}`,
      );
    }

    return {
      escapedFrame,
      frame,
      header,
      body,
      tlvs,
      crcValid,
      computedCrc,
    };
  }

  parseRecord(input: Uint8Array | string): P3Record {
    const parsed = this.parseFrame(input);
    const base = createBaseRecord(parsed);

    switch (parsed.header.tor) {
      case P3_TOR.PASSING:
        return this.parsePassing(base, parsed.tlvs);
      case P3_TOR.STATUS:
        return this.parseStatus(base, parsed.tlvs);
      case P3_TOR.VERSION_DECODER:
        return this.parseVersionDecoder(base, parsed.tlvs);
      case P3_TOR.GET_TIME:
        return this.parseGetTime(base, parsed.tlvs);
      case P3_TOR.SESSION:
        return this.parseSession(base, parsed.tlvs);
      default:
        return {
          ...base,
          kind: "unknown",
        } satisfies P3UnknownRecord;
    }
  }

  calcCrc16(input: Uint8Array | string): number {
    const bytes = normalizeBytes(input);
    let crc = 0xffff;

    for (const b of bytes) {
      crc = ((this.crcTable[(crc >> 8) & 0xff] ^ ((crc << 8) & 0xffff) ^ b) & 0xffff) >>> 0;
    }

    return crc;
  }

  private parsePassing(base: ReturnType<typeof createBaseRecord>, tlvs: P3TlvField[]): P3PassingRecord {
    const unknownFields = [...tlvs];
    const record: P3PassingRecord = {
      ...base,
      kind: "passing",
      tor: P3_TOR.PASSING,
      unknownFields,
    };

    for (const tlv of tlvs) {
      switch (tlv.type) {
        case PASSING_FIELD.PASSING_NUMBER:
          record.passingNumber = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.TRANSPONDER_ID_TYPE_TRANX: {
          const value = numericLe(tlv).toString(10);
          record.transponderType = "tranx";
          record.transponderId = mapSpecialTransponderId(value);
          consumeUnknown(unknownFields, tlv);
          break;
        }
        case PASSING_FIELD.TRANSPONDER_ID_TYPE_PROCHIPFLEXCHIP:
          record.transponderType = "prochip-flexchip";
          record.transponderId = decodePascalReversedAscii(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.RTC_TIME:
          if (!record.passingTime) {
            record.passingTime = decodeP3Timestamp(tlv);
            record.passingTimeSource = "rtc";
          }
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.UTC_TIME:
          record.passingTime = decodeP3Timestamp(tlv);
          record.passingTimeSource = "utc";
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.STRENGTH:
          record.signalStrength = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.HITS:
          record.hits = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.FLAGS:
          record.lowBatteryWarning = (numericLe(tlv) & 1) !== 0;
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.SPORT:
          record.sport = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case PASSING_FIELD.DECODER_ID:
          record.decoderId = decodeDecoderIdPascalStyle(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        default:
          break;
      }
    }

    return record;
  }

  private parseStatus(base: ReturnType<typeof createBaseRecord>, tlvs: P3TlvField[]): P3StatusRecord {
    const unknownFields = [...tlvs];
    const record: P3StatusRecord = {
      ...base,
      kind: "status",
      tor: P3_TOR.STATUS,
      unknownFields,
    };

    for (const tlv of tlvs) {
      switch (tlv.type) {
        case STATUS_FIELD.NOISE:
          record.noise = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case STATUS_FIELD.GPS:
          record.gps = numericLe(tlv) === 1;
          consumeUnknown(unknownFields, tlv);
          break;
        case STATUS_FIELD.TEMPERATURE:
          record.temperature = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case STATUS_FIELD.INPUT_VOLTAGE:
          record.inputVoltage = numericLe(tlv) / 10;
          consumeUnknown(unknownFields, tlv);
          break;
        case STATUS_FIELD.DECODER_ID:
          record.decoderId = decodeDecoderIdPascalStyle(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        default:
          break;
      }
    }

    return record;
  }

  private parseVersionDecoder(
    base: ReturnType<typeof createBaseRecord>,
    tlvs: P3TlvField[],
  ): P3VersionDecoderRecord {
    const unknownFields = [...tlvs];
    const record: P3VersionDecoderRecord = {
      ...base,
      kind: "version-decoder",
      tor: P3_TOR.VERSION_DECODER,
      unknownFields,
    };

    for (const tlv of tlvs) {
      switch (tlv.type) {
        case VERSION_FIELD.DECODER_TYPE:
          record.decoderType = decodeAscii(tlv.raw);
          consumeUnknown(unknownFields, tlv);
          break;
        case VERSION_FIELD.FIRMWARE:
          record.firmwareVersion = decodeAscii(tlv.raw);
          consumeUnknown(unknownFields, tlv);
          break;
        case VERSION_FIELD.DECODER_ID:
          record.decoderId = bytesToHex(tlv.raw, "-");
          consumeUnknown(unknownFields, tlv);
          break;
        default:
          break;
      }
    }

    return record;
  }

  private parseGetTime(base: ReturnType<typeof createBaseRecord>, tlvs: P3TlvField[]): P3GetTimeRecord {
    const unknownFields = [...tlvs];
    const record: P3GetTimeRecord = {
      ...base,
      kind: "get-time",
      tor: P3_TOR.GET_TIME,
      unknownFields,
    };

    for (const tlv of tlvs) {
      switch (tlv.type) {
        case RTC_FIELD.RTC:
          record.currentDecoderTime = decodeP3Timestamp(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case RTC_FIELD.DECODER_ID:
          record.decoderId = decodeDecoderIdPascalStyle(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        default:
          break;
      }
    }

    return record;
  }

  private parseSession(base: ReturnType<typeof createBaseRecord>, tlvs: P3TlvField[]): P3SessionRecord {
    const unknownFields = [...tlvs];
    const record: P3SessionRecord = {
      ...base,
      kind: "session",
      tor: P3_TOR.SESSION,
      unknownFields,
    };

    for (const tlv of tlvs) {
      switch (tlv.type) {
        case SESSION_FIELD.LAST_PASSING_INDEX:
          record.lastPassingIndex = numericLe(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        case SESSION_FIELD.DECODER_ID:
          record.decoderId = decodeDecoderIdPascalStyle(tlv);
          consumeUnknown(unknownFields, tlv);
          break;
        default:
          break;
      }
    }

    return record;
  }
}

function parseHeader(frame: Uint8Array): P3Header {
  if (frame[0] !== P3_CONTROL.START) {
    throw new Error(`Invalid start byte: 0x${toHex(frame[0], 2)}`);
  }
  if (frame[frame.length - 1] !== P3_CONTROL.END) {
    throw new Error(`Invalid end byte: 0x${toHex(frame[frame.length - 1], 2)}`);
  }

  return {
    start: frame[0],
    version: frame[1],
    length: readU16Le(frame, 2),
    crc: readU16Le(frame, 4),
    flags: readU16Le(frame, 6),
    tor: readU16Le(frame, 8),
    end: frame[frame.length - 1],
  };
}

function parseTlvs(body: Uint8Array, strict: boolean): P3TlvField[] {
  const result: P3TlvField[] = [];
  let offset = 0;

  while (offset < body.length) {
    if (offset + 2 > body.length) {
      if (strict) throw new Error(`Truncated TLV header at offset ${offset}`);
      break;
    }

    const type = body[offset];
    const length = body[offset + 1];
    const start = offset + 2;
    const end = start + length;

    if (end > body.length) {
      if (strict) {
        throw new Error(`Truncated TLV value for type 0x${toHex(type, 2)} at offset ${offset}`);
      }
      break;
    }

    const raw = body.slice(start, end);
    result.push({
      type,
      length,
      raw,
      rawHex: bytesToHex(raw),
      reversedHex: bytesToHex(Uint8Array.from([...raw].reverse())),
    });

    offset = end;
  }

  return result;
}

function createBaseRecord(frame: P3Frame) {
  return {
    kind: "unknown",
    tor: frame.header.tor,
    torName: torName(frame.header.tor),
    header: frame.header,
    crcValid: frame.crcValid,
    computedCrc: frame.computedCrc,
    bodyHex: bytesToHex(frame.body),
    rawFrameHex: bytesToHex(frame.escapedFrame),
    frameHex: bytesToHex(frame.frame),
    tlvs: frame.tlvs,
    unknownFields: [...frame.tlvs],
  };
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

export function normalizeBytes(input: Uint8Array | string): Uint8Array {
  if (input instanceof Uint8Array) return input;
  const hex = input.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length % 2 !== 0) throw new Error(`Hex input has odd length: ${hex.length}`);

  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function deEscapeMessage(input: Uint8Array | string): Uint8Array {
  const bytes = normalizeBytes(input);
  if (bytes.length <= 2) return bytes;

  const out: number[] = [bytes[0]];
  for (let i = 1; i < bytes.length - 1; i += 1) {
    const b = bytes[i];
    if (b === P3_CONTROL.ESC) {
      i += 1;
      if (i >= bytes.length - 1) throw new Error("Dangling escape byte before end of frame");
      out.push((bytes[i] - 0x20) & 0xff);
    } else {
      out.push(b);
    }
  }
  out.push(bytes[bytes.length - 1]);
  return Uint8Array.from(out);
}

export function escapeMessage(input: Uint8Array | string): Uint8Array {
  const bytes = normalizeBytes(input);
  if (bytes.length <= 2) return bytes;

  const out: number[] = [bytes[0]];
  for (let i = 1; i < bytes.length - 1; i += 1) {
    const b = bytes[i];
    if (b === P3_CONTROL.START || b === P3_CONTROL.ESC || b === P3_CONTROL.END) {
      out.push(P3_CONTROL.ESC, (b + 0x20) & 0xff);
    } else {
      out.push(b);
    }
  }
  out.push(bytes[bytes.length - 1]);
  return Uint8Array.from(out);
}

export function decodeP3Timestamp(tlv: P3TlvField): Date {
  const micros = readBigUIntLe(tlv.raw);
  return new Date(Number(micros / 1000n));
}

export function decodeDecoderIdPascalStyle(tlv: P3TlvField): string {
  return bytesToHex(Uint8Array.from([...tlv.raw].reverse()), "-");
}

export function decodePascalReversedAscii(tlv: P3TlvField): string {
  return decodeAscii(Uint8Array.from([...tlv.raw].reverse()));
}

export function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes);
}

export function bytesToHex(bytes: Uint8Array, sep = ""): string {
  return [...bytes].map((b) => toHex(b, 2)).join(sep).toUpperCase();
}

export function toHex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0").toUpperCase();
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readBigUIntLe(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    result |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  return result;
}

export function numericLe(tlv: P3TlvField): number {
  return Number(readBigUIntLe(tlv.raw));
}

function mapSpecialTransponderId(value: string): string {
  switch (value) {
    case "9992":
      return "Switch";
    case "9993":
      return "SyncPulse";
    case "9991":
      return "FinishCamStart";
    default:
      return value;
  }
}

function torName(tor: number): string {
  const entry = Object.entries(P3_TOR).find(([, value]) => value === tor);
  return entry?.[0] ?? `UNKNOWN_0x${toHex(tor, 4)}`;
}

function consumeUnknown(list: P3TlvField[], target: P3TlvField): void {
  const index = list.indexOf(target);
  if (index >= 0) list.splice(index, 1);
}
