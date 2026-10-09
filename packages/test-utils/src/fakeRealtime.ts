// fakeRealtime.ts
//
// In-memory stand-in for the RaceOffice realtime server, for frontend component tests.
//
// The frontends talk to the server only through `new WebSocket("/ws/<docId>")`
// (src/realtime/useRealtimeDoc.ts). installFakeRealtime() replaces the global WebSocket
// with a fake bound to a FakeRealtimeServer, so pages run unchanged against in-memory
// documents. The server applies the SAME protocol rules as the real one
// (@raceoffice/domain: parseClientWrite, applyClientWrite, toErrorFrame, initialDocumentData):
// snapshot on connect, write ack + broadcast, rev_mismatch, error frames, bootstrap defaults.
//
// Messages are delivered asynchronously (microtask) and inside React's act(), like a real
// socket but without act() warnings.

import { act } from "react";
import { vi } from "vitest";
import {
  applyClientWrite,
  initialDocumentData,
  parseClientWrite,
  toErrorFrame,
  type RealtimeDoc,
} from "@raceoffice/domain";

type Handler<E> = ((event: E) => void) | null;

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

function deliver(fn: () => void): void {
  queueMicrotask(() => act(fn));
}

/** One client connection, as seen by the fake server. */
export class FakeWebSocket {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  readyState = CONNECTING;
  onopen: Handler<Event> = null;
  onmessage: Handler<{ data: string }> = null;
  onerror: Handler<Event> = null;
  onclose: Handler<Event> = null;

  readonly docId: string;

  constructor(
    readonly url: string,
    private readonly server: FakeRealtimeServer,
  ) {
    const path = new URL(url, "http://localhost").pathname;
    this.docId = decodeURIComponent(path.replace(/^.*\/ws\//, ""));
    server.connect(this);
  }

  send(data: string): void {
    if (this.readyState !== OPEN) throw new Error("FakeWebSocket: send on a socket that is not open");
    this.server.receive(this, String(data));
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.server.disconnect(this);
    deliver(() => this.onclose?.(new Event("close")));
  }

  /** Called by the server. */
  open(): void {
    this.readyState = OPEN;
    deliver(() => this.onopen?.(new Event("open")));
  }

  /** Called by the server. */
  push(frame: unknown): void {
    if (this.readyState === CLOSED) return;
    const data = JSON.stringify(frame);
    deliver(() => this.onmessage?.({ data }));
  }
}

export class FakeRealtimeServer {
  private readonly docs = new Map<string, RealtimeDoc>();
  private readonly sockets = new Map<string, Set<FakeWebSocket>>();

  /** Puts a document in place before the page connects (rev defaults to 0). */
  seed(docId: string, data: unknown, rev = 0): this {
    this.docs.set(docId, { rev, data: structuredClone(data) });
    return this;
  }

  /** Current document; never-written ids get the same bootstrap defaults as the real server. */
  doc(docId: string): RealtimeDoc {
    let doc = this.docs.get(docId);
    if (!doc) {
      doc = { rev: 0, data: initialDocumentData(docId) };
      this.docs.set(docId, doc);
    }
    return doc;
  }

  /** Server-originated change (like the worker manager): broadcast as a full replace. */
  update(docId: string, updater: (data: any) => unknown): RealtimeDoc {
    const current = this.doc(docId);
    const next: RealtimeDoc = { rev: current.rev + 1, data: updater(structuredClone(current.data)) };
    this.docs.set(docId, next);
    this.broadcast(docId, next.rev, [{ op: "replace", path: "", value: next.data }]);
    return next;
  }

  /** Number of open connections for a document. */
  connections(docId: string): number {
    return this.sockets.get(docId)?.size ?? 0;
  }

  connect(socket: FakeWebSocket): void {
    if (!this.sockets.has(socket.docId)) this.sockets.set(socket.docId, new Set());
    this.sockets.get(socket.docId)!.add(socket);
    socket.open();
    this.sendSnapshot(socket);
  }

  disconnect(socket: FakeWebSocket): void {
    this.sockets.get(socket.docId)?.delete(socket);
  }

  /** The write pipeline of RealtimeHub: validate, rev check, apply, store, broadcast, ack. */
  receive(socket: FakeWebSocket, raw: string): void {
    const write = parseClientWrite(raw);
    if (!write.ok) {
      socket.push(toErrorFrame(socket.docId, write));
      return;
    }

    const result = applyClientWrite(this.doc(socket.docId), write);
    if (!result.ok) {
      socket.push(toErrorFrame(socket.docId, result));
      if (result.resync) this.sendSnapshot(socket);
      return;
    }

    this.docs.set(socket.docId, result.next);
    this.broadcast(socket.docId, result.next.rev, write.patch);
    socket.push({ ok: true, rev: result.next.rev });
  }

  private broadcast(docId: string, rev: number, patch: unknown[]): void {
    for (const s of this.sockets.get(docId) ?? []) s.push({ docId, rev, patch });
  }

  private sendSnapshot(socket: FakeWebSocket): void {
    const doc = this.doc(socket.docId);
    socket.push({ type: "snapshot", docId: socket.docId, rev: doc.rev, data: doc.data });
  }
}

/**
 * Replaces the global WebSocket with a fake bound to `server` (restore with
 * vi.unstubAllGlobals(), e.g. in afterEach). Returns the server for seeding and assertions.
 */
export function installFakeRealtime(server: FakeRealtimeServer = new FakeRealtimeServer()): FakeRealtimeServer {
  class BoundFakeWebSocket extends FakeWebSocket {
    constructor(url: string | URL) {
      super(String(url), server);
    }
  }
  vi.stubGlobal("WebSocket", BoundFakeWebSocket);
  return server;
}
