/**
 * Parses one raw RMonitor line into a typed message.
 *
 * Never throws: a broken line from the network must not stop the stream.
 * - unknown prefix → `unknown` (Java: logged and skipped)
 * - known prefix, but a field cannot be parsed or is missing → `invalid` (Java: exception caught,
 *   line skipped). Because Java parses the whole message before touching the state, an invalid
 *   line has no effect at all; the store ignores it the same way.
 */
import { ParseError, parseDuration, parseJavaInt, parseJavaIntOrZero } from "../duration.js";
import { tokenize } from "../tokenize.js";
import type { RMonitorMessage } from "./types.js";

type Parser = (t: string[]) => RMonitorMessage;

/** Missing token = ArrayIndexOutOfBoundsException in Java → invalid line. */
function str(t: string[], index: number): string {
  const value = t[index];
  if (value === undefined) throw new ParseError(`missing field ${index}`);
  return value;
}

const PARSERS: Record<string, Parser> = {
  $F: (t) => ({
    kind: "heartbeat",
    lapsToGo: parseJavaInt(t[1]),
    timeToGoMs: parseDuration(t[2]),
    timeOfDayMs: parseDuration(t[3]),
    raceTimeMs: parseDuration(t[4]),
    flag: str(t, 5).trim(),
  }),
  $A: (t) => ({
    kind: "compInfo",
    source: "$A",
    regNumber: str(t, 1),
    number: str(t, 2),
    transNumber: str(t, 3),
    firstName: str(t, 4),
    lastName: str(t, 5),
    nationality: str(t, 6),
    classId: parseJavaInt(t[7]),
    addData: null,
  }),
  $COMP: (t) => ({
    kind: "compInfo",
    source: "$COMP",
    regNumber: str(t, 1),
    number: str(t, 2),
    transNumber: null,
    classId: parseJavaInt(t[3]),
    firstName: str(t, 4),
    lastName: str(t, 5),
    nationality: str(t, 6),
    addData: str(t, 7),
  }),
  $B: (t) => ({ kind: "runInfo", uniqueId: parseJavaInt(t[1]), description: str(t, 2) }),
  $C: (t) => ({ kind: "classInfo", classId: parseJavaInt(t[1]), description: str(t, 2) }),
  $E: (t) => ({ kind: "settingInfo", description: str(t, 1), value: str(t, 2) }),
  $G: (t) => ({
    kind: "raceInfo",
    position: parseJavaInt(t[1]),
    regNumber: str(t, 2),
    laps: parseJavaIntOrZero(t[3]),
    totalTimeMs: parseDuration(t[4]),
  }),
  $H: (t) => ({
    kind: "qualiInfo",
    position: parseJavaInt(t[1]),
    regNumber: str(t, 2),
    bestLap: parseJavaIntOrZero(t[3]),
    bestLapTimeMs: parseDuration(t[4]),
  }),
  // Java reads only the time of day; the date is kept for display/diagnostics.
  $I: (t) => ({ kind: "initRecord", timeOfDayMs: parseDuration(t[1]), date: t[2] ?? "" }),
  $J: (t) => ({
    kind: "passingInfo",
    regNumber: str(t, 1),
    lapTimeMs: parseDuration(t[2]),
    totalTimeMs: parseDuration(t[3]),
  }),
  $SP: (t) => lapInfo("$SP", t),
  $SR: (t) => lapInfo("$SR", t),
};

function lapInfo(source: "$SP" | "$SR", t: string[]): RMonitorMessage {
  return {
    kind: "lapInfo",
    source,
    position: parseJavaInt(t[1]),
    regNumber: str(t, 2),
    lapNumber: parseJavaIntOrZero(t[3]),
    lapTimeMs: parseDuration(t[4]),
  };
}

export function parseLine(raw: string): RMonitorMessage {
  const tokens = tokenize(raw);
  const prefix = tokens[0];
  if (prefix === undefined) return { kind: "invalid", prefix: "", raw, error: "empty line" };

  const parser = Object.hasOwn(PARSERS, prefix) ? PARSERS[prefix] : undefined;
  if (!parser) return { kind: "unknown", prefix, raw };

  try {
    return parser(tokens);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { kind: "invalid", prefix, raw, error };
  }
}
