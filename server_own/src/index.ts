import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Database from "better-sqlite3";
import { compare, applyPatch  } from "fast-json-patch/index.mjs";
import type { Operation } from "fast-json-patch/index.mjs";
import cors from "@fastify/cors";


type Doc = {
    rev: number;
    data: any; // später sauber typisieren
};

const app = Fastify({ logger: true });

// WICHTIG: websocket vor den Routen registrieren. :contentReference[oaicite:4]{index=4}
await app.register(websocket);
await app.register(FastifySSEPlugin); // SSE plugin :contentReference[oaicite:5]{index=5}
await app.register(cors, {
    origin: true, // dev: alles erlauben
    credentials: true,
});

// --- SQLite Setup (eine Datei, Windows-friendly) :contentReference[oaicite:6]{index=6}
const db = new Database("raceoffice.db");
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
            try {
                ws.send(payload);
            } catch { }
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
            socket.send(JSON.stringify({ error: "invalid_json" }));
            return;
        }

        const { baseRev, patch } = msg as { baseRev: number; patch: Operation[] };
        if (!Array.isArray(patch) || typeof baseRev !== "number") {
            socket.send(JSON.stringify({ error: "invalid_payload" }));
            return;
        }

        // Load, check rev, apply patch, persist, broadcast
        const current = loadDoc(docId);
        if (current.rev !== baseRev) {
            socket.send(JSON.stringify({ error: "rev_mismatch", rev: current.rev }));
            return;
        }

        // fast-json-patch applyPatch :contentReference[oaicite:9]{index=9}
        const cloned = structuredClone(current.data);
        const result = applyPatch(cloned, patch, /*validate*/ true, /*mutate*/ true);
        if (result.newDocument === undefined) {
            socket.send(JSON.stringify({ error: "patch_failed" }));
            return;
        }

        const next: Doc = { rev: current.rev + 1, data: result.newDocument };
        saveDoc(docId, next);

        broadcastPatch(docId, next.rev, patch);
        socket.send(JSON.stringify({ ok: true, rev: next.rev }));
    });

    socket.on("close", () => {
        wsClients.get(docId)?.delete(socket);
    });
});

function noteSnapshot(socket: any, docId: string) {
    const doc = loadDoc(docId);
    socket.send(JSON.stringify({ type: "snapshot", docId, rev: doc.rev, data: doc.data }));
}

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
