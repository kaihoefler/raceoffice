import { P3_CONTROL, P3Header, P3Record, P3StreamChunkResult, P3_TOR } from "./types.js";
import { P3Parser, bytesToHex, calcHeaderCrc, deEscapeMessage } from "./parser.js";


/**
 * Stateful decoder for a TCP byte stream carrying P3 frames.
 *
 * It does not assume packet boundaries. You can feed arbitrary chunks from a socket.
 * Frames are delimited by 0x8E ... 0x8F at the escaped stream level, matching the Pascal listener.
 */
export class P3StreamDecoder {
  private readonly parser: P3Parser;
  private readonly recoveryParser: P3Parser;
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(parser = new P3Parser()) {
    this.parser = parser;
    // Recovery parser intentionally runs in best-effort mode so stream diagnostics
    // can still expose determinable TOR/header/TLV information after strict parse failures.
    this.recoveryParser = new P3Parser({ strict: false, rejectOnCrcMismatch: false });
  }

  push(chunk: Uint8Array): P3StreamChunkResult {
    this.buffer = concat(this.buffer, chunk);

    const records: P3Record[] = [];

    while (true) {
      const start = this.buffer.indexOf(P3_CONTROL.START);
      if (start < 0) {
        this.buffer = new Uint8Array(0);
        break;
      }

      if (start > 0) {
        this.buffer = this.buffer.slice(start);
      }

      const end = findFrameEnd(this.buffer, 1);
      if (end < 0) break;

      const frame = this.buffer.slice(0, end + 1);
      this.buffer = this.buffer.slice(end + 1);

      try {
        records.push(this.parser.parseRecord(frame));
      } catch (error) {
        const parseError = toErrorMessage(error);
        const recovered = this.tryRecoverRecord(frame, parseError);
        records.push(recovered);
      }
    }

    return {
      records,
      bufferedHex: bytesToHex(this.buffer),
    };
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  private tryRecoverRecord(frame: Uint8Array<ArrayBufferLike>, parseError: string): P3Record {
    try {
      return {
        ...this.recoveryParser.parseRecord(frame),
        parseError,
      };
    } catch {
      return createStreamParseErrorRecord(frame, this.recoveryParser, parseError);
    }
  }
}

function concat(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function createStreamParseErrorRecord(
  escapedFrame: Uint8Array<ArrayBufferLike>,
  parser: P3Parser,
  parseError: string,
): P3Record {
  let frame = escapedFrame;
  let deEscapeError: string | null = null;

  try {
    frame = deEscapeMessage(escapedFrame);
  } catch (error) {
    deEscapeError = toErrorMessage(error);
  }

  const header = readHeaderBestEffort(frame);
  const body = header.length >= 0 && frame.length >= 11 ? frame.slice(10, frame.length - 1) : new Uint8Array(0);

    let computedCrc = -1;
  try {
    computedCrc = calcHeaderCrc(frame, parser.calcCrc16.bind(parser));
  } catch {
    computedCrc = -1;
  }


  const crcValid = header.crc >= 0 && computedCrc >= 0 ? header.crc === computedCrc : false;

  return {
    kind: "unknown",
    tor: header.tor,
    torName: header.tor >= 0 ? torName(header.tor) : "STREAM_PARSE_ERROR",
    header,
    crcValid,
    computedCrc,
    bodyHex: bytesToHex(body),
    rawFrameHex: bytesToHex(escapedFrame),
    frameHex: bytesToHex(frame),
    tlvs: [],
    unknownFields: [],
    parseError: deEscapeError ? `${parseError}; deEscapeError: ${deEscapeError}` : parseError,
  };
}

function readHeaderBestEffort(frame: Uint8Array<ArrayBufferLike>): P3Header {
  return {
    start: frame[0] ?? -1,
    version: frame[1] ?? -1,
    length: readU16LeSafe(frame, 2),
    crc: readU16LeSafe(frame, 4),
    flags: readU16LeSafe(frame, 6),
    tor: readU16LeSafe(frame, 8),
    end: frame[frame.length - 1] ?? -1,
  };
}

function readU16LeSafe(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  if (offset + 1 >= bytes.length) return -1;
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function torName(tor: number): string {
  const entry = Object.entries(P3_TOR).find(([, value]) => value === tor);
  return entry?.[0] ?? `UNKNOWN_0x${tor.toString(16).padStart(4, "0").toUpperCase()}`;
}

/**
 * Reproduces the listener logic from the Pascal code:
 * search for the next 0x8F such that the distance from 0x8E is even in hex-character space,
 * which is equivalent to a whole-byte frame boundary in the byte stream.
 */
function findFrameEnd(bytes: Uint8Array<ArrayBufferLike>, fromIndex: number): number {
  let searchFrom = fromIndex;
  while (true) {
    const idx = bytes.indexOf(P3_CONTROL.END, searchFrom);
    if (idx < 0) return -1;
    return idx;
  }
}

