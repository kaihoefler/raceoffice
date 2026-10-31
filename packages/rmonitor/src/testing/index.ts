/**
 * @raceoffice/rmonitor/testing – Node-only helpers for tests (TCP feeder, golden-test support).
 * Kept out of the main entry so the core package stays free of I/O.
 */
export {
  FakeOrbitsFeeder,
  type FakeOrbitsFeederOptions,
  type FeederLine,
  type PlayOptions,
} from "./fakeOrbitsFeeder.js";
export {
  normalizeRaceTO,
  normalizeRaces,
  selectCheckpoints,
  type CheckpointOptions,
  type GoldenCheckpoint,
  type GoldenFile,
} from "./golden.js";
