import React, { createContext, useContext, useMemo } from "react";

import { useRealtimeDoc, type RealtimeStatus } from "../realtime/useRealtimeDoc";
import type { LiveTrackingVisualization, LiveTrackingVisualizationList } from "../types/liveTrackingVisualization";

export type LiveTrackingVisualizationDraft = {
  name: string;
};

type Ctx = {
  visualizationList: LiveTrackingVisualizationList | null;
  status: RealtimeStatus;
  error: string | null;
  setActiveVisualization: (id: string) => void;
  saveVisualization: (editingId: string | null, draft: LiveTrackingVisualizationDraft) => void;
  deleteVisualization: (v: LiveTrackingVisualization) => void;
};

const LiveTrackingVisualizationListContext = createContext<Ctx | null>(null);

export function LiveTrackingVisualizationListProvider({ children }: { children: React.ReactNode }) {
  const { data: visualizationList, update, status, error } = useRealtimeDoc<LiveTrackingVisualizationList>("liveTrackingVisualizationList");

  const api = useMemo<Ctx>(
    () => ({
      visualizationList,
      status,
      error,

      setActiveVisualization: (id) =>
        update((prev) => {
          const nextId = String(id ?? "").trim();
          if (!nextId) return prev;

          const visualizations: LiveTrackingVisualization[] = Array.isArray((prev as any)?.visualizations)
            ? ((prev as any).visualizations as LiveTrackingVisualization[])
            : [];

          if (visualizations.length > 0 && !visualizations.some((v) => v?.id === nextId)) return prev;

          return { ...prev, activeVisualizationId: nextId };
        }),

      saveVisualization: (editingId, draft) => {
        const name = String(draft?.name ?? "").trim();
        if (!name) return;

        update((prev) => {
          const prevVisualizations: LiveTrackingVisualization[] = Array.isArray((prev as any)?.visualizations)
            ? ((prev as any).visualizations as LiveTrackingVisualization[])
            : [];

          const exists = editingId ? prevVisualizations.some((v) => v.id === editingId) : false;

          if (editingId === null || !exists) {
            const newId = editingId ?? crypto.randomUUID();
            const next: LiveTrackingVisualization = { id: newId, name };
            return { ...prev, visualizations: [...prevVisualizations, next] };
          }

          return {
            ...prev,
            visualizations: prevVisualizations.map((v) => (v.id === editingId ? { ...v, name } : v)),
          };
        });
      },

      deleteVisualization: (v) => {
        update((prev) => {
          const prevVisualizations: LiveTrackingVisualization[] = Array.isArray((prev as any)?.visualizations)
            ? ((prev as any).visualizations as LiveTrackingVisualization[])
            : [];

          return {
            ...prev,
            visualizations: prevVisualizations.filter((x) => x.id !== v.id),
            activeVisualizationId: prev.activeVisualizationId === v.id ? null : prev.activeVisualizationId,
          };
        });
      },
    }),
    [visualizationList, status, error, update],
  );

  return <LiveTrackingVisualizationListContext.Provider value={api}>{children}</LiveTrackingVisualizationListContext.Provider>;
}

export function useLiveTrackingVisualizationList() {
  const ctx = useContext(LiveTrackingVisualizationListContext);
  if (!ctx) throw new Error("useLiveTrackingVisualizationList must be used within LiveTrackingVisualizationListProvider");
  return ctx;
}
