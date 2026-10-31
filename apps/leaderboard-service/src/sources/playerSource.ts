/**
 * RecordingPlayer – replays a recording (`<ms> <line>` per line) into the service.
 *
 * - Timing: each line is due at `start + (offset − startOffset) / speedup`, measured against
 *   the wall clock, so long replays do not drift. Lines with the same timestamp go out together.
 * - Seek: the store is deterministic, so seeking = reset + apply every line up to the target
 *   without waiting, then continue in real time.
 * - Gaps: recorders often keep running while Orbits is silent (lunch break, overnight). With
 *   `skipGaps` every pause longer than GAP_THRESHOLD_MS plays as GAP_REPLACEMENT_MS, so a replay
 *   does not sit idle for hours. Position, duration and seek then refer to this shortened timeline.
 * - Encoding: recording files are windows-1252 or UTF-8 depending on the recorder that wrote
 *   them; `auto` detects it per file.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { detectRecordingEncoding, parseRecordingBytes } from "@raceoffice/rmonitor";

/** Orbits sends `$F` every second while it is running; a longer silence is a pause. */
export const GAP_THRESHOLD_MS = 10_000;
/** A skipped pause still takes one heartbeat interval, so the replay keeps its rhythm. */
export const GAP_REPLACEMENT_MS = 1_000;

export type PlayerState = "idle" | "playing" | "paused";

export type PlayerStatus = {
  state: PlayerState;
  file: string | null;
  encoding: string | null;
  speedup: number;
  skipGaps: boolean;
  progress: number;
  positionMs: number;
  durationMs: number;
  linesPlayed: number;
  lineCount: number;
};

export type PlayerEvents = {
  /** One recorded line, decoded with the file encoding. */
  onLine: (raw: Uint8Array, text: string) => void;
  /** Called before a (re)start from the beginning and before a seek: the consumer resets its state. */
  onReset: () => void;
  onStateChange?: (state: PlayerState) => void;
  /** Replay reached the end (state goes back to idle). */
  onEnd?: () => void;
};

/** `recordedMs`: offset in the file; `offsetMs`: offset on the playback timeline. */
type Entry = { recordedMs: number; offsetMs: number; raw: Uint8Array };

export class RecordingPlayer {
  private entries: Entry[] = [];
  private decoder: TextDecoder = new TextDecoder("windows-1252");
  private file: string | null = null;
  private encoding: string | null = null;
  private state: PlayerState = "idle";
  private speedup = 1;
  private skipGaps = true;
  private next = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Wall clock / recording offset pair the timing is anchored to. */
  private anchorWall = 0;
  private anchorOffset = 0;
  private pausedAtOffset = 0;

  constructor(private readonly events: PlayerEvents) {}

  /** Loads a recording; stops a running replay. */
  async load(path: string, fileEncoding = "auto", options: { skipGaps?: boolean } = {}): Promise<void> {
    this.stop();
    const data = await readFile(path);
    const encoding = fileEncoding === "auto" ? detectRecordingEncoding(data) : fileEncoding;
    this.decoder = new TextDecoder(encoding);
    if (options.skipGaps !== undefined) this.skipGaps = options.skipGaps;
    this.entries = parseRecordingBytes(data).map((e) => ({ recordedMs: e.offsetMs, offsetMs: e.offsetMs, raw: e.raw }));
    this.buildTimeline();
    this.file = basename(path);
    this.encoding = encoding;
    this.next = 0;
  }

  get currentState(): PlayerState {
    return this.state;
  }

  get loadedFile(): string | null {
    return this.file;
  }

  status(now = Date.now()): PlayerStatus {
    const durationMs = this.durationMs();
    const positionMs = Math.min(durationMs, Math.max(0, this.currentOffset(now) - this.firstOffset()));
    return {
      state: this.state,
      file: this.file,
      encoding: this.encoding,
      speedup: this.speedup,
      skipGaps: this.skipGaps,
      progress: durationMs > 0 ? positionMs / durationMs : this.next >= this.entries.length && this.file ? 1 : 0,
      positionMs,
      durationMs,
      linesPlayed: this.next,
      lineCount: this.entries.length,
    };
  }

  /** Starts from the beginning (or `startAtMs`), resetting the consumer. */
  start(options: { speedup?: number; startAtMs?: number } = {}): void {
    if (!this.file) throw new Error("no recording loaded");
    this.clearTimer();
    if (options.speedup !== undefined) this.setSpeedup(options.speedup);
    this.seekInternal(options.startAtMs ?? 0);
    this.setState("playing");
    this.anchor(Date.now(), this.currentOffsetAtIndex());
    this.schedule();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedAtOffset = this.currentOffset(Date.now());
    this.clearTimer();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.setState("playing");
    this.anchor(Date.now(), this.pausedAtOffset);
    this.schedule();
  }

  /** Stops the replay; the state of the consumer stays as it is. */
  stop(): void {
    this.clearTimer();
    this.setState("idle");
  }

  setSpeedup(speedup: number): void {
    if (!(speedup > 0)) throw new Error("speedup must be > 0");
    if (this.state === "playing") this.anchor(Date.now(), this.currentOffset(Date.now()));
    this.speedup = speedup;
    if (this.state === "playing") this.schedule();
  }

