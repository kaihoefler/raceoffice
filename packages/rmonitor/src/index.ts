/**
 * @raceoffice/rmonitor
 * --------------------
 * RMonitor protocol (MYLAPS Orbits) and race state model, ported from the Java application
 * RMonitorLeaderboard. Pure logic without I/O; the TCP client, recorder and player live in the
 * leaderboard service. Test helpers (fake Orbits feeder) are in `@raceoffice/rmonitor/testing`.
 *
 * Typical use:
 *   const decoder = new LineDecoder("windows-1252");
 *   const store = new RaceStateStore();
 *   socket.on("data", (chunk) => {
 *     for (const line of decoder.push(chunk)) store.apply(parseLine(line));
 *   });
 *   const json = toRaceTO(store.displayRace);
 */
export { tokenize } from "./tokenize.js";
export {
  ParseError,
  formatDuration,
  parseDuration,
  parseJavaFloat,
  parseJavaInt,
  parseJavaIntOrZero,
  parseSignedDuration,
} from "./duration.js";
export type * from "./messages/types.js";
export { parseLine } from "./messages/parseLine.js";
export { CompetitorState, NO_RACE_ID, RaceState, type FlagStatus, type LapState } from "./state/model.js";
export { RaceStateStore, type RaceStateStoreOptions, type StoreChange } from "./state/raceStateStore.js";
export { compareCompetitorTO, toCompetitorTO, toRaceTO, type CompetitorTO, type RaceTO } from "./state/toRaceTO.js";
export {
  RecordingFormatError,
  formatRecordingLine,
  parseRecording,
  parseRecordingBytes,
  parseRecordingLine,
  type RecordingEntry,
} from "./recording/format.js";
export {
  DEFAULT_RMONITOR_ENCODING,
  detectRecordingEncoding,
  LineDecoder,
  LineSplitter,
} from "./recording/lineDecoder.js";
