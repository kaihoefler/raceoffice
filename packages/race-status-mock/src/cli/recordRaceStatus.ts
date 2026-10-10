// CLI: records a real race from the timing system for later use in tests.
//
//   npm run record:race-status -- --url http://<timing-host>:8080/races?filter=current \
//     --out packages/race-status-mock/recordings/<event>-<race>.jsonl \
//     [--interval 1000] [--wait 30] [--anonymize] [--per-lap]
//
// Polls like the frontend does and appends a line only when the scoring-relevant state
// changed (flag, lap counter, rider positions/laps/times, see relevantStateKey). Clock-only
// changes are skipped, so a recording stays small and every line is a meaningful state.
// The full raw response is stored. Stop with Ctrl+C.
//
// --wait <s>   at startup, retry once per second for up to <s> seconds (default 30) until the
//              feed answers, e.g. to start a replay player after the recorder. Gives up with
//              an error if the feed never answers (wrong URL). Once recording, short outages
//              of the timing system are tolerated and logged. `t` counts from the first answer.
// --anonymize  replaces rider names (see anonymizePayload) before anything is written.
// --per-lap    keeps one state per race lap and flag: the last relevant state before the
//              next lap starts or the flag changes (see compactRecordingPerLap). The state
//              of the running lap is held back until lap or flag change, and written on Ctrl+C.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { anonymizePayload, lapKey, relevantStateKey, serializeFrame, type RecordingFrame } from "../recording.js";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string" },
    interval: { type: "string", default: "1000" },
    wait: { type: "string", default: "30" },
    anonymize: { type: "boolean", default: false },
    "per-lap": { type: "boolean", default: false },
  },
});

if (!values.url || !values.out) {
  console.error("Usage: --url <feed url> --out <file.jsonl> [--interval 1000] [--wait 30] [--anonymize] [--per-lap]");
  process.exit(1);
}

const url = values.url;
const outFile = path.resolve(values.out);
const intervalMs = Math.max(250, Number(values.interval));
const waitSeconds = Math.max(0, Number(values.wait));
const perLap = values["per-lap"];

fs.mkdirSync(path.dirname(outFile), { recursive: true });

/** Time base of the recording: the first successful response. */
let startedAt = 0;
let lastKey: string | null = null;
/** --per-lap: latest relevant state of the running lap, not yet written. */
let pending: RecordingFrame | null = null;
let written = 0;

function write(frame: RecordingFrame): void {
  fs.appendFileSync(outFile, serializeFrame(frame) + "\n");
  written += 1;
  process.stdout.write(`\rstates recorded: ${written}   `);
}

/** One request to the feed; throws on network errors, non-2xx and invalid JSON. */
async function fetchFeed(): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(intervalMs * 3) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/**
 * Startup: retries once per second until the feed answers or `waitSeconds` passed.
 * Returns the first response; exits the process if the feed never answers.
 */
async function waitForFeed(): Promise<unknown> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      return await fetchFeed();
    } catch (err) {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        console.error(`\nFeed not reachable after ${waitSeconds} s: ${String((err as Error)?.message ?? err)}`);
        process.exit(1);
      }
      process.stdout.write(`\rwaiting for the feed ... ${left} s left   `);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Records one response if its scoring-relevant state changed. */
function record(raw: unknown): void {
  const payload = values.anonymize ? anonymizePayload(raw) : raw;
  const key = relevantStateKey(payload);
  if (key === lastKey) return;
  lastKey = key;

  const frame: RecordingFrame = { t: Date.now() - startedAt, payload };
  if (!perLap) {
    write(frame);
    return;
  }

  // A new lap started: the held-back state was the last one of the previous lap.
  if (pending && lapKey(frame.payload) !== lapKey(pending.payload)) write(pending);
  pending = frame;
}

async function pollOnce(): Promise<void> {
  try {
    record(await fetchFeed());
  } catch (err) {
    console.warn(`\npoll failed: ${String((err as Error)?.message ?? err)}`);
  }
}

console.log(
  `Recording ${url} -> ${outFile} every ${intervalMs} ms` +
    `${values.anonymize ? ", anonymized" : ""}${perLap ? ", one state per lap and flag" : ""}. Ctrl+C to stop.`,
);

let timer: NodeJS.Timeout | null = null;

process.on("SIGINT", () => {
  if (timer) clearInterval(timer);
  if (pending) write(pending);
  console.log(`\nStopped. ${written} states written to ${outFile}`);
  process.exit(0);
});

const first = await waitForFeed();
startedAt = Date.now();
console.log("\nFeed reachable, recording.");
record(first);
timer = setInterval(pollOnce, intervalMs);