  /**
   * Switches gap skipping; works while playing. The replay continues at the same point of the
   * recording, only the timeline (position, duration) changes.
   */
  setSkipGaps(skipGaps: boolean): void {
    if (skipGaps === this.skipGaps) return;
    const now = Date.now();
    const recorded = this.toRecorded(this.currentOffset(now));
    this.skipGaps = skipGaps;
    this.buildTimeline();
    const offset = this.fromRecorded(recorded);
    if (this.state === "playing") {
      this.anchor(now, offset);
      this.schedule();
    } else {
      this.pausedAtOffset = offset;
    }
  }

  /** Jumps to a position (ms from the start of the recording); keeps playing/paused. */
  seek(positionMs: number): void {
    if (!this.file) throw new Error("no recording loaded");
    this.clearTimer();
    this.seekInternal(positionMs);
    const offset = this.firstOffset() + Math.max(0, positionMs);
    if (this.state === "playing") {
      this.anchor(Date.now(), offset);
      this.schedule();
    } else {
      this.pausedAtOffset = offset;
      if (this.state === "idle") this.setState("paused");
    }
  }

  private seekInternal(positionMs: number): void {
    this.events.onReset();
    this.next = 0;
    const target = this.firstOffset() + Math.max(0, positionMs);
    while (this.next < this.entries.length && (this.entries[this.next] as Entry).offsetMs <= target) {
      this.emit(this.entries[this.next] as Entry);
      this.next++;
    }
    this.pausedAtOffset = target;
  }

  /** Recomputes the playback offsets from the recorded ones. */
  private buildTimeline(): void {
    let shift = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i] as Entry;
      if (i > 0 && this.skipGaps) {
        const gap = entry.recordedMs - (this.entries[i - 1] as Entry).recordedMs;
        if (gap > GAP_THRESHOLD_MS) shift += gap - GAP_REPLACEMENT_MS;
      }
      entry.offsetMs = entry.recordedMs - shift;
    }
  }

  /** Playback offset → recorded offset. Inside a shortened gap, time runs normally from its start. */
  private toRecorded(offset: number): number {
    return this.mapOffset(offset, "offsetMs", "recordedMs");
  }

  /** Recorded offset → playback offset. Inside a skipped part of a gap, the end of the short gap. */
  private fromRecorded(recorded: number): number {
    return this.mapOffset(recorded, "recordedMs", "offsetMs");
  }

  private mapOffset(value: number, from: "offsetMs" | "recordedMs", to: "offsetMs" | "recordedMs"): number {
    const entries = this.entries;
    if (entries.length === 0) return value;
    // Last entry at or before `value` (binary search; entries are sorted on both timelines).
    let lo = 0;
    let hi = entries.length - 1;
    if (value < (entries[0] as Entry)[from]) return (entries[0] as Entry)[to] - ((entries[0] as Entry)[from] - value);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((entries[mid] as Entry)[from] <= value) lo = mid;
      else hi = mid - 1;
    }
    const prev = entries[lo] as Entry;
    const next = entries[lo + 1];
    const elapsed = value - prev[from];
    const limit = next ? next[to] - prev[to] : Infinity;
    return prev[to] + Math.min(elapsed, limit);
  }

  private schedule(): void {
    this.clearTimer();
    if (this.state !== "playing") return;
    const entry = this.entries[this.next];
    if (!entry) {
      this.finish();
      return;
    }
    const due = this.anchorWall + (entry.offsetMs - this.anchorOffset) / this.speedup;
    this.timer = setTimeout(() => this.tick(), Math.max(0, due - Date.now()));
  }

  private tick(): void {
    this.timer = null;
    if (this.state !== "playing") return;
    const first = this.entries[this.next];
    if (!first) return this.finish();
    // Emit everything that is due by now (catches up if the event loop was busy).
    const dueOffset = this.currentOffset(Date.now());
    while (this.next < this.entries.length) {
      const entry = this.entries[this.next] as Entry;
      if (entry.offsetMs > dueOffset && entry.offsetMs !== first.offsetMs) break;
      this.emit(entry);
      this.next++;
    }
    this.schedule();
  }

  private finish(): void {
    this.clearTimer();
    this.pausedAtOffset = this.lastOffset();
    this.setState("idle");
    this.events.onEnd?.();
  }

  private emit(entry: Entry): void {
    this.events.onLine(entry.raw, this.decoder.decode(entry.raw));
  }

  private anchor(wall: number, offset: number): void {
    this.anchorWall = wall;
    this.anchorOffset = offset;
  }

  private currentOffset(now: number): number {
    if (this.state === "playing") return this.anchorOffset + (now - this.anchorWall) * this.speedup;
    return this.pausedAtOffset;
  }

  private currentOffsetAtIndex(): number {
    return this.pausedAtOffset;
  }

  private firstOffset(): number {
    return this.entries[0]?.offsetMs ?? 0;
  }

  private lastOffset(): number {
    return this.entries.at(-1)?.offsetMs ?? 0;
  }

  private durationMs(): number {
    return Math.max(0, this.lastOffset() - this.firstOffset());
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange?.(state);
  }
}
