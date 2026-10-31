/**
 * Time and number parsing compatible with the Java reference.
 *
 * The Java app parses every message completely in the message constructor before it touches
 * the race state. Any parse error (NumberFormatException, DateTimeParseException, missing
 * token) drops the whole message. The parsers here therefore throw `ParseError`, and
 * `parseLine` turns that into an `invalid` message without any state change.
 *
 * Times are kept as milliseconds. Java uses `Duration` with nanosecond precision; Orbits never
 * sends more than milliseconds, and finer fractions survive as fractional milliseconds.
 */

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const INT_RE = /^[+-]?\d+$/;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** `Integer.parseInt`: optional sign, digits only, 32-bit range. */
export function parseJavaInt(value: string | undefined): number {
  if (value === undefined) throw new ParseError("missing integer field");
  if (!INT_RE.test(value)) throw new ParseError(`not an integer: "${value}"`);
  const n = Number(value);
  if (n < INT32_MIN || n > INT32_MAX) throw new ParseError(`integer out of range: "${value}"`);
  return n;
}

/** Java parsers use `0` for an empty integer field in `$G`, `$H`, `$SP`/`$SR` (laps before the first crossing). */
export function parseJavaIntOrZero(value: string | undefined): number {
  return value === "" ? 0 : parseJavaInt(value);
}

const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?$/;

/** `Float.parseFloat` for the decimal forms Orbits sends (`"0.200"`); surrounding whitespace is ignored like in Java. */
export function parseJavaFloat(value: string | undefined): number {
  if (value === undefined) throw new ParseError("missing float field");
  const trimmed = value.trim();
  if (!FLOAT_RE.test(trimmed)) throw new ParseError(`not a float: "${value}"`);
  return Number(trimmed.replace(/[fFdD]$/, ""));
}

/**
 * `LocalTime.parse` (ISO_LOCAL_TIME) → milliseconds of day.
 * Accepted: `HH:mm`, `HH:mm:ss`, `HH:mm:ss.f` with 1–9 fraction digits; hours 00–23.
 * Empty strings and one-digit hours are rejected, exactly like Java.
 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/;

export function parseDuration(value: string | undefined): number {
  if (value === undefined) throw new ParseError("missing time field");
  const m = TIME_RE.exec(value);
  if (!m) throw new ParseError(`not a time: "${value}"`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] === undefined ? 0 : Number(m[3]);
  const fractionMs = m[4] === undefined ? 0 : Number(m[4].padEnd(9, "0")) / 1e6;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fractionMs;
}

/**
 * Signed correction of `$COR` (`-0:00:00.048`, `+0:00:00.001`) → milliseconds.
 * Unlike `LocalTime`, the hour has no fixed width and the sign is mandatory.
 */
const SIGNED_RE = /^([+-])(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?$/;

export function parseSignedDuration(value: string | undefined): number {
  if (value === undefined) throw new ParseError("missing time field");
  const m = SIGNED_RE.exec(value);
  if (!m) throw new ParseError(`not a signed time: "${value}"`);
  const fractionMs = m[5] === undefined ? 0 : Number(m[5].padEnd(9, "0")) / 1e6;
  const ms = ((Number(m[2]) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000 + fractionMs;
  return m[1] === "-" ? -ms : ms;
}

/**
 * `DurationUtil.format`: `m:ss` without hours, `H:mm:ss` with hours (no leading zero),
 * `.SSS` only if the millisecond part is non-zero. `0` → `"0:00"` (Java default `Duration.ZERO`).
 */
export function formatDuration(ms: number): string {
  const totalMs = Math.floor(ms);
  const millis = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const ss = String(seconds).padStart(2, "0");
  let text = hours !== 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
  if (millis !== 0) text += `.${String(millis).padStart(3, "0")}`;
  return text;
}
