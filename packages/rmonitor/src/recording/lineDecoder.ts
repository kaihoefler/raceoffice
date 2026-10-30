/**
 * Splits a byte stream (TCP chunks) into decoded text lines.
 *
 * - Line ending `\r\n` or `\n` (mixed is fine); an incomplete rest stays buffered until the next chunk.
 * - Each complete line is decoded on its own, so a chunk boundary inside a multi-byte UTF-8
 *   character cannot corrupt it.
 * - Default encoding `windows-1252`: Orbits on Windows sends names in the platform charset.
 *   Supported: every WHATWG label of `TextDecoder` (`utf-8`, `windows-1252`, `latin1`, …).
 */

const LF = 0x0a;
const CR = 0x0d;

export const DEFAULT_RMONITOR_ENCODING = "windows-1252";

export class LineDecoder {
  private readonly decoder: TextDecoder;
  private pending: Uint8Array = new Uint8Array(0);

  constructor(encoding: string = DEFAULT_RMONITOR_ENCODING) {
    // Throws RangeError for unknown labels – better at configuration time than per line.
    this.decoder = new TextDecoder(encoding);
  }

  get encoding(): string {
    return this.decoder.encoding;
  }

  /** Bytes of the incomplete last line currently buffered. */
  get pendingBytes(): number {
    return this.pending.length;
  }

  /** Feeds a chunk and returns all lines completed by it (without line endings). */
  push(chunk: Uint8Array): string[] {
    const data = this.pending.length === 0 ? chunk : concat(this.pending, chunk);
    const lines: string[] = [];
    let start = 0;
    let lf = data.indexOf(LF, start);
    while (lf !== -1) {
      const end = lf > start && data[lf - 1] === CR ? lf - 1 : lf;
      lines.push(this.decoder.decode(data.subarray(start, end)));
      start = lf + 1;
      lf = data.indexOf(LF, start);
    }
    // Copy the rest: `chunk` may be a reused network buffer.
    this.pending = data.slice(start);
    return lines;
  }

  /** Returns the buffered incomplete line (if any) and clears the buffer, e.g. on disconnect. */
  flush(): string[] {
    if (this.pending.length === 0) return [];
    let end = this.pending.length;
    if (this.pending[end - 1] === CR) end--;
    const line = this.decoder.decode(this.pending.subarray(0, end));
    this.pending = new Uint8Array(0);
    return line === "" ? [] : [line];
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
