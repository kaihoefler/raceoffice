// Shared helpers of the timing area (doc/timing-architecture.md): realtime documents of the
// timing layer, worker liveness, labels and REST calls.

import { useEffect, useState } from "react";
import {
  makeLiveTrackingRuntimeDocId,
  TIMING_CONNECTION_DOC_ID,
  TIMING_DECODERS_DOC_ID,
  TIMING_DECODER_SILENCE_WARNING_MS,
  TIMING_STATUS_DOC_ID,
  type LiveTrackingRuntimeDocument,
  type TimingConnectionDocument,
  type TimingDecoder,
  type TimingDecoderStatus,
  type TimingDecodersDocument,
  type TimingStatusDocument,
} from "@raceoffice/domain";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

/** The worker writes a heartbeat every 5 s; older than this counts as offline. */
export const WORKER_HEARTBEAT_STALE_MS = 30_000;

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useTimingDocs() {
  const decoders = useRealtimeDoc<TimingDecodersDocument>(TIMING_DECODERS_DOC_ID);
  const connection = useRealtimeDoc<TimingConnectionDocument>(TIMING_CONNECTION_DOC_ID);
  const status = useRealtimeDoc<TimingStatusDocument>(TIMING_STATUS_DOC_ID);
  return {
    decoders: decoders.data?.decoders ?? [],
    updateDecoders: decoders.update,
    connectedIds: connection.data?.connectedDecoderIds ?? [],
    updateConnection: connection.update,
    statusById: new Map((status.data?.decoders ?? []).map((s) => [s.decoderId, s])),
    statusDoc: status.data,
    decodersDoc: decoders.data,
    connectionDoc: connection.data,
    /** Last error of the register / connection documents (e.g. a rejected write). */
    writeError: decoders.error ?? connection.error ?? null,
  };
}

export function useWorkerState(now: number) {
  const { data: runtime } = useRealtimeDoc<LiveTrackingRuntimeDocument>(makeLiveTrackingRuntimeDocId());
  const heartbeat = Date.parse(String(runtime?.workerHeartbeatAt ?? ""));
  const online = Number.isFinite(heartbeat) && now - heartbeat <= WORKER_HEARTBEAT_STALE_MS && runtime?.workerStatus !== "offline";
  return { online, runtime };
}

export const BACKEND_LABEL: Record<TimingDecoder["backend"], string> = {
  p3: "P3",
  ammc: "AMMC",
};

export type DecoderHealth = "connected" | "silent" | "connecting" | "error" | "disconnected";

/** Connection state as shown to operators, including "silent" (connected but no message). */
export function decoderHealth(status: TimingDecoderStatus | undefined, now: number): DecoderHealth {
  if (!status) return "disconnected";
  if (status.connection === "connected") {
    const last = Date.parse(String(status.lastMessageAt ?? status.connectedSince ?? ""));
    return Number.isFinite(last) && now - last > TIMING_DECODER_SILENCE_WARNING_MS ? "silent" : "connected";
  }
  return status.connection;
}

export const HEALTH_LABEL: Record<DecoderHealth, string> = {
  connected: "verbunden",
  silent: "keine Meldung",
  connecting: "verbinde …",
  error: "Fehler",
  disconnected: "getrennt",
};

export const HEALTH_COLOR: Record<DecoderHealth, "success" | "warning" | "info" | "error" | "default"> = {
  connected: "success",
  silent: "warning",
  connecting: "info",
  error: "error",
  disconnected: "default",
};

export function formatAgo(iso: string | null | undefined, now: number): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  return `vor ${Math.floor(s / 3600)} h`;
}

export function formatTime(iso: string | null | undefined): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  return `${d.toLocaleTimeString("de-DE", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** POST with optional JSON body; returns the parsed JSON (throws with the server message on errors). */
export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json as T;
}

export function nowIso(): string {
  return new Date().toISOString();
}
