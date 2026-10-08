/**
 * Minimal client for the `/ws/:docId` realtime protocol, built on Node's global WebSocket.
 * Incoming frames are queued so tests can await them in order.
 */
export type DocClient = {
  /** Resolves with the next queued frame matching `predicate` (default: any frame). */
  next(predicate?: (msg: any) => boolean, timeoutMs?: number): Promise<any>;
  /** Sends an object as JSON, or a raw string as-is. */
  send(payload: unknown): void;
  close(): Promise<void>;
};

export async function connectDoc(baseUrl: string, docId: string): Promise<DocClient> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/${encodeURIComponent(docId)}`);

  const queue: any[] = [];
  const waiters: Array<{ predicate: (msg: any) => boolean; resolve: (msg: any) => void }> = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    const waiterIdx = waiters.findIndex((w) => w.predicate(msg));
    if (waiterIdx >= 0) {
      waiters.splice(waiterIdx, 1)[0]!.resolve(msg);
    } else {
      queue.push(msg);
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`WebSocket connect failed for ${docId}`)), { once: true });
  });

  return {
    next(predicate = () => true, timeoutMs = 3000) {
      const queuedIdx = queue.findIndex(predicate);
      if (queuedIdx >= 0) return Promise.resolve(queue.splice(queuedIdx, 1)[0]);

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (msg: any) => {
            clearTimeout(timer);
            resolve(msg);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for a frame on ${docId}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },

    send(payload) {
      ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    },

    close() {
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise((resolve) => {
        ws.addEventListener("close", () => resolve(), { once: true });
        ws.close();
      });
    },
  };
}

export const isSnapshot = (msg: any) => msg?.type === "snapshot";
export const isError = (msg: any) => msg?.type === "error";
export const isAck = (msg: any) => msg?.ok === true;
export const isPatch = (msg: any) => Array.isArray(msg?.patch);
