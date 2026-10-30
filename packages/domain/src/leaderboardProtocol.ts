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
  | { type: "snapshot"; raceId: number | null; rev: number; data: RaceStatusRace | null }
  /** Diff against the state with `baseRev`; a client whose rev differs must resync. */
  | { type: "patch"; raceId: number; rev: number; baseRev: number; patch: Operation[] }
  | { type: "status"; status: LeaderboardServiceStatus }
  | { type: "error"; code: string; message: string };

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
    progress: number;
    positionMs: number;
    durationMs: number;
  };
  server: { port: number; wsClients: number; restRequestsPerMinute: number };
  race: { currentId: number | null; currentName: string | null; flag: string | null };
};
