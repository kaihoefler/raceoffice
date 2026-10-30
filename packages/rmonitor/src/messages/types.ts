/**
 * Typed RMonitor messages (discriminated union over `kind`).
 *
 * Field indices and parsing rules follow the Java message classes of RMonitorLeaderboard.
 * Times are milliseconds; Java's `Duration.ZERO` default corresponds to `0`.
 */

/** `$F` – sent by Orbits every second, plus extra ones when `lapsToGo` changes. */
export type HeartbeatMessage = {
  kind: "heartbeat";
  lapsToGo: number;
  timeToGoMs: number;
  timeOfDayMs: number;
  raceTimeMs: number;
  /** Already trimmed (Orbits pads to 6 chars: `"Green "`), original case. */
  flag: string;
};

/**
 * `$A` / `$COMP` – competitor registration.
 * `$A` carries the transponder, `$COMP` the additional data; the missing one is `null`
 * (Java leaves the field null as well).
 */
export type CompInfoMessage = {
  kind: "compInfo";
  source: "$A" | "$COMP";
  regNumber: string;
  number: string;
  transNumber: string | null;
  firstName: string;
  lastName: string;
  nationality: string;
  classId: number;
  addData: string | null;
};

/** `$B` – run information; a new `uniqueId` starts a new race. */
export type RunInfoMessage = { kind: "runInfo"; uniqueId: number; description: string };

/** `$C` – class information. */
export type ClassInfoMessage = { kind: "classInfo"; classId: number; description: string };

/** `$E` – setting (`TRACKNAME`, `TRACKLENGTH`, …). */
export type SettingInfoMessage = { kind: "settingInfo"; description: string; value: string };

/** `$G` – race position. */
export type RaceInfoMessage = { kind: "raceInfo"; position: number; regNumber: string; laps: number; totalTimeMs: number };

/** `$H` – practice/qualifying position. */
export type QualiInfoMessage = {
  kind: "qualiInfo";
  position: number;
  regNumber: string;
  bestLap: number;
  bestLapTimeMs: number;
};

/** `$I` – init record (reset); always starts a new race in the Java reference. */
export type InitRecordMessage = { kind: "initRecord"; timeOfDayMs: number; date: string };

/** `$J` – passing information. */
export type PassingInfoMessage = { kind: "passingInfo"; regNumber: string; lapTimeMs: number; totalTimeMs: number };

/** `$SP` / `$SR` – lap information (Orbits extension). */
export type LapInfoMessage = {
  kind: "lapInfo";
  source: "$SP" | "$SR";
  position: number;
  regNumber: string;
  lapNumber: number;
  lapTimeMs: number;
};

/** Prefix the Java app does not handle (e.g. `$RMS`); ignored by the store. */
export type UnknownMessage = { kind: "unknown"; prefix: string; raw: string };

/** Known prefix, but the line could not be parsed; Java drops such lines without a state change. */
export type InvalidMessage = { kind: "invalid"; prefix: string; raw: string; error: string };

export type RMonitorMessage =
  | HeartbeatMessage
  | CompInfoMessage
  | RunInfoMessage
  | ClassInfoMessage
  | SettingInfoMessage
  | RaceInfoMessage
  | QualiInfoMessage
  | InitRecordMessage
  | PassingInfoMessage
  | LapInfoMessage
  | UnknownMessage
  | InvalidMessage;
