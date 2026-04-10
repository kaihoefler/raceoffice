import { useCallback, useEffect, useRef, useState } from "react";
import { applyPatch, compare, type Operation } from "fast-json-patch";
import { useRealtimeConnections } from "./RealtimeConnectionProvider";

type SnapshotMsg<T> = { type: "snapshot"; docId: string; rev: number; data: T };
type PatchMsg = { docId: string; rev: number; patch: Operation[] };
type ErrorMsg = { type?: "error"; code?: string; error?: string; message?: string; rev?: number };

export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

export function useRealtimeDoc<T>(docId: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const dataRef = useRef<T | null>(null);
  const revRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  const connCtx = useRealtimeConnections();

  const report = (s: RealtimeStatus, e: string | null = null) => {
    if (!docId) return;
    connCtx?.setConnection(docId, s, e);
  };

  useEffect(() => {
    if (!docId) {
      dataRef.current = null;
      revRef.current = 0;
      setData(null);
      setStatus("disconnected");
      setError(null);
      return;
    }

    setStatus("connecting");
    setError(null);
    report("connecting");

    const wsUrl = new URL(`/ws/${docId}`, window.location.origin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    const isCurrent = () => wsRef.current === ws;

    ws.onopen = () => {
      if (!isCurrent()) return;
      setStatus("connected");
      report("connected");
      setError(null);
    };

    ws.onerror = () => {
      if (!isCurrent()) return;
      setStatus("error");
      report("error", "WebSocket error");
      setError("WebSocket error");
    };

    ws.onclose = () => {
      if (!isCurrent()) return;
      setStatus("disconnected");
      report("disconnected");
    };

    ws.onmessage = (ev) => {
      if (!isCurrent()) return;

      let msg: unknown;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        setStatus("error");
        report("error", "Invalid JSON message");
        setError("Invalid JSON message");
        return;
      }

      const err = msg as ErrorMsg;
      const errorCode = typeof err.code === "string" ? err.code : typeof err.error === "string" ? err.error : null;

      if (errorCode) {
        if (errorCode === "rev_mismatch") {
          setStatus("connecting");
          report("connecting", "Revision mismatch. Reconnecting…");
          setReconnectNonce((n) => n + 1);
          return;
        }

        setStatus("error");
        report("error", err.message ?? errorCode);
        setError(err.message ?? errorCode);
        return;
      }

      const snapshot = msg as SnapshotMsg<T>;
      if (snapshot.type === "snapshot") {
        revRef.current = snapshot.rev;
        dataRef.current = snapshot.data;
        setData(snapshot.data);
        return;
      }

      const patch = msg as PatchMsg;
      if (!Array.isArray(patch.patch) || typeof patch.rev !== "number") return;

      setData((prev) => {
        if (!prev) return prev;
        const next = applyPatch(structuredClone(prev), patch.patch, true, true).newDocument as T;
        revRef.current = patch.rev;
        dataRef.current = next;
        return next;
      });
    };

    return () => {
      if (wsRef.current === ws) wsRef.current = null;
      ws.close();
    };
  }, [docId, reconnectNonce]);

  const update = useCallback((fn: (prev: T) => T) => {
    const prev = dataRef.current;
    if (prev === null) return;

    const next = fn(prev);
    const patch = compare(prev as object, next as object) as Operation[];

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && patch.length > 0) {
      ws.send(JSON.stringify({ baseRev: revRef.current, patch }));
    }
  }, []);

  return { data, status, error, update };
}
