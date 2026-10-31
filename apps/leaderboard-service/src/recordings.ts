/**
 * Recorder and recording library in `<dataDir>/recordings`.
 *
 * Recorder: writes the live RMonitor lines in the format of the Java app
 * (`<ms since first line> <raw line>`, CRLF), with the received bytes unchanged – a replay is
 * then byte-exact, whatever encoding Orbits used.
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type RecorderStatus = { active: boolean; file: string | null; lines: number; startedAt: number | null };

export type RecordingInfo = {
  file: string;
  size: number;
  modifiedAt: number;
  lines: number;
  durationMs: number;
};

export class RecordingNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingNameError";
  }
}

/** Normalizes a file name: no directories, safe characters, `.txt` extension. */
export function sanitizeRecordingName(name: string): string {
  const base = basename(String(name).replace(/\\/g, "/"))
    .replace(/\.txt$/i, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/^[.\s]+/, "")
    .trim();
  if (base === "") throw new RecordingNameError("invalid recording name");
  return `${base.slice(0, 120)}.txt`;
}

function timestampForFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

const CRLF = Buffer.from("\r\n", "latin1");

export class Recorder {
  private stream: WriteStream | null = null;
  private file: string | null = null;
  private lines = 0;
  private startedAt: number | null = null;
  private firstLineAt: number | null = null;

  constructor(private readonly dir: string) {}

  status(): RecorderStatus {
    return { active: this.stream !== null, file: this.file, lines: this.lines, startedAt: this.startedAt };
  }

  async start(name = "recording", now = new Date()): Promise<string> {
    if (this.stream) return this.file as string;
    await mkdir(this.dir, { recursive: true });
    const file = sanitizeRecordingName(`${timestampForFileName(now)}_${name}`);
    this.stream = createWriteStream(join(this.dir, file), { flags: "a" });
    this.stream.on("error", () => {
      // Disk full or similar: stop recording instead of crashing the service.
      this.stream = null;
    });
    this.file = file;
    this.lines = 0;
    this.startedAt = now.getTime();
    this.firstLineAt = null;
    return file;
  }

  /** Appends one line (raw bytes as received). No-op when not recording. */
  push(raw: Uint8Array, at = Date.now()): void {
    if (!this.stream) return;
    if (this.firstLineAt === null) this.firstLineAt = at;
    this.stream.write(Buffer.concat([Buffer.from(`${at - this.firstLineAt} `, "latin1"), raw, CRLF]));
    this.lines++;
  }

  async stop(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (stream) await new Promise<void>((done) => stream.end(() => done()));
  }
}

export class RecordingLibrary {
  /** Cache of line count / duration per file, keyed by size + mtime. */
  private readonly infoCache = new Map<string, { key: string; lines: number; durationMs: number }>();

  constructor(readonly dir: string) {}

  /** Absolute path of a recording; throws for names that leave the directory. */
  pathOf(file: string): string {
    const name = sanitizeRecordingName(file);
    if (name !== file && name !== `${file}.txt`) throw new RecordingNameError(`invalid recording name: ${file}`);
    const path = resolve(this.dir, name);
    if (!path.startsWith(resolve(this.dir))) throw new RecordingNameError(`invalid recording name: ${file}`);
    return path;
  }

  async list(): Promise<RecordingInfo[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.toLowerCase().endsWith(".txt"));
    } catch {
      return [];
    }
    const result: RecordingInfo[] = [];
    for (const file of names.sort()) {
      try {
        const s = await stat(join(this.dir, file));
        if (!s.isFile()) continue;
        const key = `${s.size}:${s.mtimeMs}`;
        let cached = this.infoCache.get(file);
        if (cached?.key !== key) {
          const data = await readFile(join(this.dir, file));
          cached = { key, ...summarize(data) };
          this.infoCache.set(file, cached);
        }
        result.push({ file, size: s.size, modifiedAt: s.mtimeMs, lines: cached.lines, durationMs: cached.durationMs });
      } catch {
        // file vanished meanwhile
      }
    }
    return result;
  }

  async save(file: string, data: Uint8Array): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const name = sanitizeRecordingName(file);
    await writeFile(join(this.dir, name), data);
    return name;
  }

  async remove(file: string): Promise<void> {
    await rm(this.pathOf(file));
    this.infoCache.delete(file);
  }
}

/** Line count and duration (last timestamp − first) of a recording, tolerant of bad lines. */
function summarize(data: Uint8Array): { lines: number; durationMs: number } {
  const text = Buffer.from(data).toString("latin1");
  let lines = 0;
  let first: number | null = null;
  let last = 0;
  for (const line of text.split("\n")) {
    const m = /^(\d+) /.exec(line);
    if (!m) continue;
    lines++;
    const t = Number(m[1]);
    if (first === null) first = t;
    last = t;
  }
  return { lines, durationMs: first === null ? 0 : Math.max(0, last - first) };
}
