/**
 * PassingLog – ring buffer of line crossings for the finish line log
 * (doc/leaderboard-integration/06-frontend.md, section 7).
 *
 * The race state only keeps the latest values per rider; the log needs the events. It follows
 * the messages after the store has applied them:
 * - `$J` (passingInfo) creates an entry with lap and total time
 * - the `$G` (raceInfo) Orbits sends right after it fills in position and lap count; a later `$G`
 *   with the same lap and total time corrects the position (see below)
 * - `$COR` marks the entry of the corrected lap and updates its total time
 *
 * Order: Orbits does not send the passings of a group in crossing order – the decoder hands them
 * over in batches (~0.2 s). Example AGI 2024, Senior Men Points-Final B, lap 4: arrival order
 * 761, 865, 788, 894, 868, crossing order 865 (1:13.335), 868 (1:13.461), 761 (1:13.490), …
 * The total time is the race time at the line, so the log is ordered by it (`crossingMs`), not by
 * arrival. Orbits then also corrects positions: 761 first got 30, then 31 once 868 was in.
 *
 * Per race at most `perRace` entries (oldest dropped), at most `maxRaces` races.
 */
import type { LeaderboardPassing } from "@raceoffice/domain";
import { formatDuration, NO_RACE_ID, type RaceStateStore, type RMonitorMessage } from "@raceoffice/rmonitor";

export type PassingEvent = { type: "passing"; raceId: number; passing: LeaderboardPassing } | { type: "reset" };

/** Crossing order: race time at the line, arrival as tie-breaker. */
export function comparePassings(a: LeaderboardPassing, b: LeaderboardPassing): number {
  return a.crossingMs - b.crossingMs || a.seq - b.seq;
}

export class PassingLog {
  /** Per race in arrival order (the ring buffer drops the oldest arrivals). */
  private races = new Map<number, LeaderboardPassing[]>();
  private seq = 0;
  private readonly listeners = new Set<(event: PassingEvent) => void>();

  constructor(
    private readonly perRace = 500,
    private readonly maxRaces = 20,
  ) {}

  /** Buffered passings of a race in crossing order. */
  list(raceId: number): LeaderboardPassing[] {
    return [...(this.races.get(raceId) ?? [])].sort(comparePassings);
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
          number: rider?.number || msg.regNumber,
          firstName: rider?.firstName || "",
          lastName: rider?.lastName || "",
          timeOfDay: formatDuration(race.timeOfDayMs),
          elapsedTime: formatDuration(race.elapsedMs),
          crossingMs: msg.totalTimeMs,
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
        if (!passing) return;
        if (passing.position === null) {
          // The $G belonging to the passing.
          passing.position = msg.position;
          passing.lap = msg.laps;
        } else if (msg.laps === passing.lap && msg.totalTimeMs === passing.crossingMs && msg.position !== passing.position) {
          // Same lap and time: Orbits re-ranks the group after a later-arriving passing.
          passing.position = msg.position;
        } else {
          // A later position change of the rider (others passing) – not part of this crossing.
          return;
        }
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
          // The corrected time is the photo-finish result: it decides the order, and the $G that
          // follows carries it, so position updates keep matching.
          passing.crossingMs = msg.correctedTotalTimeMs;
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
