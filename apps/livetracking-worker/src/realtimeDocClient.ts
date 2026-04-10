import { applyPatch, compare, type Operation } from "fast-json-patch/index.mjs";
import WebSocket from "ws";

export type RealtimeDocStatus = "connecting" | "connected" | "disconnected" | "error";

type SnapshotMessage<T> = {
  type: "snapshot";
  docId: string;
  rev: number;
  data: T;
};

type PatchMessage = {
  docId: string;
  rev: number;
  patch: Operation[];
};

type ErrorMessage = {
  type?: "error";
  code?: string;
  error?: string;
  message?: string;
};

function toWsUrl(baseHttpUrl: string, docId: string): string {
  const base = new URL(baseHttpUrl);
  const protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const encodedDocId = encodeURIComponent(docId);
  return `${protocol}//${base.host}/ws/${encodedDocId}`;
}

function parseJson(raw: WebSocket.RawData): unknown | null {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class RealtimeDocClient<T extends object> {
  private readonly url: string;
  private readonly reconnectDelayMs: number;
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<(data: T) => void>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  public status: RealtimeDocStatus = "disconnected";
  public rev = 0;
  public data: T | null = null;

  constructor(
    readonly docId: string,
    baseHttpUrl: string,
    options?: { reconnectDelayMs?: number },
  ) {
    this.url = toWsUrl(baseHttpUrl, docId);
    this.reconnectDelayMs = Math.max(100, options?.reconnectDelayMs ?? 1000);
  }

  connect() {
    if (this.closed) return;
    this.clearReconnectTimer();

    this.status = "connecting";
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.status = "connected";
    });

    socket.on("message", (raw) => {
      if (this.socket !== socket) return;
      const msg = parseJson(raw);
      if (!msg || typeof msg !== "object") return;

      const errorMsg = msg as ErrorMessage;
      const code = errorMsg.code ?? errorMsg.error;
      if (code) {
        if (code === "rev_mismatch") {
          // Re-sync via fresh snapshot by forcing reconnect.
          socket.close();
          return;
        }

        this.status = "error";
        return;
      }

      const maybeSnapshot = msg as SnapshotMessage<T>;
      if (maybeSnapshot.type === "snapshot" && typeof maybeSnapshot.rev === "number") {
        this.rev = maybeSnapshot.rev;
        this.data = maybeSnapshot.data;
        this.notifyData(maybeSnapshot.data);
        return;
      }

      const patchMsg = msg as PatchMessage;
      if (Array.isArray(patchMsg.patch) && typeof patchMsg.rev === "number" && this.data) {
        const next = applyPatch(structuredClone(this.data), patchMsg.patch, true, true).newDocument as T;
        this.data = next;
        this.rev = patchMsg.rev;
        this.notifyData(next);
      }
    });

    socket.on("error", () => {
      if (this.socket !== socket) return;
      this.status = "error";
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.status = "disconnected";
      this.socket = null;
      this.scheduleReconnect();
    });
  }

  close() {
    this.closed = true;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = null;
    this.status = "disconnected";
    this.listeners.clear();
  }

  onData(listener: (data: T) => void): () => void {
    this.listeners.add(listener);
    if (this.data) listener(this.data);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(mutator: (prev: T) => T): boolean {
    const socket = this.socket;
    const prev = this.data;
    if (!socket || socket.readyState !== WebSocket.OPEN || !prev) return false;

    const next = mutator(structuredClone(prev));
    const patch = compare(prev, next) as Operation[];
    if (patch.length === 0) return false;

    socket.send(JSON.stringify({ baseRev: this.rev, patch }));
    return true;
  }

  private notifyData(data: T) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
