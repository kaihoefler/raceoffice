/**
 * RaceStateStore – port of the Java `RaceManager`, without singletons and PropertyChangeSupport.
 *
 * Rules (unchanged from Java, verified by the golden tests):
 * - `$B` with an id different from the current race → start a new race, then take over id/name.
 *   A repeated `$B` with the same id only updates the name and resets the flag.
 * - `$I` ALWAYS starts a new race (no id check). The fresh race has id -1 and is neither stored
 *   nor becomes `previous`; competitors sent between `$I` and the next `$B` are lost when that
 *   `$B` starts yet another race – exactly like Java.
 * - Starting a new race sets the old one to FINISH; it becomes `previous` only if it had an id.
 * - `$G` with position 1 sets the race's `lapsComplete`.
 * - `$C` updates the class map (store-owned instead of Java's static map).
 *
 * Deviations: races are capped (`maxRaces`, oldest dropped first) and `apply` reports what changed.
 */
import { parseJavaFloat } from "../duration.js";
import type { RMonitorMessage } from "../messages/types.js";
import { NO_RACE_ID, RaceState } from "./model.js";

export type StoreChange = {
  /** The message changed the store (false for unknown/invalid lines). */
  changed: boolean;
  /** A new current race object was started (`$I`, or `$B` with a new id). */
  newRace: boolean;
};

export type RaceStateStoreOptions = {
  /** Maximum number of stored races; the oldest is dropped first. Default 50. */
  maxRaces?: number;
};

const SETTING_TRACKNAME = "TRACKNAME";
const SETTING_TRACK_LENGTH = "TRACKLENGTH";

export class RaceStateStore {
  private readonly maxRaces: number;
  private races = new Map<number, RaceState>();
  private classes = new Map<number, string>();
  private currentRace = new RaceState();
  private previousRace: RaceState | null = null;
  private revision = 0;

  constructor(options: RaceStateStoreOptions = {}) {
    this.maxRaces = Math.max(1, options.maxRaces ?? 50);
  }

  /** The race messages are applied to (Java `getCurrentRace`); id -1 until the first `$B`. */
  get current(): RaceState {
    return this.currentRace;
  }

  get previous(): RaceState | null {
    return this.previousRace;
  }

  /** Increases with every applied (non-ignored) message. */
  get rev(): number {
    return this.revision;
  }

  /** All stored races (races with an id), ordered by id. */
  get all(): RaceState[] {
    return [...this.races.values()].sort((a, b) => a.id - b.id);
  }

  getById(id: number): RaceState | null {
    return this.races.get(id) ?? null;
  }

  getClassName(classId: number): string {
    return this.classes.get(classId) ?? "";
  }

  /**
   * The race the REST API publishes as "current" (Java `JsonServer.getRaceToReturn`):
   * the current race if it has an id, otherwise the previous race, otherwise the empty current race.
   */
  get displayRace(): RaceState {
    if (this.currentRace.id !== NO_RACE_ID) return this.currentRace;
    return this.previousRace ?? this.currentRace;
  }

  reset(): void {
    this.races = new Map();
    this.classes = new Map();
    this.currentRace = new RaceState();
    this.previousRace = null;
    this.revision++;
  }

  apply(msg: RMonitorMessage): StoreChange {
    const race = this.currentRace;
    let newRace = false;

    switch (msg.kind) {
      case "heartbeat":
        race.setFlagStatus(msg.flag);
        race.lapsToGo = msg.lapsToGo;
        race.scheduledLaps = race.lapsComplete + race.lapsToGo;
        race.elapsedMs = msg.raceTimeMs;
        race.timeToGoMs = msg.timeToGoMs;
        race.timeOfDayMs = msg.timeOfDayMs;
        race.scheduledTimeMs = race.elapsedMs + race.timeToGoMs;
        break;

      case "runInfo": {
        if (race.id !== msg.uniqueId) {
          this.startNewRace();
          newRace = true;
        }
        const r = this.currentRace;
        r.id = msg.uniqueId;
        r.name = msg.description;
        r.setFlagStatus("");
        if (r.id !== NO_RACE_ID) this.storeRace(r);
        break;
      }

      case "settingInfo":
        if (msg.description === SETTING_TRACKNAME) race.trackName = msg.value;
        if (msg.description === SETTING_TRACK_LENGTH) {
          // Java: Float.parseFloat throws → message dropped, trackName above is unaffected (different key).
          try {
            race.trackLength = parseJavaFloat(msg.value);
          } catch {
            return { changed: false, newRace: false };
          }
        }
        break;

      case "initRecord":
        this.startNewRace();
        newRace = true;
        break;

      case "raceInfo":
        race.getOrCreateCompetitor(msg.regNumber).applyRaceInfo(msg);
        if (msg.position === 1) race.lapsComplete = msg.laps;
        break;

      case "compInfo":
        race.getOrCreateCompetitor(msg.regNumber).applyCompInfo(msg);
        break;

      case "lapInfo":
        race.getOrCreateCompetitor(msg.regNumber).applyLapInfo(msg);
        break;

      case "qualiInfo":
        race.getOrCreateCompetitor(msg.regNumber).applyQualiInfo(msg);
        break;

      case "classInfo":
        this.classes.set(msg.classId, msg.description);
        break;

      case "passingInfo":
        race.getOrCreateCompetitor(msg.regNumber).applyPassingInfo(msg);
        break;

      case "unknown":
      case "invalid":
        return { changed: false, newRace: false };
    }

    this.revision++;
    return { changed: true, newRace };
  }

  private startNewRace(): void {
    const old = this.currentRace;
    old.setFlagStatus("FINISH");
    if (old.id !== NO_RACE_ID) {
      this.storeRace(old);
      this.previousRace = old;
    }
    this.currentRace = new RaceState();
  }

  private storeRace(race: RaceState): void {
    // Re-insert to keep the map in "last touched" order for the cap.
    this.races.delete(race.id);
    this.races.set(race.id, race);
    while (this.races.size > this.maxRaces) {
      const oldestId = this.races.keys().next().value;
      if (oldestId === undefined) break;
      const oldest = this.races.get(oldestId);
      // Never drop the race that is still current or previous.
      if (oldest === this.currentRace || oldest === this.previousRace) {
        this.races.delete(oldestId);
        this.races.set(oldestId, oldest);
        if (this.races.size <= 2) break;
        continue;
      }
      this.races.delete(oldestId);
    }
  }
}
