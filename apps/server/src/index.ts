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
import { DocStore, type Doc } from "./services/docStore.js";
import { applyPatch } from "fast-json-patch/index.mjs";
import type { Operation } from "fast-json-patch/index.mjs";
import cors from "@fastify/cors";

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { registerStaticServing } from "./services/staticServing.js";

import {
  buildCurrentRaceResultPayload,
  resolveCurrentRaceContext,
} from "./services/currentRaceResultService.js";
import {
  createLiveTrackingRuntimeDocument,
  isLiveTrackingRuntimeDocument,
  makeLiveTrackingRuntimeDocId,
} from "@raceoffice/domain";
import { LiveTrackingWorkerManager } from "./services/liveTrackingWorkerManager.js";
import {
  LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS,
  registerLiveTrackingWorkerRoutes,
} from "./services/liveTrackingWorkerRoutes.js";
import {
  P3_TEST_CLIENT_SERVICE_ENDPOINTS,
  registerP3TestClientRoutes,
} from "./services/p3TestClientRoutes.js";
import { P3TestClientService } from "./services/p3TestClientService.js";
import {
  P3_DISCOVERY_SERVICE_ENDPOINTS,
  registerP3DiscoveryRoutes,
} from "./services/p3DiscoveryRoutes.js";









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
    {
    path: "/p3test",
    description: "Standalone P3 parser test frontend",
  },
  {
    path: "/livetracking",
    description: "Standalone LiveTracking frontend",
  },

  ...LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS,
  ...P3_TEST_CLIENT_SERVICE_ENDPOINTS,
  ...P3_DISCOVERY_SERVICE_ENDPOINTS,
] as const;

const publicDir = path.resolve(__dirname, "../public");

await registerStaticServing(app, { publicDir, serviceEndpoints: publicServiceEndpoints });

// --- SQLite setup (single file, local/server friendly)
// db path resolution order: CLI --db > RACEOFFICE_DB env > ./data/raceoffice.db

const dbPath =
  readArg("--db") ??
  process.env.RACEOFFICE_DB ??
  path.resolve(process.cwd(), "data", "raceoffice.db");

const docStore = new DocStore(dbPath);
app.log.info({ dbPath }, "Using sqlite db");

/**
 * Loads one persisted document by id. Delegates to the DocStore bootstrap/persistence
 * behavior (see docStore.ts for the per-doc-type default shapes).
 */
function loadDoc(id: string): Doc {
  return docStore.loadDoc(id);
}

/**
 * Persists one full document snapshot (id + rev + JSON payload).
 *
 * Notes:
 * - Revisions are managed by ws patch flow; this function is intentionally simple.
 * - Writes are idempotent for the same (id, rev, data) tuple.
 */
function saveDoc(id: string, doc: Doc): void {
  docStore.saveDoc(id, doc);
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

const liveTrackingWorkerManager = new LiveTrackingWorkerManager({
  repoRoot: resolveLiveTrackingRepoRoot(),
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

const p3TestClientService = new P3TestClientService({
  info: (obj, msg) => app.log.info(obj as any, msg),
  warn: (obj, msg) => app.log.warn(obj as any, msg),
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










// --- Health
app.get("/health", async () => ({ ok: true }));

// --- LiveTracking worker process lifecycle
registerLiveTrackingWorkerRoutes(app, liveTrackingWorkerManager);

// --- P3 protocol test client control routes
registerP3TestClientRoutes(app, p3TestClientService);

// --- P3 decoder network discovery scan
registerP3DiscoveryRoutes(app);



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
  p3TestClientService.disconnect("server shutting down");
});


await app.listen({ port, host });


