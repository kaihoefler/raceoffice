// src/providers/VisualizationListProvider.tsx
//
// VisualizationListProvider
// ------------------------
// Zweck:
// - Lädt und verwaltet die globale Visualization-Liste (VisualizationList) aus dem Realtime-Store (useRealtimeDoc)
// - Stellt die Liste + Status/Fehler sowie CRUD-Funktionen über React Context bereit
//
// Datenmodell (vereinfacht):
// - VisualizationList enthält i.d.R.:
//   - visualizations: Visualization[]
//   - activeVisualizationId: string | null
//
// Hinweise:
// - Änderungen werden über update(...) zurück in das Realtime-Dokument geschrieben.
// - saveVisualization(...) unterstützt "Create" und "Update" anhand editingId.
// - deleteVisualization(...) entfernt Visualization und setzt activeVisualizationId auf null,
//   falls die gelöschte Visualization aktiv war.

import React, { createContext, useContext, useMemo } from "react";

import { useRealtimeDoc, type RealtimeStatus } from "../realtime/useRealtimeDoc";

import type { Visualization, VisualizationList } from "../types/visualization";

/**
 * Minimaler Draft für Create/Update.
 * (Analog zu EventDraft; ein dedizierter Editor kann später darauf aufbauen.)
 */
export type VisualizationDraft = {
  name: string;
};

/**
 * Context-API, die Consumer erhalten.
 */
type Ctx = {
  visualizationList: VisualizationList | null;
  status: RealtimeStatus;
  error: string | null;

  /** Markiert eine Visualization als aktiv (setzt activeVisualizationId im Realtime-Dokument). */
  setActiveVisualization: (id: string) => void;

  /**
   * Speichert eine Visualization (Create oder Update).
   *
   * Regeln:
   * - editingId === null -> Create mit zufälliger ID
   * - editingId != null, aber nicht in Liste -> Create mit genau dieser ID
   * - editingId != null und existiert -> Update dieser Visualization
   */
  saveVisualization: (editingId: string | null, draft: VisualizationDraft) => void;

  /**
   * Löscht eine Visualization aus der Liste.
   * Wenn die gelöschte Visualization aktiv war, wird activeVisualizationId auf null gesetzt.
   */
  deleteVisualization: (v: Visualization) => void;
};

const VisualizationListContext = createContext<Ctx | null>(null);

export function VisualizationListProvider({ children }: { children: React.ReactNode }) {
  /**
   * Realtime-Dokument "visualizationList" laden/abonnieren.
   */
  const { data: visualizationList, update, status, error } = useRealtimeDoc<VisualizationList>("visualizationList");

  const api = useMemo<Ctx>(
    () => ({
      visualizationList,
      status,
      error,

      setActiveVisualization: (id) =>
        update((prev) => {
          const nextId = String(id ?? "").trim();
          if (!nextId) return prev;

          const visualizations: Visualization[] = Array.isArray((prev as any)?.visualizations)
            ? ((prev as any).visualizations as Visualization[])
            : [];

          // Wenn Liste vorhanden ist, aber die ID nicht existiert -> keine Änderung
          if (visualizations.length > 0 && !visualizations.some((v) => v?.id === nextId)) return prev;

          return { ...prev, activeVisualizationId: nextId };
        }),

      saveVisualization: (editingId, draft) => {
        const name = String(draft?.name ?? "").trim();
        if (!name) return;

        update((prev) => {
          const prevVisualizations: Visualization[] = Array.isArray((prev as any)?.visualizations)
            ? ((prev as any).visualizations as Visualization[])
            : [];

          const exists = editingId ? prevVisualizations.some((v) => v.id === editingId) : false;

          // CREATE
          if (editingId === null || !exists) {
            const newId = editingId ?? crypto.randomUUID();

            const next: Visualization = {
              id: newId,
              name,
            };

            // Append new visualizations to the end (new entries are rare and should not jump to the top).
            return { ...prev, visualizations: [...prevVisualizations, next] };
          }

          // UPDATE
          return {
            ...prev,
            visualizations: prevVisualizations.map((v) => (v.id === editingId ? { ...v, name } : v)),
          };
        });
      },

      deleteVisualization: (v) => {
        update((prev) => {
          const prevVisualizations: Visualization[] = Array.isArray((prev as any)?.visualizations)
            ? ((prev as any).visualizations as Visualization[])
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

  return <VisualizationListContext.Provider value={api}>{children}</VisualizationListContext.Provider>;
}

/**
 * Hook für Consumer.
 */
export function useVisualizationList() {
  const ctx = useContext(VisualizationListContext);
  if (!ctx) throw new Error("useVisualizationList must be used within VisualizationListProvider");
  return ctx;
}
