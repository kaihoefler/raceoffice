/**
 * Recording format, byte-level reader, line decoder: line endings, chunking and encoding.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectRecordingEncoding,
  formatRecordingLine,
  LineDecoder,
  LineSplitter,
  parseLine,
  parseRecording,
  parseRecordingBytes,
  parseRecordingLine,
  RaceStateStore,
  RecordingFormatError,
  toRaceTO,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures/recordings");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name));

describe("recording format", () => {
  it("parses and formats a line", () => {
    expect(parseRecordingLine('94432 $F,49,"00:00:00","13:53:23","00:00:33","Green "')).toEqual({
      lineNumber: 1,
      offsetMs: 94432,
      raw: '$F,49,"00:00:00","13:53:23","00:00:33","Green "',
    });
    expect(formatRecordingLine(12.4, "$B,1,\"x\"")).toBe('12 $B,1,"x"');
  });

  it("accepts leading zeros in the timestamp", () => {
    expect(parseRecordingLine('0995 $F,0,"00:00:00","21:54:50","00:00:00","      "').offsetMs).toBe(995);
  });

  it("handles CRLF, LF and a trailing newline; rejects malformed lines", () => {
    expect(parseRecording("0 $I,a\r\n5 $B,1,x\n\n").map((e) => [e.lineNumber, e.offsetMs, e.raw])).toEqual([
      [1, 0, "$I,a"],
      [2, 5, "$B,1,x"],
    ]);
    expect(() => parseRecording("0 $I\nfoo\n")).toThrow(RecordingFormatError);
  });

  it("reads the Java recordings byte-exact (windows-1252, CRLF)", () => {
    const data = readFixture("leaderboard-recording_AGI_2022_pts_Sen_Men.txt");
    const entries = parseRecordingBytes(data);
    expect(entries.length).toBe(16709);
    // No CR left in any message.
    expect(entries.some((e) => e.raw.includes(0x0d))).toBe(false);
    // Same result as the text reader after decoding.
    const text = new TextDecoder("windows-1252").decode(data);
    expect(parseRecording(text).length).toBe(entries.length);
  });

  it("handles recordings that start with $F instead of $I", () => {
    const entries = parseRecording(readFixture("1h_Record_test.txt").toString("latin1"));
    expect(entries[0]?.raw.startsWith("$F,")).toBe(true);
    const store = new RaceStateStore();
    for (const e of entries) store.apply(parseLine(e.raw));
    expect(store.displayRace.name).toBe("1h WR Template");
  });
});

describe("LineDecoder", () => {
  const bytes = (s: string) => Buffer.from(s, "latin1");

  it("splits CRLF, LF and mixed line endings and buffers incomplete lines", () => {
    const d = new LineDecoder();
    expect(d.push(bytes("$A,1\r\n$B,"))).toEqual(["$A,1"]);
    expect(d.pendingBytes).toBe(3);
    expect(d.push(bytes("2\n$C,3\r"))).toEqual(["$B,2"]);
    expect(d.push(bytes("\n"))).toEqual(["$C,3"]);
    expect(d.push(bytes("$D"))).toEqual([]);
    expect(d.flush()).toEqual(["$D"]);
    expect(d.flush()).toEqual([]);
  });

  it("decodes windows-1252 umlauts (default) and shows replacement chars with utf-8", () => {
    const line = Buffer.from([...bytes('$A,"1","1",T,"Nils","B'), 0xfc, ...bytes('hnemann","GER",1\r\n')]);
    expect(new LineDecoder().push(line)).toEqual(['$A,"1","1",T,"Nils","Bühnemann","GER",1']);
    expect(new LineDecoder("utf-8").push(line)[0]).toContain("�");
  });

  it("does not break UTF-8 characters split across chunks", () => {
    const d = new LineDecoder("utf-8");
    const data = Buffer.from("$E,\"TRACKNAME\",\"Groß-Gerau\"\n", "utf8");
    const split = data.indexOf(0xc3) + 1; // inside "ß"
    expect(d.push(data.subarray(0, split))).toEqual([]);
    expect(d.push(data.subarray(split))).toEqual(['$E,"TRACKNAME","Groß-Gerau"']);
  });

  it("detects the encoding of recording files (Java recorder writes cp1252 or UTF-8)", () => {
    expect(detectRecordingEncoding(readFixture("leaderboard-recording_AGI_2022_pts_Sen_Men.txt"))).toBe("windows-1252");
    expect(detectRecordingEncoding(readFixture("excerpt_utf8-recording-file.txt"))).toBe("utf-8");
    expect(detectRecordingEncoding(readFixture("1h_Record_test.txt"))).toBe("windows-1252"); // ASCII only
  });

  it("LineSplitter returns raw bytes per line", () => {
    const s = new LineSplitter();
    const lines = s.push(new Uint8Array([0x24, 0x41, 0xfc, 0x0d, 0x0a, 0x24]));
    expect(lines.map((l) => Array.from(l))).toEqual([[0x24, 0x41, 0xfc]]);
    expect(s.flush().map((l) => Array.from(l))).toEqual([[0x24]]);
  });

  it("rejects unknown encodings at construction", () => {
    expect(() => new LineDecoder("no-such-charset")).toThrow(RangeError);
  });

  it("random chunking of a real recording yields the same state as line-by-line parsing", () => {
    const entries = parseRecordingBytes(readFixture("leaderboard-recording_AGI_2022_pts_Sen_Men.txt"));
    const stream = Buffer.concat(entries.flatMap((e) => [e.raw, Buffer.from("\r\n")]));

    const reference = new RaceStateStore();
    const decoder1252 = new TextDecoder("windows-1252");
    for (const e of entries) reference.apply(parseLine(decoder1252.decode(e.raw)));

    // Deterministic pseudo-random chunk sizes (1..4096 bytes).
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    const chunked = new RaceStateStore();
    const decoder = new LineDecoder();
    for (let pos = 0; pos < stream.length; ) {
      const size = 1 + (next() % 4096);
      for (const line of decoder.push(stream.subarray(pos, pos + size))) chunked.apply(parseLine(line));
      pos += size;
    }

    expect(toRaceTO(chunked.displayRace)).toEqual(toRaceTO(reference.displayRace));
    expect(chunked.all.map(toRaceTO)).toEqual(reference.all.map(toRaceTO));
    const names = toRaceTO(reference.displayRace).competitors.map((c) => c.lastName);
    expect(names.some((n) => n.includes("ü"))).toBe(true);
  });

  it("broken lines in the stream do not affect the state", () => {
    const clean = new RaceStateStore();
    const dirty = new RaceStateStore();
    const lines = ['$B,1,"R"', '$A,"1","1",T,"A","B","GER",1', '$G,1,"1",2,"00:01:00"'];
    for (const l of lines) clean.apply(parseLine(l));
    for (const l of [lines[0], "garbage", '$G,1,"1",x,"00:01:00"', lines[1], "$J,", lines[2], ""]) {
      dirty.apply(parseLine(l ?? ""));
    }
    expect(toRaceTO(dirty.current)).toEqual(toRaceTO(clean.current));
  });
});
