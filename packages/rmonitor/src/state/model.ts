/**
 * Race state model, ported from the Java entities `Race`, `Competitor` and `Lap`.
 *
 * The update rules are kept 1:1 because the scoring relies on the exact values the Java app
 * publishes. Differences to Java are listed in packages/rmonitor/README.md.
 */
import type {
  CompInfoMessage,
  LapInfoMessage,
  PassingInfoMessage,
  QualiInfoMessage,
  RaceInfoMessage,
} from "../messages/types.js";

export type FlagStatus = "PURPLE" | "GREEN" | "YELLOW" | "RED" | "FINISH" | "NONE";

/** Java `Race` id before the first `$B`; such a race is not stored and not published as current. */
export const NO_RACE_ID = -1;

export type LapState = {
  lapNumber: number;
  position: number;
  /** `null` = not set (Java leaves the field null for laps created from `$SP`/`$SR`). */
  lapTimeMs: number | null;
  totalTimeMs: number | null;
};

export class CompetitorState {
  regNumber = "";
  transNumber: string | null = "";
  number = "";
  firstName = "";
  lastName = "";
  nationality = "";
  classId = 0;
  addData: string | null = "";
  totalTimeMs = 0;
  bestLapMs = 0;
  lastLapMs = 0;
  avgLapMs = 0;
  lapsComplete = 0;
  position = 0;
  qualiPosition = 0;
  private readonly laps: LapState[] = [];

  /** Lap list as built by the Java update rules (diagnostics, tests). */
  get lapList(): readonly LapState[] {
    return this.laps;
  }

  applyCompInfo(msg: CompInfoMessage): void {
    this.regNumber = msg.regNumber;
    this.number = msg.number;
    this.transNumber = msg.transNumber;
    this.firstName = msg.firstName;
    this.lastName = msg.lastName;
    this.classId = msg.classId;
    if (msg.nationality !== "") this.nationality = msg.nationality;
    // Java: `!"".equals(addInfo)` is also true for null ($A), so $A resets addData to null.
    if (msg.addData !== "") this.addData = msg.addData;
  }

  applyQualiInfo(msg: QualiInfoMessage): void {
    this.regNumber = msg.regNumber;
    this.qualiPosition = msg.position;
    this.updateBestLap(msg.bestLapTimeMs);
  }

  applyLapInfo(msg: LapInfoMessage): void {
    let found = false;
    for (const lap of this.laps) {
      if (lap.lapNumber === msg.lapNumber) {
        found = true;
        lap.lapTimeMs = msg.lapTimeMs;
        lap.position = msg.position;
      }
    }
    if (!found) {
      this.laps.push({ lapNumber: msg.lapNumber, position: msg.position, lapTimeMs: msg.lapTimeMs, totalTimeMs: null });
    }
    this.updateAvgLap();

    if (msg.lapNumber === this.lapsComplete) this.lastLapMs = msg.lapTimeMs;
    this.updateBestLap(msg.lapTimeMs);
  }

  applyPassingInfo(msg: PassingInfoMessage): void {
    const lap = this.findOrCreateLap(msg.totalTimeMs);
    lap.lapTimeMs = msg.lapTimeMs;
    this.lastLapMs = msg.lapTimeMs;
    this.totalTimeMs = msg.totalTimeMs;
    this.updateBestLap(msg.lapTimeMs);
    this.updateAvgLap();
  }

  applyRaceInfo(msg: RaceInfoMessage): void {
    const lap = this.findOrCreateLap(msg.totalTimeMs);
    lap.lapNumber = msg.laps;
    lap.position = msg.position;
    this.regNumber = msg.regNumber;
    this.position = msg.position;
    this.lapsComplete = msg.laps;
    this.totalTimeMs = msg.totalTimeMs;
    this.updateAvgLap();
  }

  private findOrCreateLap(totalTimeMs: number): LapState {
    const existing = this.laps.find((l) => l.totalTimeMs === totalTimeMs);
    if (existing) return existing;
    const lap: LapState = { lapNumber: 0, position: 0, lapTimeMs: null, totalTimeMs };
    this.laps.push(lap);
    return lap;
  }

  /** Java: replace if no best lap yet (zero) or strictly faster – a zero lap time can therefore overwrite. */
  private updateBestLap(lapTimeMs: number): void {
    if (this.bestLapMs === 0 || lapTimeMs < this.bestLapMs) this.bestLapMs = lapTimeMs;
  }

  /** Average over laps with a lap number > 0 and a known lap time (Java `Duration.dividedBy`, truncated to ns). */
  private updateAvgLap(): void {
    let sum = 0;
    let count = 0;
    for (const lap of this.laps) {
      if (lap.lapNumber > 0 && lap.lapTimeMs !== null) {
        sum += lap.lapTimeMs;
        count++;
      }
    }
    this.avgLapMs = count > 0 ? Math.floor((sum * 1e6) / count) / 1e6 : 0;
  }
}

export class RaceState {
  id = NO_RACE_ID;
  name = "";
  trackName = "";
  trackLength = 0;
  flagStatus: FlagStatus = "NONE";
  lapsComplete = 0;
  lapsToGo = 0;
  /** Derived in Java on every heartbeat: lapsComplete + lapsToGo (not part of the REST format). */
  scheduledLaps = 0;
  timeOfDayMs = 0;
  elapsedMs = 0;
  timeToGoMs = 0;
  /** Derived in Java on every heartbeat: elapsed + timeToGo (not part of the REST format). */
  scheduledTimeMs = 0;
  /** Insertion order = first appearance; key: regNumber. */
  readonly competitors = new Map<string, CompetitorState>();

  getOrCreateCompetitor(regNumber: string): CompetitorState {
    let c = this.competitors.get(regNumber);
    if (!c) {
      c = new CompetitorState();
      this.competitors.set(regNumber, c);
    }
    return c;
  }

  getCompetitorByPosition(position: number): CompetitorState | null {
    for (const c of this.competitors.values()) if (c.position === position) return c;
    return null;
  }

  /** Fastest best lap of all competitors, 0 if none (Java `getFastestLap`). */
  get fastestLapMs(): number {
    let best = 0;
    for (const c of this.competitors.values()) {
      if (c.bestLapMs !== 0 && (best === 0 || c.bestLapMs < best)) best = c.bestLapMs;
    }
    return best;
  }

  /** 1 + number of competitors in the same class with a smaller position (Java `calcPositionInClass`). */
  calcPositionInClass(competitor: CompetitorState): number {
    let ahead = 0;
    for (const c of this.competitors.values()) {
      if (c.classId === competitor.classId && c.position < competitor.position) ahead++;
    }
    return ahead + 1;
  }

  /**
   * Java `Race.convertFlagStatus`: case-insensitive GREEN/YELLOW/RED/FINISH; everything else
   * (including an empty flag and "PURPLE") becomes PURPLE – except for a race with id 0 and an
   * empty name, which becomes NONE. A race with an empty heartbeat flag is therefore PURPLE.
   */
  setFlagStatus(flag: string): void {
    switch (flag.toUpperCase()) {
      case "GREEN":
        this.flagStatus = "GREEN";
        break;
      case "YELLOW":
        this.flagStatus = "YELLOW";
        break;
      case "RED":
        this.flagStatus = "RED";
        break;
      case "FINISH":
        this.flagStatus = "FINISH";
        break;
      default:
        this.flagStatus = this.name === "" && this.id === 0 ? "NONE" : "PURPLE";
    }
  }
}
