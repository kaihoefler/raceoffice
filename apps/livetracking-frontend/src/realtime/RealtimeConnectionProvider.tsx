// src/realtime/RealtimeConnectionProvider.tsx
import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

/**
 * High-level connection state for a realtime transport (e.g. SSE/WebSocket) per document.
 * Keeping this as a narrow union makes it easy to aggregate for UI badges/headers.
 */
export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

/**
 * Per-document connection metadata.
 * - `error`: last known error message (if any)
 * - `updatedAt`: timestamp of the last state transition; useful for debugging/telemetry and "stale" UIs
 */
type ConnInfo = { status: RealtimeStatus; error: string | null; updatedAt: number };

/**
 * Context contract:
 * - `connections`: map keyed by docId so independent realtime docs don't overwrite each other
 * - `setConnection`: single mutation entrypoint to update the state for a docId
 */
type Ctx = {
  connections: Record<string, ConnInfo>;
  setConnection: (docId: string, status: RealtimeStatus, error?: string | null) => void;
};

/**
 * Context starts as `null` so consumers can decide whether they require the provider.
 * (Some apps prefer throwing here; this implementation chooses "optional context".)
 */
const RealtimeConnectionContext = createContext<Ctx | null>(null);

/**
 * Provider that tracks realtime connection state for multiple docs.
 *
 * Typical usage:
 * - each `useRealtimeDoc(docId)` (or similar hook) calls `setConnection(docId, ...)` on lifecycle changes
 * - UI can read per-doc state or an aggregated "overall" status
 */
export function RealtimeConnectionProvider({ children }: { children: React.ReactNode }) {
  /**
   * Map from docId -> connection info.
   * We store everything in a single state object to enable cheap aggregation and easy debugging.
   */
  const [connections, setConnections] = useState<Record<string, ConnInfo>>({});

  /**
   * Stable setter to update a single doc's connection info.
   * Uses functional `setState` to avoid stale closures when multiple docs update concurrently.
   */
  const setConnection = useCallback(
    (docId: string, status: RealtimeStatus, error: string | null = null) => {
      setConnections((prev) => ({
        ...prev,
        [docId]: { status, error, updatedAt: Date.now() },
      }));
    },
    []
  );

  /**
   * Memoize context value to avoid re-rendering all consumers due to object identity changes,
   * except when `connections` actually changes.
   */
  const value = useMemo(() => ({ connections, setConnection }), [connections, setConnection]);

  return <RealtimeConnectionContext.Provider value={value}>{children}</RealtimeConnectionContext.Provider>;
}

/**
 * Accessor hook for the connection context.
 *
 * Note: This returns `Ctx | null`. That means callers must handle missing provider.
 * If you want a stricter API, consider throwing when context is null (like your `useEventList()` does
 * in `src/providers/EventListProvider.tsx`).
 */
export function useRealtimeConnections() {
  return useContext(RealtimeConnectionContext);
}

/**
 * Aggregates per-doc connection states into a single status for UI (e.g. header indicator).
 *
 * Precedence is intentionally "worst wins":
 * - if any doc is in error -> overall is error
 * - else if any is disconnected -> disconnected
 * - else if any is connecting -> connecting
 * - else if any is connected -> connected
 *
 * Fallback returns "disconnected" for the case where there are no tracked connections yet.
 */
export function useRealtimeOverallStatus() {
  const ctx = useRealtimeConnections();
  const list = ctx ? Object.values(ctx.connections) : [];

  if (list.some((c) => c.status === "error")) return "error" as const;
  if (list.some((c) => c.status === "disconnected")) return "disconnected" as const;
  if (list.some((c) => c.status === "connecting")) return "connecting" as const;
  if (list.some((c) => c.status === "connected")) return "connected" as const;

  // No connections tracked yet (or provider missing) -> treat as not connected.
  return "disconnected" as const;
}