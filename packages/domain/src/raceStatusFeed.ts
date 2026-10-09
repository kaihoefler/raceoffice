/**
 * raceStatusFeed
 * --------------
 * Contract of the external live race status feed (timing system REST endpoint,
 * default `http://localhost:8080/races?filter=current`), polled by the frontend.
 *
 * The feed returns a JSON array of races. Only the fields RaceOffice reads are typed;
 * the real payload carries more (e.g. `trackName`, `bestLap`, `qualiPosition`).
 * A real sample is in `examples/race_status.json`.
 *
 * Lives in the shared domain package because it is a contract used by several parties:
 * the frontend provider that polls the feed, the scoring rules on top of it
 * (apps/frontend/src/domain/liveScoring.ts) and the feed mock used by tests.
 */

/**
 * Flag status as sent by the timing system. Observed values include "GREEN",
 * "Purple"/"PURPLE" and "FINISH"; `string` keeps unknown flags representable.
 * An empty flag means "no active race".
 */
export type RaceStatusFlag = "GREEN" | "Purple" | "FINISH" | string;

/** One competitor in the live feed. */
export type RaceStatusCompetitor = {
  /** Bib as string, e.g. "12". */
  number: string;
  position: number;
  lapsComplete: number;
  firstName: string;
  /** May carry a nation suffix, e.g. "Rojas Gil (COL)". */
  lastName: string;
  /** e.g. "0:15" or "0:15.032" */
  totalTime: string;
};

/** Live status of one race. */
export type RaceStatusRace = {
  raceName: string;
  raceID: number;
  flagStatus: RaceStatusFlag;
  elapsedTime?: string;
  timeOfDay?: string;
  lapsComplete?: number;
  lapsToGo?: number;
  competitors: RaceStatusCompetitor[];
};

/**
 * Picks the current race from a raw feed payload: the first array entry with a
 * non-empty `flagStatus`, otherwise null (no active race / unexpected payload).
 */
export function pickCurrentRace(payload: unknown): RaceStatusRace | null {
  const arr = Array.isArray(payload) ? (payload as unknown[]) : [];

  for (const item of arr) {
    const flag = String((item as { flagStatus?: unknown } | null)?.flagStatus ?? "");
    if (flag.trim()) return item as RaceStatusRace;
  }

  return null;
}
