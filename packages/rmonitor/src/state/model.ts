/**
 * Race state model, ported from the Java entities `Race`, `Competitor` and `Lap`.
 *
 * The update rules are kept 1:1 because the scoring relies on the exact values the Java app
 * publishes. Differences to Java are listed in packages/rmonitor/README.md.
 */
import type {
  CompInfoMessage,
  CorrectionMessage,
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

  /**
   * `$COR` (not in Java): applies a corrected total time of lap `msg.lap`, typically the finish
   * lap after a photo finish. Updates the lap entry, total time, last lap and – if affected –
   * best lap. The `$G` Orbits sends right after it then finds the corrected lap instead of
   * creating a duplicate (Java behavior without `$COR` handling).
   */
  applyCorrection(msg: CorrectionMessage): void {
    const target = this.lastLapWithTotal(msg.lap);
    const previous = msg.lap > 1 ? this.lastLapWithTotal(msg.lap - 1) : undefined;
    const isCurrentLap = msg.lap === this.lapsComplete;

    const oldTotal = target?.totalTimeMs ?? (isCurrentLap ? this.totalTimeMs : null);
    const oldLap = target ? target.lapTimeMs : isCurrentLap ? this.lastLapMs : null;
    const corrected = msg.correctedTotalTimeMs;

    let newLap = oldLap;
    if (previous?.totalTimeMs != null) {
      newLap = corrected - previous.totalTimeMs;
    } else if (oldLap !== null && oldLap > 0) {
      // First lap or previous lap unknown: shift by the total difference (or the sent delta).
      newLap = oldLap + (oldTotal !== null ? corrected - oldTotal : msg.deltaMs);
    }

    if (target) {
      target.totalTimeMs = corrected;
      target.lapTimeMs = newLap;
    }
    if (isCurrentLap || (oldTotal !== null && this.totalTimeMs === oldTotal)) {
      this.totalTimeMs = corrected;
      if (oldLap !== null && newLap !== null && this.lastLapMs === oldLap) this.lastLapMs = newLap;
    }
    if (newLap !== null && newLap > 0) {
      if (oldLap !== null && this.bestLapMs === oldLap) this.bestLapMs = this.minLapTime();
      else this.updateBestLap(newLap);
    }

    this.corrections.push({ lap: msg.lap, deltaMs: msg.deltaMs, correctedTotalTimeMs: corrected });
    this.updateAvgLap();
  }

  /** `$COR` corrections received for this competitor (not part of the Java REST format). */
  readonly corrections: Array<{ lap: number; deltaMs: number; correctedTotalTimeMs: number }> = [];

  private lastLapWithTotal(lapNumber: number): LapState | undefined {
    for (let i = this.laps.length - 1; i >= 0; i--) {
      const lap = this.laps[i] as LapState;
      if (lap.lapNumber === lapNumber && lap.totalTimeMs !== null) return lap;
    }
    return undefined;
  }

  private minLapTime(): number {
    let best = 0;
    for (const lap of this.laps) {
      const t = lap.lapTimeMs;
      if (lap.lapNumber > 0 && t !== null && t > 0 && (best === 0 || t < best)) best = t;
    }
    return best;
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
