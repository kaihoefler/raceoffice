import { P3_CONTROL, P3Record, P3StreamChunkResult } from "./types.js";
import { P3Parser, bytesToHex } from "./parser.js";

/**
 * Stateful decoder for a TCP byte stream carrying P3 frames.
 *
 * It does not assume packet boundaries. You can feed arbitrary chunks from a socket.
 * Frames are delimited by 0x8E ... 0x8F at the escaped stream level, matching the Pascal listener.
 */
export class P3StreamDecoder {
  private readonly parser: P3Parser;
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(parser = new P3Parser()) {
    this.parser = parser;
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
        records.push({
          kind: "unknown",
          tor: -1,
          torName: "STREAM_PARSE_ERROR",
          header: {
            start: frame[0] ?? -1,
            version: frame[1] ?? -1,
            length: -1,
            crc: -1,
            flags: -1,
            tor: -1,
            end: frame[frame.length - 1] ?? -1,
          },
          crcValid: false,
          computedCrc: -1,
          bodyHex: "",
          rawFrameHex: bytesToHex(frame),
          frameHex: bytesToHex(frame),
          tlvs: [],
          unknownFields: [],
        });
        void error;
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
}

function concat(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
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
