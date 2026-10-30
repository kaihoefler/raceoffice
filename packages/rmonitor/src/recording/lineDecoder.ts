/**
 * Splits a byte stream (TCP chunks) into lines and decodes them.
 *
 * - Line ending `\r\n` or `\n` (mixed is fine); an incomplete rest stays buffered until the next chunk.
 * - `LineSplitter` returns the raw bytes of each line (a recorder can store them unchanged),
 *   `LineDecoder` additionally decodes them.
 * - Each complete line is decoded on its own, so a chunk boundary inside a multi-byte UTF-8
 *   character cannot corrupt it.
 * - Default encoding `windows-1252`: Orbits on Windows sends names in the platform charset.
 *   Supported: every WHATWG label of `TextDecoder` (`utf-8`, `windows-1252`, `latin1`, …).
 */

const LF = 0x0a;
const CR = 0x0d;

export const DEFAULT_RMONITOR_ENCODING = "windows-1252";

export class LineSplitter {
  private pending: Uint8Array = new Uint8Array(0);

  /** Bytes of the incomplete last line currently buffered. */
  get pendingBytes(): number {
    return this.pending.length;
  }

  /** Feeds a chunk and returns the raw bytes of all lines completed by it (without line endings). */
  push(chunk: Uint8Array): Uint8Array[] {
    const data = this.pending.length === 0 ? chunk : concat(this.pending, chunk);
    const lines: Uint8Array[] = [];
    let start = 0;
    let lf = data.indexOf(LF, start);
    while (lf !== -1) {
      const end = lf > start && data[lf - 1] === CR ? lf - 1 : lf;
      // Copy: `chunk` may be a reused network buffer.
      lines.push(data.slice(start, end));
      start = lf + 1;
      lf = data.indexOf(LF, start);
    }
    this.pending = data.slice(start);
    return lines;
  }

  /** Returns the buffered incomplete line (if any) and clears the buffer, e.g. on disconnect. */
  flush(): Uint8Array[] {
    if (this.pending.length === 0) return [];
    let end = this.pending.length;
    if (this.pending[end - 1] === CR) end--;
    const line = this.pending.slice(0, end);
    this.pending = new Uint8Array(0);
    return line.length === 0 ? [] : [line];
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }
}

export class LineDecoder {
  private readonly decoder: TextDecoder;
  private readonly splitter = new LineSplitter();

  constructor(encoding: string = DEFAULT_RMONITOR_ENCODING) {
    // Throws RangeError for unknown labels – better at configuration time than per line.
    this.decoder = new TextDecoder(encoding);
  }

  get encoding(): string {
    return this.decoder.encoding;
  }

  /** Bytes of the incomplete last line currently buffered. */
  get pendingBytes(): number {
    return this.splitter.pendingBytes;
  }

  /** Feeds a chunk and returns all lines completed by it (without line endings). */
  push(chunk: Uint8Array): string[] {
    return this.splitter.push(chunk).map((line) => this.decoder.decode(line));
  }

  /** Returns the buffered incomplete line (if any) and clears the buffer, e.g. on disconnect. */
  flush(): string[] {
    return this.splitter.flush().map((line) => this.decoder.decode(line));
  }

  reset(): void {
    this.splitter.reset();
  }
}

/**
 * Guesses the encoding of a recording FILE. Java recordings are written with the recorder's
 * file encoding (windows-1252 or UTF-8, seen both), independent of what Orbits sent.
 * Valid UTF-8 containing non-ASCII bytes → `utf-8`, otherwise `windows-1252`.
 * windows-1252 text with umlauts is practically never valid UTF-8.
 */
export function detectRecordingEncoding(data: Uint8Array): "utf-8" | "windows-1252" {
  if (!data.some((b) => b >= 0x80)) return "windows-1252";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
