// recording.ts
//
// Recordings of real races from the timing system (see cli/recordRaceStatus.ts).
//
// Real races contain constellations nobody thinks of when writing synthetic states (ties,
// riders dropping out of the feed, flag changes mid-lap). A recording polls the raw feed
// once per second and keeps only states whose scoring-relevant content changed (see
// relevantStateKey); tests then pick the states they need.
//
// File format (JSON Lines, one object per line):
//   {"t": <ms since recording start>, "payload": <raw feed response, i.e. array of races>}

import { pickCurrentRace, type RaceStatusRace } from "@raceoffice/domain";

export type RecordingFrame = {
  /** Milliseconds since the recording started. */
  t: number;
  /** Raw feed response (array of races), as received. */
  payload: unknown;
};

/** Parses a JSON Lines recording; blank lines are ignored. */
export function parseRecording(text: string): RecordingFrame[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      const frame = JSON.parse(line) as RecordingFrame;
      if (typeof frame?.t !== "number" || !("payload" in frame)) {
        throw new Error(`Invalid recording line ${i + 1}`);
      }
      return frame;
    });
}

export function serializeFrame(frame: RecordingFrame): string {
  return JSON.stringify(frame);
}

/**
 * Fingerprint of the scoring-relevant part of a feed response. Two responses with the same
 * key are the same state for RaceOffice, even if the raw JSON differs.
 *
 * Relevant: which race is active (id, name), flag, race lap counter (lapsComplete, lapsToGo)
 * and per rider bib, position, completed laps, total time and name (riders joining or
 * leaving the feed included).
 * Ignored: the running clock (elapsedTime, timeOfDay) and fields RaceOffice does not use
 * (bestLap, lastLap, qualiPosition, track data). In a real race about 9 of 10 responses
 * differ from the previous one only by the clock.
 */
export function relevantStateKey(payload: unknown): string {
  const race = pickCurrentRace(payload);
  if (!race) return "no-active-race";

  const competitors = (Array.isArray(race.competitors) ? race.competitors : [])
    .map((c) => [c?.number, c?.position, c?.lapsComplete, c?.totalTime, c?.firstName, c?.lastName])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  return JSON.stringify([race.raceID, race.raceName, race.flagStatus, race.lapsComplete, race.lapsToGo, competitors]);
}

/** Keeps the first frame and every frame whose relevant state differs from the one before. */
export function compactRecording(frames: RecordingFrame[]): RecordingFrame[] {
  const kept: RecordingFrame[] = [];
  let lastKey: string | null = null;
  for (const frame of frames) {
    const key = relevantStateKey(frame.payload);
    if (key === lastKey) continue;
    kept.push(frame);
    lastKey = key;
  }
  return kept;
}

/**
 * Which race lap a response belongs to: active race + race lap counter. Responses without
 * an active race form their own group.
 */
export function lapKey(payload: unknown): string {
  const race = pickCurrentRace(payload);
  return race ? JSON.stringify([race.raceID, race.lapsComplete ?? null]) : "no-active-race";
}

/**
 * One state per race lap: the LAST relevant state of each lap, i.e. the field as it stood
 * (last position change) right before the next lap started.
 *
 * Groups are consecutive runs of the same lap, not distinct lap numbers: when the timing
 * system corrects the lap counter (e.g. a finish-line passing recorded at the start and
 * deleted by the timekeepers: lap 1 -> 0 -> 1), each run keeps its own state, so the
 * correction stays visible in the recording.
 */
export function compactRecordingPerLap(frames: RecordingFrame[]): RecordingFrame[] {
  const kept: RecordingFrame[] = [];
  let pending: RecordingFrame | null = null;

  for (const frame of compactRecording(frames)) {
    if (pending && lapKey(frame.payload) !== lapKey(pending.payload)) kept.push(pending);
    pending = frame;
  }
  if (pending) kept.push(pending);
  return kept;
}

/** The active race of each frame (null where the timing system reported none). */
export function racesOf(frames: RecordingFrame[]): Array<RaceStatusRace | null> {
  return frames.map((f) => pickCurrentRace(f.payload));
}

/**
 * First recorded state whose active race matches `predicate`, e.g. the first state of lap 12:
 * `findRace(frames, (r) => r.lapsComplete === 12)`. Throws if none matches, so a test that
 * relies on a constellation fails clearly when the recording does not contain it.
 */
export function findRace(frames: RecordingFrame[], predicate: (race: RaceStatusRace) => boolean): RaceStatusRace {
  for (const race of racesOf(frames)) {
    if (race && predicate(race)) return race;
  }
  throw new Error("No recorded race state matches the predicate");
}

/**
 * Replaces rider names with neutral placeholders ("Rider" / "<bib>"), keeping bibs, positions,
 * laps, times and the nation suffix. Use it before committing recordings of real athletes.
 */
export function anonymizePayload(payload: unknown): unknown {
  if (!Array.isArray(payload)) return payload;

  return payload.map((race) => {
    const competitors = Array.isArray((race as RaceStatusRace | null)?.competitors) ? (race as RaceStatusRace).competitors : null;
    if (!competitors) return race;

    return {
      ...(race as RaceStatusRace),
      competitors: competitors.map((c) => {
        const nation = String(c?.lastName ?? "").match(/\s*\([A-Z]{3}\)\s*$/)?.[0]?.trim() ?? "";
        return { ...c, firstName: "Rider", lastName: nation ? `${c.number} ${nation}` : String(c.number) };
      }),
    };
  });
}
