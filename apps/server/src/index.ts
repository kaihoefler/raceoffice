import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Database from "better-sqlite3";
import { applyPatch } from "fast-json-patch/index.mjs";
import type { Operation } from "fast-json-patch/index.mjs";
import cors from "@fastify/cors";

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";

type Doc = {
    rev: number;
    data: any; // TODO später sauber typisieren
};

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

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;

  const value = process.argv[idx + 1];
  return value ?? null;
}


const app = Fastify({ logger: true });



// WICHTIG: websocket vor den Routen registrieren. :contentReference[oaicite:4]{index=4}
await app.register(websocket);
await app.register(FastifySSEPlugin); // SSE plugin :contentReference[oaicite:5]{index=5}
await app.register(cors, {
    origin: true, // dev: alles erlauben
    credentials: true,
});

const publicDir = path.resolve(__dirname, "../public");

await app.register(fastifyStatic, {
  root: publicDir,
  prefix: "/", // assets unter /
});

// --- SQLite Setup (eine Datei, Windows-friendly) :contentReference[oaicite:6]{index=6}
// TODO Dateipfad aus Umgebungsvariable auslesen

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

const getDocStmt = db.prepare("SELECT id, rev, json FROM docs WHERE id = ?");
const upsertDocStmt = db.prepare(`
  INSERT INTO docs (id, rev, json) VALUES (@id, @rev, @json)
  ON CONFLICT(id) DO UPDATE SET rev=excluded.rev, json=excluded.json
`);

function loadDoc(id: string): Doc {
    const row = getDocStmt.get(id) as { rev: number; json: string } | undefined;
    if (!row) {
        const initial =
            id === "eventList"
                ? { rev: 0, data: { activeEventId: null, events: [] } } // <- EventList
                : { rev: 0, data: {} };

        saveDoc(id, initial);
        return initial;
    }
    return { rev: row.rev, data: JSON.parse(row.json) };
}

function saveDoc(id: string, doc: Doc) {
    upsertDocStmt.run({ id, rev: doc.rev, json: JSON.stringify(doc.data) });
}

// --- In-Memory Subscriptions
type SSEClient = { id: string; reply: any };
const sseClients = new Map<string, Set<SSEClient>>(); // docId -> clients

const wsClients = new Map<string, Set<any>>(); // docId -> ws connections

function safeSocketSend(socket: any, payload: unknown) {
  try {
    socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch {}
}

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

function broadcastPatch(docId: string, rev: number, patch: Operation[]) {
    const payload = JSON.stringify({ docId, rev, patch });

    // SSE
    const sseSet = sseClients.get(docId);
    if (sseSet) {
        for (const c of sseSet) {
            // fastify-sse-v2: reply.sse({ data }) :contentReference[oaicite:7]{index=7}
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

// --- SSE Subscribe: /sse/:docId
app.get("/sse/:docId", async (req, reply) => {
    const { docId } = req.params as { docId: string };

    // Client registrieren
    const client: SSEClient = { id: crypto.randomUUID(), reply };
    if (!sseClients.has(docId)) sseClients.set(docId, new Set());
    sseClients.get(docId)!.add(client);

    // Auf disconnect aufräumen
    req.socket.on("close", () => {
        sseClients.get(docId)?.delete(client);
    });

    // Optional: initial snapshot senden
    const doc = loadDoc(docId);
    reply.sse({ event: "snapshot", id: String(doc.rev), data: JSON.stringify({ docId, rev: doc.rev, data: doc.data }) });

    // Verbindung offen lassen (fastify-sse-v2 hält sie offen) :contentReference[oaicite:8]{index=8}
    // Kein reply.send()
});

// --- WebSocket: /ws/:docId
app.get("/ws/:docId", { websocket: true }, (socket, req) => {
    const { docId } = req.params as { docId: string };

    if (!wsClients.has(docId)) wsClients.set(docId, new Set());
    wsClients.get(docId)!.add(socket);

    noteSnapshot(socket, docId);

        socket.on("message", (raw: Buffer) => {
        // Erwartet: { baseRev:number, patch: Operation[] }
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
            // Load, check rev, apply patch, persist, broadcast
            const current = loadDoc(docId);
                        if (current.rev !== baseRev) {
                sendWsError(socket, docId, "rev_mismatch", "Client baseRev is stale", {
                  rev: current.rev,
                  retryable: true,
                });
                noteSnapshot(socket, docId);
                return;
            }

            // fast-json-patch applyPatch :contentReference[oaicite:9]{index=9}
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
            } catch {}

            sendWsError(socket, docId, "patch_apply_failed", `${causeCode}: ${causeMessage}`, {
              rev: currentRev,
              retryable: true,
            });

            // Try to re-sync sender after a failed patch.
            try {
                noteSnapshot(socket, docId);
            } catch {}
        }
    });

    socket.on("close", () => {
        wsClients.get(docId)?.delete(socket);
    });
});
 
app.setNotFoundHandler((req, reply) => {
  if (req.method !== "GET") return reply.code(404).send({ error: "not_found" });

  const accept = String(req.headers.accept ?? "");
  if (!accept.includes("text/html")) return reply.code(404).send({ error: "not_found" });

  const indexPath = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return reply.code(404).send({
      error: "client_not_built",
            hint: "Run `npm run build` so apps/server/public/index.html exists.",

    });
  }

  return reply.type("text/html").sendFile("index.html");
});

function noteSnapshot(socket: any, docId: string) {
    const doc = loadDoc(docId);
    safeSocketSend(socket, { type: "snapshot", docId, rev: doc.rev, data: doc.data });
    console.log("sent snapshot:", docId, doc.rev, doc.data);
}

const port = Number(readArg("--port") ?? process.env.PORT ?? 8787);
const host = readArg("--host") ?? process.env.HOST ?? "0.0.0.0";
await app.listen({ port, host });

