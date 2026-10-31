// src/domain/liveTime.ts
//
// Time parsing/formatting for live feed times (e.g. "0:15.032").
// LiveRaceStatus shows the leader's total time and, for everybody else, the gap to the
// leader in German notation ("+0,032", "+1:02,500").
// The implementation lives in @raceoffice/domain (shared with the leaderboard frontend).
export { formatDeltaSeconds, parseTimeToSeconds } from "@raceoffice/domain";
