// @raceoffice/race-status-mock (browser-safe entry point)
//
// Test support for the timing system's live race status feed:
// - builder.ts    build feed states (races, competitors)
// - feed.ts       RaceStatusFeed: "answer every poll with the state set last"
// - fetch.ts      in-process transport for component tests
// - recording.ts  parse real race recordings and pick states from them
//
// Node-only parts (HTTP mock server, recorder, file loading) live in "./server".

export { buildRace, competitor, feedPayload, startField, type CompetitorInput, type RaceInput } from "./builder.js";
export { RaceStatusFeed, type FeedResponse } from "./feed.js";
export { createFetchStub, type FetchStubOptions } from "./fetch.js";
export {
  anonymizePayload,
  compactRecording,
  compactRecordingPerLap,
  findRace,
  lapKey,
  parseRecording,
  racesOf,
  relevantStateKey,
  serializeFrame,
  type RecordingFrame,
} from "./recording.js";
