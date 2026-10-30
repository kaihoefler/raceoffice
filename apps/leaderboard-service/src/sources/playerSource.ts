/**
 * RecordingPlayer – replays a recording (`<ms> <line>` per line) into the service.
 *
 * - Timing: each line is due at `start + (offset − startOffset) / speedup`, measured against
 *   the wall clock, so long replays do not drift. Lines with the same timestamp go out together.
 * - Seek: the store is deterministic, so seeking = reset + apply every line up to the target
 *   without waiting, then continue in real time.
 * - Encoding: recording files are windows-1252 or UTF-8 depending on the recorder that wrote
 *   them; `auto` detects it per file.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { detectRecordingEncoding, parseRecordingBytes } from "@raceoffice/rmonitor";

export type PlayerState = "idle" | "playing" | "paused";

export type PlayerStatus = {
  state: PlayerState;
  file: string | null;
  encoding: string | null;
  speedup: number;
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

type Entry = { offsetMs: number; raw: Uint8Array };

export class RecordingPlayer {
  private entries: Entry[] = [];
  private decoder: TextDecoder = new TextDecoder("windows-1252");
  private file: string | null = null;
  private encoding: string | null = null;
  private state: PlayerState = "idle";
  private speedup = 1;
  private next = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Wall clock / recording offset pair the timing is anchored to. */
  private anchorWall = 0;
  private anchorOffset = 0;
  private pausedAtOffset = 0;

  constructor(private readonly events: PlayerEvents) {}

  /** Loads a recording; stops a running replay. */
  async load(path: string, fileEncoding = "auto"): Promise<void> {
    this.stop();
    const data = await readFile(path);
    const encoding = fileEncoding === "auto" ? detectRecordingEncoding(data) : fileEncoding;
    this.decoder = new TextDecoder(encoding);
    this.entries = parseRecordingBytes(data).map((e) => ({ offsetMs: e.offsetMs, raw: e.raw }));
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
