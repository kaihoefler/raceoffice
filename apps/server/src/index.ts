/**
 * RaceOffice realtime server entrypoint.
 *
 * Responsibilities:
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

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Database from "better-sqlite3";
import { applyPatch } from "fast-json-patch/index.mjs";
import type { Operation } from "fast-json-patch/index.mjs";
import cors from "@fastify/cors";

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";

import {
  buildCurrentRaceResultPayload,
  resolveCurrentRaceContext,
} from "./services/currentRaceResultService.js";
import {
  createInitialLiveTrackingDocument,
  createLiveTrackingRuntimeDocument,
  isLiveTrackingRuntimeDocument,
  makeLiveTrackingRuntimeDocId,
} from "@raceoffice/domain";
import { LiveTrackingWorkerManager } from "./services/liveTrackingWorkerManager.js";
import {
  LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS,
  registerLiveTrackingWorkerRoutes,
} from "./services/liveTrackingWorkerRoutes.js";








/**
 * Generic persisted document envelope used by the server.
 * - `rev` increments on every successful patch write.
 * - `data` is document-specific payload (event, visualization, livetracking, ...).
 */
type Doc = {
  rev: number;
  data: any; // TODO später sauber typisieren
};

/**
 * Canonical websocket error codes returned to patch clients.
 * Keeping explicit codes allows clients to react deterministically.
 */
type WsErrorCode =
  | "invalid_json"
  | "invalid_payload"
  | "rev_mismatch"
  | "patch_failed"
  | "patch_apply_failed"
  | "internal_error";

type WsErrorPayload = {
  type: "error";
  docId: string;
  code: WsErrorCode;
  message: string;
  rev?: number | null;
  retryable?: boolean;
};

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

// Server bind configuration (CLI args override env defaults).
const port = Number(readArg("--port") ?? process.env.PORT ?? 8787);
const host = readArg("--host") ?? process.env.HOST ?? "0.0.0.0";

// Worker reaches the server over loopback by default because both run on same host.
const liveTrackingServerUrl =
  readArg("--livetracking-server-url") ??
  process.env.LIVETRACKING_SERVER_URL ??
  process.env.RACEOFFICE_SERVER_URL ??
  `http://127.0.0.1:${port}`;

// Fastify application with structured logger enabled.
const app = Fastify({ logger: true });




// Register transport plugins before route declarations.
await app.register(websocket);
await app.register(FastifySSEPlugin);
await app.register(cors, {
  origin: true, // dev: alles erlauben
  credentials: true,
});

const publicDir = path.resolve(__dirname, "../public");

await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/", // assets unter /
});

// --- SQLite setup (single file, local/server friendly)
// db path resolution order: CLI --db > RACEOFFICE_DB env > ./data/raceoffice.db

const dbPath =
  readArg("--db") ??
  process.env.RACEOFFICE_DB ??
  path.resolve(process.cwd(), "data", "raceoffice.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });


const db = new Database(dbPath);
app.log.info({ dbPath }, "Using sqlite db");

db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY,
    rev INTEGER NOT NULL,
    json TEXT NOT NULL
  );
`);

// Prepared statements for fast hot-path reads/writes.
const getDocStmt = db.prepare("SELECT id, rev, json FROM docs WHERE id = ?");
const upsertDocStmt = db.prepare(`
  INSERT INTO docs (id, rev, json) VALUES (@id, @rev, @json)
  ON CONFLICT(id) DO UPDATE SET rev=excluded.rev, json=excluded.json
