import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Operation } from "fast-json-patch/index.mjs";
import type { Doc, DocStore } from "./docStore.js";
import {
  applyClientWrite,
  parseClientWrite,
  type ProtocolRejection,
  type WsErrorPayload,
} from "./realtimeProtocol.js";

// SSE keeps Fastify reply handles, WS keeps raw socket handles.
type SSEClient = { id: string; reply: any };

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
 * Realtime document hub: per-doc subscriber registries, the WebSocket JSON-Patch
 * write protocol (`/ws/:docId`) and the read-only SSE stream (`/sse/:docId`).
 *
 * Contract:
 * - every accepted write is persisted with `rev + 1` before it is broadcast
 * - rejected writes are never persisted or broadcast; the sender gets a unified
 *   error frame (and a fresh snapshot when it needs to re-sync)
 */
export class RealtimeHub {
  private readonly sseClients = new Map<string, Set<SSEClient>>();
  private readonly wsClients = new Map<string, Set<any>>();

  constructor(
    private readonly docStore: DocStore,
    private readonly log: FastifyBaseLogger,
  ) {}

  registerRoutes(app: FastifyInstance): void {
    // --- SSE subscribe endpoint: snapshot + subsequent patch events for one doc id
    app.get("/sse/:docId", async (req, reply) => {
      const { docId } = req.params as { docId: string };

      const client: SSEClient = { id: crypto.randomUUID(), reply };
      if (!this.sseClients.has(docId)) this.sseClients.set(docId, new Set());
      this.sseClients.get(docId)!.add(client);

      req.socket.on("close", () => {
        this.sseClients.get(docId)?.delete(client);
      });

      // Send current snapshot immediately so client starts from a known revision.
      const doc = this.docStore.loadDoc(docId);
      reply.sse({ event: "snapshot", id: String(doc.rev), data: JSON.stringify({ docId, rev: doc.rev, data: doc.data }) });

      // Keep connection open; plugin manages stream lifecycle (no reply.send()).
    });

    // --- WebSocket endpoint: bidirectional patch protocol for one doc id
    app.get("/ws/:docId", { websocket: true }, (socket, req) => {
      const { docId } = req.params as { docId: string };

      if (!this.wsClients.has(docId)) this.wsClients.set(docId, new Set());
      this.wsClients.get(docId)!.add(socket);

      this.sendSnapshot(socket, docId);

      socket.on("message", (raw: Buffer) => this.handleClientMessage(socket, docId, raw.toString("utf8")));

      socket.on("close", () => {
        this.wsClients.get(docId)?.delete(socket);
      });
    });
  }

  /**
   * Server-originated document mutation (e.g. worker lifecycle updates).
   * Subscribers receive the result as a full-document replace patch.
   */
  commitServerDocUpdate(docId: string, updater: (currentData: unknown) => unknown): Doc {
    const current = this.docStore.loadDoc(docId);
    const nextData = updater(structuredClone(current.data));
    const next: Doc = { rev: current.rev + 1, data: nextData };
    this.docStore.saveDoc(docId, next);

    this.broadcastPatch(docId, next.rev, [{ op: "replace", path: "", value: next.data }]);
    return next;
  }

  /**
   * Core write pipeline: parse -> load -> rev check -> patch apply -> persist -> broadcast.
   * Never throws: any failure is reported to the sender as an error frame.
   */
  private handleClientMessage(socket: any, docId: string, raw: string): void {
    const write = parseClientWrite(raw);
    if (!write.ok) {
      this.sendRejection(socket, docId, write);
      return;
    }

    try {
      const current = this.docStore.loadDoc(docId);
      const result = applyClientWrite(current, write);
      if (!result.ok) {
        if (result.code === "patch_apply_failed") {
          this.log.warn({ docId, baseRev: write.baseRev, message: result.message, err: result.cause }, "Failed to process patch");
        }
        this.sendRejection(socket, docId, result);
        return;
      }

      this.docStore.saveDoc(docId, result.next);
      this.broadcastPatch(docId, result.next.rev, write.patch);
      safeSocketSend(socket, { ok: true, rev: result.next.rev });
      console.log("sent patch", docId, result.next.rev, write.patch);
    } catch (err) {
      // Persistence/IO failure: report and attempt re-sync, but keep the server alive.
      const causeCode = String((err as any)?.name ?? "unknown_error");
      const causeMessage = String((err as any)?.message ?? "Patch processing failed");
      this.log.warn({ docId, baseRev: write.baseRev, causeCode, causeMessage, err }, "Failed to process patch");

      let currentRev: number | undefined;
      try {
        currentRev = this.docStore.loadDoc(docId).rev;
      } catch { }

      this.sendRejection(socket, docId, {
        ok: false,
        code: "patch_apply_failed",
        message: `${causeCode}: ${causeMessage}`,
        resync: true,
        ...(currentRev !== undefined ? { rev: currentRev } : {}),
      });
    }
  }

  private sendRejection(socket: any, docId: string, rejection: ProtocolRejection): void {
    const payload: WsErrorPayload = {
      type: "error",
      docId,
      code: rejection.code,
      message: rejection.message,
      ...(rejection.resync ? { rev: rejection.rev ?? null, retryable: true } : {}),
    };
    safeSocketSend(socket, payload);

    if (rejection.resync) {
      try {
        this.sendSnapshot(socket, docId);
      } catch { }
    }
  }

  /**
   * Broadcasts one accepted patch to all subscribers of a document.
   * Payload includes final `rev` so clients can advance local base revision.
   */
  private broadcastPatch(docId: string, rev: number, patch: Operation[]): void {
    const payload = JSON.stringify({ docId, rev, patch });

    for (const c of this.sseClients.get(docId) ?? []) {
      c.reply.sse({ event: "patch", id: String(rev), data: payload });
    }

    for (const ws of this.wsClients.get(docId) ?? []) {
      safeSocketSend(ws, payload);
    }
  }

  /**
   * Sends a snapshot frame for one document to one websocket client.
   * Used on connect and after recoverable protocol errors.
   */
  private sendSnapshot(socket: any, docId: string): void {
    const doc = this.docStore.loadDoc(docId);
    safeSocketSend(socket, { type: "snapshot", docId, rev: doc.rev, data: doc.data });
    console.log("sent snapshot:", docId, doc.rev, doc.data);
  }
}
