#!/usr/bin/env node
/**
 * Generates the golden reference snapshots from the Java app RMonitorLeaderboard.
 *
 *   npm run golden:generate --workspace=@raceoffice/rmonitor [-- <recording.txt> ...]
 *   npm run golden:generate:local --workspace=@raceoffice/rmonitor   (full competition days)
 *
 * Options:
 *   --dir=<path>        recordings directory (default test/fixtures/recordings)
 *   --out=<path>        output directory (default test/fixtures/golden)
 *   --races-at=changes  store `/races` at race changes and at the end (default); `end` = only at the end
 *   --compact           write JSON without indentation
 *   --parallel=<n>      process n recordings at once, one container each (default 1)
 *   --local             shortcut for the local, git-ignored full-day recordings:
 *                       --dir=test/fixtures/recordings-local --out=test/fixtures/golden-local
 *                       --races-at=end --compact --parallel=3
 *
 * For each recording in the directory (or the given files):
 * 1. FakeOrbitsFeeder serves the recording byte-exact on a TCP port.
 * 2. The Java app runs headless in Docker (published image) as RMonitor client + JSON server.
 * 3. At every checkpoint the feeder sends exactly the lines up to it and stops. The script waits
 *    until the Java app has logged all of them (`Message: …` at DEBUG level, one per line) and
 *    then reads `/races?filter=current` and `/races`.
 * 4. Result: test/fixtures/golden/<recording>.golden.json
 *
 * Requirements: Docker (Linux containers). No local Java needed.
 * Env: RMONITOR_JAVA_IMAGE (default ghcr.io/bastianpaetzold/rmonitorleaderboard:1.3.0)
 */
import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseRecordingBytes } from "../dist/index.js";
import { FakeOrbitsFeeder, selectCheckpoints } from "../dist/testing/index.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const IMAGE = process.env.RMONITOR_JAVA_IMAGE ?? "ghcr.io/bastianpaetzold/rmonitorleaderboard:1.3.0";
const ENCODING = "windows-1252";
const PROCESS_TIMEOUT_MS = 60_000;
/** After the last line was logged, give the Java thread a moment to apply it. */
const SETTLE_MS = 50;

function parseOptions(argv) {
  const opts = {
    dir: "test/fixtures/recordings",
    out: "test/fixtures/golden",
    racesAt: "changes",
    compact: false,
    parallel: 1,
    files: [],
  };
  for (const arg of argv) {
    const [key, value] = arg.split("=", 2);
    if (key === "--local") {
      Object.assign(opts, {
        dir: "test/fixtures/recordings-local",
        out: "test/fixtures/golden-local",
        racesAt: "end",
        compact: true,
        parallel: 3,
      });
    } else if (key === "--dir") opts.dir = value;
    else if (key === "--out") opts.out = value;
    else if (key === "--races-at") opts.racesAt = value === "end" ? "end" : "changes";
    else if (key === "--compact") opts.compact = true;
    else if (key === "--parallel") opts.parallel = Math.max(1, Number(value) || 1);
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.files.push(resolve(arg));
  }
  return opts;
}

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  const recordingsDir = resolve(pkgRoot, opts.dir);
  const goldenDir = resolve(pkgRoot, opts.out);
  const files = opts.files.length
    ? opts.files
    : (await readdir(recordingsDir)).filter((f) => f.endsWith(".txt")).sort().map((f) => join(recordingsDir, f));

  await mkdir(goldenDir, { recursive: true });
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const started = Date.now();
      const golden = await generate(file, opts);
      const out = join(goldenDir, `${basename(file, ".txt")}.golden.json`);
      await writeFile(out, `${JSON.stringify(golden, null, opts.compact ? undefined : 1)}\n`, "utf8");
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log(`${basename(file)}: ${golden.checkpoints.length} checkpoints, ${seconds}s → ${out}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.parallel, files.length) }, worker));
}

async function generate(file, opts) {
  console.log(`start ${basename(file)}`);
  const entries = parseRecordingBytes(await readFile(file));
  const decoder = new TextDecoder(ENCODING);
  const messages = entries.map((e) => decoder.decode(e.raw));
  const checkpoints = selectCheckpoints(messages);

  const feeder = new FakeOrbitsFeeder(
    entries.map((e) => ({ offsetMs: e.offsetMs, bytes: e.raw })),
    { host: "0.0.0.0" },
  );
  const { port: feederPort } = await feeder.start();
  const httpPort = await freePort();

  const { stdout } = await execFileAsync("docker", [
    "run", "-d", "--rm",
    "--add-host=host.docker.internal:host-gateway",
    "-p", `127.0.0.1:${httpPort}:8080`,
    IMAGE,
    "--headless", "--disable-file-log", "--loglevel=DEBUG",
    "-c", "--host=host.docker.internal", `--port=${feederPort}`,
    `--client-stream-encoding=${ENCODING}`, "--client-max-retries=-1", "--client-retry-timeout=500",
    "-s",
  ]);
  const containerId = stdout.trim();
  const log = followMessageLog(containerId);

  try {
    await feeder.waitForClients(1, PROCESS_TIMEOUT_MS);
    await waitForHttp(httpPort);

    const result = [];
    for (const afterLines of checkpoints) {
      await feeder.sendUntil(afterLines);
      await log.waitForCount(afterLines);
      await sleep(SETTLE_MS);

      const current = await getJson(httpPort, "/races?filter=current");
      const lastLine = messages[afterLines - 1];
      const prefix = lastLine.split(",", 1)[0];
      const isEnd = afterLines === messages.length;
      const storeRaces = isEnd || (opts.racesAt === "changes" && (prefix === "$B" || prefix === "$I"));
      const checkpoint = { afterLines, lastLine, current: current[0] };
      if (storeRaces) checkpoint.races = await getJson(httpPort, "/races");
      result.push(checkpoint);
    }

    return {
      recording: basename(file),
      reference: IMAGE,
      encoding: ENCODING,
      generatedAt: new Date().toISOString(),
      lineCount: messages.length,
      checkpoints: result,
    };
  } finally {
    log.stop();
    await execFileAsync("docker", ["rm", "-f", containerId]).catch(() => {});
    await feeder.close();
  }
}

/** Counts `Message: …` debug lines of the Java MessageFactory (one per received line). */
function followMessageLog(containerId) {
  const child = spawn("docker", ["logs", "-f", containerId], { stdio: ["ignore", "pipe", "pipe"] });
  let count = 0;
  let rest = "";
  let waiters = [];
  const onData = (chunk) => {
    const text = rest + chunk.toString("latin1");
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    // Every RMonitor line starts with "$"; MessageFactory logs it as `Message: <line>`.
    for (const line of lines) if (line.includes("Message: $")) count++;
    waiters = waiters.filter((w) => !w());
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  return {
    waitForCount(target) {
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Java app processed ${count} of ${target} lines within ${PROCESS_TIMEOUT_MS} ms`)),
          PROCESS_TIMEOUT_MS,
        );
        const check = () => {
          if (count > target) {
            clearTimeout(timer);
            reject(new Error(`Java app logged ${count} messages, expected ${target} – log pattern ambiguous`));
            return true;
          }
          if (count === target) {
            clearTimeout(timer);
            resolvePromise();
            return true;
          }
          return false;
        };
        if (!check()) waiters.push(check);
      });
    },
    stop() {
      child.kill();
    },
  };
}

async function waitForHttp(port) {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  for (;;) {
    try {
      await getJson(port, "/races");
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(200);
    }
  }
}

async function getJson(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