`);

/**
 * Loads one persisted document by id.
 *
 * Bootstrap behavior (important for first access):
 * - `eventList` gets a dedicated default shape (legacy core document).
 * - known LiveTracking ids are initialized via domain defaults
 *   (`createInitialLiveTrackingDocument`) to keep setup/session/runtime/results
 *   strictly separated from the start.
 * - unknown ids fall back to an empty object for backward compatibility.
 *
 * Design note:
 * - Initialization is persisted immediately so all clients observe the same
 *   revisioned starting state (`rev: 0`).
 */
function loadDoc(id: string): Doc {
  const row = getDocStmt.get(id) as { rev: number; json: string } | undefined;

  // Existing document path: return current revision + parsed JSON payload.
  if (row) {
    return { rev: row.rev, data: JSON.parse(row.json) };
  }

  // Missing document path: create and persist initial state once.
  const liveTrackingInitial = createInitialLiveTrackingDocument(id);

  const initial =
    id === "eventList"
      ? { rev: 0, data: { activeEventId: null, events: [] } } // dedicated core default
      : liveTrackingInitial
        ? { rev: 0, data: liveTrackingInitial } // typed LiveTracking default
        : { rev: 0, data: {} }; // generic fallback for unknown ids

  saveDoc(id, initial);
  return initial;
}



/**
 * Persists one full document snapshot (id + rev + JSON payload).
 *
 * Notes:
 * - Revisions are managed by ws patch flow; this function is intentionally simple.
 * - Writes are idempotent for the same (id, rev, data) tuple.
 */
function saveDoc(id: string, doc: Doc) {
  upsertDocStmt.run({ id, rev: doc.rev, json: JSON.stringify(doc.data) });
}

/**
 * Server-originated document mutation helper.
 *
 * Why this exists:
 * - server-side services (like worker lifecycle manager) must be able to mutate
 *   docs without going through websocket patch clients
 * - subscribers still need a deterministic realtime update frame
 */
function commitServerDocUpdate(docId: string, updater: (currentData: unknown) => unknown): Doc {
  const current = loadDoc(docId);
  const nextData = updater(structuredClone(current.data));
  const next: Doc = { rev: current.rev + 1, data: nextData };
  saveDoc(docId, next);

  // Broadcast as full-document replace patch to keep ws/sse consumers in sync.
  broadcastPatch(docId, next.rev, [{ op: "replace", path: "", value: next.data }]);
  return next;
}

const LIVE_TRACKING_RUNTIME_DOC_ID = makeLiveTrackingRuntimeDocId();

function commitLiveTrackingRuntimeUpdate(
  updater: (runtime: ReturnType<typeof createLiveTrackingRuntimeDocument>) => ReturnType<typeof createLiveTrackingRuntimeDocument>,
): void {
  commitServerDocUpdate(LIVE_TRACKING_RUNTIME_DOC_ID, (currentData) => {
    const runtime = isLiveTrackingRuntimeDocument(currentData)
      ? {
          ...createLiveTrackingRuntimeDocument(),
          ...currentData,
        }
      : createLiveTrackingRuntimeDocument();

    return updater(runtime);
  });
}

const liveTrackingWorkerManager = new LiveTrackingWorkerManager({
  repoRoot: path.resolve(__dirname, "../../.."),
  liveTrackingServerUrl,
  logger: {
    info: (obj, msg) => app.log.info(obj as any, msg),
    warn: (obj, msg) => app.log.warn(obj as any, msg),
  },
  runtimeSync: {
    markStarting: (pid) => {
      const t = new Date().toISOString();
      commitLiveTrackingRuntimeUpdate((runtime) => ({
        ...runtime,
        workerStatus: "starting",
        workerProcessId: pid,
        workerHost: os.hostname(),
        updatedAt: t,
      }));
    },
    markStopping: (pid) => {
      const t = new Date().toISOString();
      commitLiveTrackingRuntimeUpdate((runtime) => ({
        ...runtime,
        workerStatus: "stopping",
        workerProcessId: pid,
        workerHost: os.hostname(),
        updatedAt: t,
      }));
    },
    markOffline: (reason) => {
      const t = new Date().toISOString();
      commitLiveTrackingRuntimeUpdate((runtime) => ({
        ...runtime,
        workerStatus: "offline",
        workerHeartbeatAt: null,
        workerProcessId: null,
        workerHost: null,
        updatedAt: t,
        warnings: [...runtime.warnings.slice(-99), `[server] worker offline: ${reason}`],
      }));
    },
  },
});


// --- In-memory subscriber registries (per docId)

// SSE keeps Fastify reply handles, WS keeps raw socket handles.
type SSEClient = { id: string; reply: any };
const sseClients = new Map<string, Set<SSEClient>>(); // docId -> clients

const wsClients = new Map<string, Set<any>>(); // docId -> ws connections

/**
 * Best-effort socket sender (never throws).
 * Used for both normal ws frames and explicit error frames.
 */
function safeSocketSend(socket: any, payload: unknown) {
  try {
    socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch { }
}

/**
 * Sends a structured websocket error payload to one client.
 */
function sendWsError(
  socket: any,
  docId: string,
  code: WsErrorCode,
  message: string,
  options?: { rev?: number | null; retryable?: boolean },
) {
  const payload: WsErrorPayload = {
    type: "error",
    docId,
    code,
    message,
    ...(options?.rev !== undefined ? { rev: options.rev } : {}),
    ...(options?.retryable !== undefined ? { retryable: options.retryable } : {}),
  };

  safeSocketSend(socket, payload);
}

/**
 * Broadcasts one accepted patch to all subscribers of a document.
 *
 * Contract:
 * - Called only after patch was validated, applied and persisted.
 * - Payload includes final `rev` so clients can advance local base revision.
 */
function broadcastPatch(docId: string, rev: number, patch: Operation[]) {
  const payload = JSON.stringify({ docId, rev, patch });

  // SSE
  const sseSet = sseClients.get(docId);
  if (sseSet) {
    for (const c of sseSet) {
      // SSE event payload mirrors websocket patch payload.
      c.reply.sse({ event: "patch", id: String(rev), data: payload });
    }
  }

  // WS
  const wsSet = wsClients.get(docId);
  if (wsSet) {
    for (const ws of wsSet) {
      safeSocketSend(ws, payload);
    }
  }
}



// Public non-realtime endpoints for service discovery/fallback responses.
const publicServiceEndpoints = [
  {
    path: "/health",
    description: "Service health check",
  },
  {
    path: "/current_race_result",
    description: "Current active race result export",
  },
  ...LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS,
] as const;



/**
 * Standardized JSON body for unknown non-SPA endpoints.
 */
function serviceDiscoveryBody() {
  return {
    error: "not_found",
    message: "Unknown endpoint.",
    availableServices: publicServiceEndpoints,
  };
}

// --- Health
app.get("/health", async () => ({ ok: true }));

// --- LiveTracking worker process lifecycle
registerLiveTrackingWorkerRoutes(app, liveTrackingWorkerManager);


// --- Current race status export for external systems/integrations
app.get("/current_race_result", async (_req, reply) => {


  const ctx = resolveCurrentRaceContext(loadDoc);

  if (!ctx) {
    return reply.code(404).send({
      error: "no_current_race",
      message: "No active event/race found.",
    });
  }

  return reply.send(buildCurrentRaceResultPayload(ctx.race));
});




// --- SSE subscribe endpoint: snapshot + subsequent patch events for one doc id
app.get("/sse/:docId", async (req, reply) => {
  const { docId } = req.params as { docId: string };

  // Register subscriber for this doc id.
  const client: SSEClient = { id: crypto.randomUUID(), reply };
  if (!sseClients.has(docId)) sseClients.set(docId, new Set());
  sseClients.get(docId)!.add(client);

  // Cleanup on disconnect.
  req.socket.on("close", () => {
    sseClients.get(docId)?.delete(client);
  });

  // Send current snapshot immediately so client starts from a known revision.
  const doc = loadDoc(docId);
  reply.sse({ event: "snapshot", id: String(doc.rev), data: JSON.stringify({ docId, rev: doc.rev, data: doc.data }) });

  // Keep connection open; plugin manages stream lifecycle (no reply.send()).
});

// --- WebSocket endpoint: bidirectional patch protocol for one doc id
app.get("/ws/:docId", { websocket: true }, (socket, req) => {
  const { docId } = req.params as { docId: string };

  if (!wsClients.has(docId)) wsClients.set(docId, new Set());
  wsClients.get(docId)!.add(socket);

  noteSnapshot(socket, docId);

  socket.on("message", (raw: Buffer) => {
    // Expected message shape: { baseRev:number, patch: Operation[] }
    let msg: any;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      sendWsError(socket, docId, "invalid_json", "Message must be valid JSON");
      return;
    }

    const { baseRev, patch } = msg as { baseRev: number; patch: Operation[] };
    if (!Array.isArray(patch) || typeof baseRev !== "number") {
      sendWsError(socket, docId, "invalid_payload", "Payload must contain { baseRev:number, patch: Operation[] }");
      return;
    }

    try {
      // Core write pipeline: load -> rev check -> patch apply -> persist -> broadcast
      const current = loadDoc(docId);
      if (current.rev !== baseRev) {
        sendWsError(socket, docId, "rev_mismatch", "Client baseRev is stale", {
          rev: current.rev,
          retryable: true,
        });
        noteSnapshot(socket, docId);
        return;
      }

      // Apply JSON Patch against a cloned snapshot (validated operations).
      const cloned = structuredClone(current.data);
      const result = applyPatch(cloned, patch, /*validate*/ true, /*mutate*/ true);
      if (result.newDocument === undefined) {
        sendWsError(socket, docId, "patch_failed", "Patch did not produce a new document", {
          rev: current.rev,
          retryable: true,
        });
        noteSnapshot(socket, docId);
        return;
      }

      const next: Doc = { rev: current.rev + 1, data: result.newDocument };
      saveDoc(docId, next);

      broadcastPatch(docId, next.rev, patch);
      safeSocketSend(socket, { ok: true, rev: next.rev });
      console.log("sent patch", docId, next.rev, patch);
    } catch (err) {
      const causeCode = String((err as any)?.name ?? "unknown_error");
      const causeMessage = String((err as any)?.message ?? "Patch processing failed");

      app.log.warn({ docId, baseRev, causeCode, causeMessage, err }, "Failed to process patch");

      let currentRev: number | null = null;
      try {
        currentRev = loadDoc(docId).rev;
      } catch { }

      sendWsError(socket, docId, "patch_apply_failed", `${causeCode}: ${causeMessage}`, {
        rev: currentRev,
        retryable: true,
      });

      // Attempt re-sync after failed patch processing.
      try {
        noteSnapshot(socket, docId);
      } catch { }
    }
  });

  socket.on("close", () => {
    wsClients.get(docId)?.delete(socket);
  });
});

// Not-found strategy:
// - JSON discovery for API/non-HTML requests
// - SPA fallback to index.html for browser navigation when built
app.setNotFoundHandler((req, reply) => {
  const discovery = serviceDiscoveryBody();

  if (req.method !== "GET") return reply.code(404).send(discovery);

  const accept = String(req.headers.accept ?? "");
  if (!accept.includes("text/html")) return reply.code(404).send(discovery);

  const indexPath = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    const servicesHtml = publicServiceEndpoints
      .map((s) => `<li><a href="${s.path}">${s.path}</a> — ${s.description}</li>`)
      .join("");

    return reply
      .code(404)
      .type("text/html; charset=utf-8")
      .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RaceOffice Server - Not Found</title>
  </head>
  <body style="font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5;">
    <h1>Endpoint not found</h1>
    <p>The requested address does not exist on this server.</p>
    <p><strong>Available services:</strong></p>
    <ul>${servicesHtml}</ul>
    <p style="margin-top: 1rem; color: #666;">Frontend is not built. Run <code>npm run build</code> to serve the SPA.</p>
  </body>
</html>`);
  }

  return reply.type("text/html").sendFile("index.html");
});


/**
 * Sends a snapshot frame for one document to one websocket client.
 * Used on connect and after recoverable protocol errors.
 */
function noteSnapshot(socket: any, docId: string) {
  const doc = loadDoc(docId);
  safeSocketSend(socket, { type: "snapshot", docId, rev: doc.rev, data: doc.data });
  console.log("sent snapshot:", docId, doc.rev, doc.data);
}

app.addHook("onClose", async () => {
  liveTrackingWorkerManager.stop();
});

await app.listen({ port, host });


