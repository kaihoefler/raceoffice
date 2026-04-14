/**
 * Worker entrypoint.
 *
 * Current operating mode: singleton session documents
 * (`liveTrackingSession`, `liveTrackingRuntime`, `liveTrackingResults`).
 *
 * This process is intentionally thin:
 * - parse runtime config (server URL)
 * - start one `SessionLoop`
 * - forward OS shutdown signals for clean teardown
 */
import { SessionLoop } from "./sessionLoop.js";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  const value = process.argv[idx + 1];
  return value ?? null;
}

const serverUrl =
  readArg("--server") ??
  process.env.LIVETRACKING_SERVER_URL ??
  process.env.RACEOFFICE_SERVER_URL ??
  "http://localhost:8787";

// Session id is currently ignored by domain id helpers (singleton docs),
// but we keep the argument explicit for future multi-session support.
const loop = new SessionLoop(serverUrl, "active", { heartbeatMs: 5000 });
loop.start();
console.log("[livetracking-worker] started in singleton-session mode");

function shutdown(signal: string) {
  console.log(`[livetracking-worker] received ${signal}, stopping...`);
  loop.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
