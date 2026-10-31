/**
 * leaderboardProtocol
 * -------------------
 * Contract between the leaderboard service and its clients (scoring frontend, leaderboard
 * frontend): WebSocket race stream (snapshot + JSON-Patch diffs) and service status.
 * See doc/leaderboard-integration/04-service-api.md.
 *
 * Types only; the service and the clients implement the behavior.
 */
import type { Operation } from "fast-json-patch";
import type { RaceStatusRace } from "./raceStatusFeed.js";

/** Messages from the service on `/ws/race/current` and `/ws/race/:id` (server → client). */
export type LeaderboardWsMessage =
  /** Full state; sent on connect, on race change and after a resync. `data` is null without a race. */
  | { type: "snapshot"; raceId: number | null; rev: number; data: RaceStatusRace | null; timeOfDay?: string }
  /** Diff against the state with `baseRev`; a client whose rev differs must resync. */
  | { type: "patch"; raceId: number; rev: number; baseRev: number; patch: Operation[]; timeOfDay?: string }
  | { type: "status"; status: LeaderboardServiceStatus }
  /** `/ws/race/current/passings`: all buffered passings of the race; on connect, race change and reset. */
  | { type: "passings"; raceId: number | null; passings: LeaderboardPassing[] }
  /** A new passing, or an update of one already sent (same `seq`: position, lap, correction). */
  | { type: "passing"; raceId: number; passing: LeaderboardPassing }
  | { type: "error"; code: string; message: string };

/**
 * One line crossing (`$J`) for the finish line log. Orbits sends `$G` (position, laps) right
 * after `$J`, so `position`/`lap` are filled in by an update with the same `seq`.
 * Times use the format of the REST feed ("m:ss.SSS"); a lap time "0:00" is the first crossing.
 * Order by `crossingMs`: Orbits sends the passings of a group in batches, not in crossing order.
 */
export type LeaderboardPassing = {
  /** Increasing per service run; identifies the passing for updates. */
  seq: number;
  raceId: number;
  regNumber: string;
  number: string;
  firstName: string;
  lastName: string;
  /** Time of day of the timing system (last heartbeat) when the passing arrived. */
  timeOfDay: string;
  /** Race time (last heartbeat) when the passing arrived. */
  elapsedTime: string;
  /** Race time at the line in ms (total time, corrected by `$COR`): the crossing order. */
  crossingMs: number;
  lapTime: string;
  totalTime: string;
  lap: number | null;
  position: number | null;
  /** Photo-finish correction (`$COR`) of this lap: shift of the total time in ms. */
  correctionMs?: number;
};

/*
 * `timeOfDay` on snapshot/patch: time of day of the latest `$F` heartbeat. After a race Orbits
 * resets (`$I`) and the feed keeps showing the finished race (Java behaviour, needed by the
 * scoring) whose own `timeOfDay` stays frozen; this field keeps running.
 */

/** Optional client → server message: request a fresh snapshot. */
export type LeaderboardWsClientMessage = { type: "resync" };

export type LeaderboardSource = "none" | "rmonitor" | "player";

/** Status of the leaderboard service (`GET /api/status`, `/ws/status`). */
export type LeaderboardServiceStatus = {
  version: string;
  mode: "managed" | "standalone";
  source: LeaderboardSource;
  client: {
    state: "stopped" | "connecting" | "connected" | "retrying" | "error";
    host: string;
    port: number;
    encoding: string;
    lastMessageAt: number | null;
    messagesPerMinute: number;
    retry: { attempt: number; max: number; nextAttemptAt: number | null };
    lastError: string | null;
  };
  recorder: { active: boolean; file: string | null; lines: number; startedAt: number | null };
  player: {
    state: "idle" | "playing" | "paused";
    file: string | null;
    speedup: number;
    /** Pauses > 10 s in the recording are played as 1 s; position/duration refer to that timeline. */
    skipGaps?: boolean;
    progress: number;
    positionMs: number;
    durationMs: number;
    /** Encoding used for the loaded recording file (detected or configured). */
    encoding?: string | null;
    linesPlayed?: number;
    lineCount?: number;
  };
  server: { port: number; wsClients: number; restRequestsPerMinute: number };
  race: { currentId: number | null; currentName: string | null; flag: string | null };
};
