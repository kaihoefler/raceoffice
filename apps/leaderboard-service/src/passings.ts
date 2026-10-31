/**
 * PassingLog – ring buffer of line crossings for the finish line log
 * (doc/leaderboard-integration/06-frontend.md, section 7).
 *
 * The race state only keeps the latest values per rider; the log needs the events. It follows
 * the messages after the store has applied them:
 * - `$J` (passingInfo) creates an entry with lap and total time
 * - the `$G` (raceInfo) Orbits sends right after it fills in position and lap count
 * - `$COR` marks the entry of the corrected lap and updates its total time
 *
 * Per race at most `perRace` entries (oldest dropped), at most `maxRaces` races.
 */
import type { LeaderboardPassing } from "@raceoffice/domain";
import { formatDuration, NO_RACE_ID, type RaceStateStore, type RMonitorMessage } from "@raceoffice/rmonitor";

export type PassingEvent = { type: "passing"; raceId: number; passing: LeaderboardPassing } | { type: "reset" };

export class PassingLog {
  private races = new Map<number, LeaderboardPassing[]>();
  private seq = 0;
  private readonly listeners = new Set<(event: PassingEvent) => void>();

  constructor(
    private readonly perRace = 500,
    private readonly maxRaces = 20,
  ) {}

  /** Buffered passings of a race, oldest first. */
  list(raceId: number): LeaderboardPassing[] {
    return [...(this.races.get(raceId) ?? [])];
  }

  subscribe(listener: (event: PassingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.races = new Map();
    this.emit({ type: "reset" });
  }

  /** Call after `store.apply(msg)`. */
  observe(store: RaceStateStore, msg: RMonitorMessage): void {
    const race = store.current;
    if (race.id === NO_RACE_ID) return;
    switch (msg.kind) {
      case "passingInfo": {
        const rider = race.competitors.get(msg.regNumber);
        const passing: LeaderboardPassing = {
          seq: ++this.seq,
          raceId: race.id,
          regNumber: msg.regNumber,
          number: rider?.number ?? msg.regNumber,
          firstName: rider?.firstName ?? "",
          lastName: rider?.lastName ?? "",
          timeOfDay: formatDuration(race.timeOfDayMs),
          elapsedTime: formatDuration(race.elapsedMs),
          lapTime: formatDuration(msg.lapTimeMs),
          totalTime: formatDuration(msg.totalTimeMs),
          lap: null,
          position: null,
        };
        this.append(race.id, passing);
        break;
      }
      case "raceInfo": {
        const passing = this.latest(race.id, msg.regNumber);
        // Only the $G belonging to the passing; later $G (position changes of others) do not touch it.
        if (!passing || passing.position !== null) return;
        passing.position = msg.position;
        passing.lap = msg.laps;
        this.emit({ type: "passing", raceId: race.id, passing: { ...passing } });
        break;
      }
      case "correction": {
        const entries = this.races.get(race.id) ?? [];
        for (let i = entries.length - 1; i >= 0; i--) {
          const passing = entries[i] as LeaderboardPassing;
          if (passing.regNumber !== msg.regNumber || passing.lap !== msg.lap) continue;
          passing.correctionMs = msg.deltaMs;
          passing.totalTime = formatDuration(msg.correctedTotalTimeMs);
          this.emit({ type: "passing", raceId: race.id, passing: { ...passing } });
          break;
        }
        break;
      }
      default:
        break;
    }
  }

  private append(raceId: number, passing: LeaderboardPassing): void {
    let entries = this.races.get(raceId);
    if (!entries) {
      entries = [];
      this.races.set(raceId, entries);
      // Map keeps insertion order: the first key is the oldest race.
      while (this.races.size > this.maxRaces) this.races.delete(this.races.keys().next().value as number);
    }
    entries.push(passing);
    if (entries.length > this.perRace) entries.splice(0, entries.length - this.perRace);
    this.emit({ type: "passing", raceId, passing: { ...passing } });
  }

  private latest(raceId: number, regNumber: string): LeaderboardPassing | null {
    const entries = this.races.get(raceId) ?? [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if ((entries[i] as LeaderboardPassing).regNumber === regNumber) return entries[i] as LeaderboardPassing;
    }
    return null;
  }

  private emit(event: PassingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
