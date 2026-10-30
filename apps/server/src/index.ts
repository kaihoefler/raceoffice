/**
 * RaceOffice realtime server entrypoint.
 *
 * Reads CLI/env configuration, builds the app (`app.ts`) and starts listening.
 *
 * Responsibilities of the built app:
 * - Serve SPA/static files
 * - Persist revisioned JSON documents in SQLite
 * - Synchronize docs via WebSocket JSON-Patch protocol
 * - Offer optional SSE snapshots/patch stream
 * - Expose service endpoints and wire feature-specific route modules
 *
 * Architectural rule:
 * - This process is the single source of truth for document persistence.
 * - Clients/workers only interact through document ids + revisions + patches.
 * - Feature-specific concerns (e.g. LiveTracking worker lifecycle routes) should
 *   live in dedicated service modules, not in the generic realtime core.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reads a CLI argument value by flag name, e.g. `--port 8787`.
 */
function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;

  const value = process.argv[idx + 1];
  return value ?? null;
}

/**
 * Resolves workspace/deploy root for worker + AMMC path resolution.
 *
 * Why dynamic:
 * - dev layout:   apps/server/dist -> repo root is ../../..
 * - deploy layout: server/dist      -> deploy root is ../..
 */
function resolveLiveTrackingRepoRoot(): string {
  const explicitRoot = String(process.env.RACEOFFICE_REPO_ROOT ?? "").trim();
  if (explicitRoot) return path.resolve(explicitRoot);

  const candidates = [
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../.."),
    process.cwd(),
  ];

  for (const root of candidates) {
    const workerDist = path.join(root, "apps", "livetracking-worker", "dist", "index.js");
    const workerSrc = path.join(root, "apps", "livetracking-worker", "src", "index.ts");
    if (fs.existsSync(workerDist) || fs.existsSync(workerSrc)) return root;
  }

  // Keep previous behavior as fallback for deterministic troubleshooting.
  return path.resolve(__dirname, "../../..");
}

// Server bind configuration (CLI args override env defaults).
const port = Number(readArg("--port") ?? process.env.PORT ?? 8787);
const host = readArg("--host") ?? process.env.HOST ?? "0.0.0.0";

// Worker reaches the server over loopback by default because both run on same host.
const liveTrackingServerUrl =
  readArg("--livetracking-server-url") ??
  process.env.LIVETRACKING_SERVER_URL ??
  process.env.RACEOFFICE_SERVER_URL ??
  `http://127.0.0.1:${port}`;

// db path resolution order: CLI --db > RACEOFFICE_DB env > ./data/raceoffice.db
const dbPath =
  readArg("--db") ??
  process.env.RACEOFFICE_DB ??
  path.resolve(process.cwd(), "data", "raceoffice.db");

// Leaderboard integration: managed (default) | external (proxy to LEADERBOARD_URL, e.g. the Java
// RMonitorLeaderboard as emergency fallback) | off.
const leaderboardModeRaw = String(readArg("--leaderboard-mode") ?? process.env.LEADERBOARD_MODE ?? "managed").trim();
if (!["managed", "external", "off"].includes(leaderboardModeRaw)) {
  throw new Error(`Invalid leaderboard mode "${leaderboardModeRaw}" (managed | external | off)`);
}
const leaderboardMode = leaderboardModeRaw as "managed" | "external" | "off";

const app = await buildApp({
  dbPath,
  leaderboard: {
    mode: leaderboardMode,
    externalUrl: readArg("--leaderboard-url") ?? process.env.LEADERBOARD_URL ?? null,
    internalPort: Number(process.env.LEADERBOARD_INTERNAL_PORT ?? 8790),
    dataDir: process.env.LEADERBOARD_DATA_DIR ?? path.join(path.dirname(path.resolve(dbPath)), "leaderboard"),
    autoStart: /^(1|true|yes|on)$/i.test(String(process.env.LEADERBOARD_AUTOSTART ?? "")),
  },
  publicDir: path.resolve(__dirname, "../public"),
  repoRoot: resolveLiveTrackingRepoRoot(),
  liveTrackingServerUrl,
});

await app.listen({ port, host });
