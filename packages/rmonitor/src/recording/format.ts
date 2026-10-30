/**
 * Recording format of RMonitorLeaderboard: one line per RMonitor message,
 * `<ms since first message> <raw line>`, e.g. `94432 $F,49,"00:00:00","13:53:23","00:00:33","Green "`.
 *
 * Recordings from the Java app are windows-1252 with CRLF. The byte-level reader keeps the raw
 * bytes so a feeder can replay them unchanged; the text reader works on decoded strings.
 * Timestamps may have leading zeros (`0995`), as in the Java repo's sample files.
 */

export type RecordingEntry<T = string> = {
  /** 1-based line number in the recording file. */
  lineNumber: number;
  offsetMs: number;
  raw: T;
};

export class RecordingFormatError extends Error {
  constructor(
    readonly lineNumber: number,
    message: string,
  ) {
    super(`recording line ${lineNumber}: ${message}`);
    this.name = "RecordingFormatError";
  }
}

const LINE_RE = /^(\d+) (.*)$/s;

/** Parses one recording line (without line ending). Throws `RecordingFormatError` if malformed. */
export function parseRecordingLine(line: string, lineNumber = 1): RecordingEntry {
  const m = LINE_RE.exec(line);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new RecordingFormatError(lineNumber, `expected "<ms> <message>", got "${line.slice(0, 60)}"`);
  }
  return { lineNumber, offsetMs: Number(m[1]), raw: m[2] };
}

export function formatRecordingLine(offsetMs: number, raw: string): string {
  return `${Math.max(0, Math.round(offsetMs))} ${raw}`;
}

/** Parses a decoded recording. Empty lines are skipped (typically the trailing newline). */
export function parseRecording(text: string): RecordingEntry[] {
  const entries: RecordingEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = stripCr(lines[i] ?? "");
    if (line === "") continue;
    entries.push(parseRecordingLine(line, i + 1));
  }
  return entries;
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;

/** Parses a recording at byte level; `raw` holds the message bytes without timestamp and line ending. */
export function parseRecordingBytes(data: Uint8Array): RecordingEntry<Uint8Array>[] {
  const entries: RecordingEntry<Uint8Array>[] = [];
  let lineStart = 0;
  let lineNumber = 0;

  while (lineStart < data.length) {
    lineNumber++;
    let lineEnd = data.indexOf(LF, lineStart);
    const next = lineEnd === -1 ? data.length : lineEnd + 1;
    if (lineEnd === -1) lineEnd = data.length;
    if (lineEnd > lineStart && data[lineEnd - 1] === CR) lineEnd--;

    if (lineEnd > lineStart) {
      let pos = lineStart;
      let offsetMs = 0;
      while (pos < lineEnd) {
        const b = data[pos] as number;
        if (b < DIGIT_0 || b > DIGIT_9) break;
        offsetMs = offsetMs * 10 + (b - DIGIT_0);
        pos++;
      }
      if (pos === lineStart || data[pos] !== SPACE) {
        throw new RecordingFormatError(lineNumber, 'expected "<ms> <message>"');
      }
      entries.push({ lineNumber, offsetMs, raw: data.subarray(pos + 1, lineEnd) });
    }
    lineStart = next;
  }
  return entries;
}
