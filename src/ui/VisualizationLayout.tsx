// src/ui/VisualizationLayout.tsx
//
// VisualizationLayout
// -------------------
// Zweck:
// - Fullscreen Layout für die Videowand-Visualisierung (ohne AppBar/Menu)
// - Stellt der Unterseite (Outlet) die aktuell aktive Visualisierung + das aktive Event bereit
//
// Datenquellen:
// - useEventList: activeEventId + Event-Liste (lightweight)
// - useVisualizationList: activeVisualizationId + Visualization-Liste (lightweight)
// - useRealtimeDoc("Event-{id}"): FullEvent
// - useRealtimeDoc("Visualization-{id}"): FullVisualization

import { useMemo } from "react";

import { Box, Typography } from "@mui/material";

import { Outlet, useParams } from "react-router-dom";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

import { useEventList } from "../providers/EventListProvider";
import { useVisualizationList } from "../providers/VisualizationListProvider";

import type { Event, FullEvent } from "../types/event";
import type { FullVisualization, Visualization, VisualizationColumnAlign } from "../types/visualization";

export type VisualizationOutletContext = {
  event: FullEvent | null;
  visualization: FullVisualization | null;
};

function normalizeFullEvent(raw: unknown, eventId: string, listEntry: Event | null): FullEvent {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

  const races = Array.isArray(obj.races) ? obj.races : [];

  return {
    id: typeof obj.id === "string" ? obj.id : eventId,
    name: typeof listEntry?.name === "string" && listEntry.name ? listEntry.name : typeof obj.name === "string" ? obj.name : "",
    slug: typeof listEntry?.slug === "string" && listEntry.slug ? listEntry.slug : typeof obj.slug === "string" ? obj.slug : "",
    activeRaceId: typeof obj.activeRaceId === "string" ? obj.activeRaceId : null,
    ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
    races: races.map((r: any) => ({
      ...r,
      raceResults: Array.isArray(r?.raceResults) ? r.raceResults : [],
      raceStarters: Array.isArray(r?.raceStarters) ? r.raceStarters : [],
      raceActivities: Array.isArray(r?.raceActivities) ? r.raceActivities : [],
    })),
    athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
  };
}

function normalizeColumnAlign(value: unknown): VisualizationColumnAlign {
  return value === "center" || value === "right" ? value : "left";
}

function normalizeFullVisualization(raw: unknown, visualizationId: string, listEntry: Visualization | null): FullVisualization {
  // Normalisiert das Realtime-Dokument robust auf FullVisualization.
  // Fehlende/ungültige Felder erhalten sinnvolle Defaults, damit die Anzeige
  // auch bei unvollständigen Alt-Dokumenten stabil bleibt.
  const obj = raw && typeof raw === "object" ? (raw as any) : {};
  const columns = Array.isArray(obj.columns)
    ? obj.columns.map((col: any) => ({
        columnTitle: typeof col?.columnTitle === "string" ? col.columnTitle : "",
        columnWidth: typeof col?.columnWidth === "string" ? col.columnWidth : "",
        columnAlign: normalizeColumnAlign(col?.columnAlign),
        columnFallback: typeof col?.columnFallback === "string" ? col.columnFallback : "",
        columnContent: typeof col?.columnContent === "string" ? col.columnContent : "",
      }))
    : [];

  return {
    id: typeof obj.id === "string" ? obj.id : visualizationId,
    // keep name consistent with list entry (table)
    name:
      typeof listEntry?.name === "string" && listEntry.name
        ? listEntry.name
        : typeof obj.name === "string"
          ? obj.name
          : "",
    backgroundColor: typeof obj.backgroundColor === "string" ? obj.backgroundColor : "#000000",
    alternateRowBackgroundColor:
      typeof obj.alternateRowBackgroundColor === "string" ? obj.alternateRowBackgroundColor : "",
    usePaging: typeof obj.usePaging === "boolean" ? obj.usePaging : false,
    // Steuert die optionale "..."-Indikatorzeile in VisualizerPage für
    // ausgeblendete Fahrer ohne anzeigbares Resultat (DNS bleibt weiterhin komplett unsichtbar).
    showSkippedRowsIndicator:
      typeof obj.showSkippedRowsIndicator === "boolean" ? obj.showSkippedRowsIndicator : false,
    pagingLines: typeof obj.pagingLines === "number" && Number.isFinite(obj.pagingLines) ? Math.max(0, Math.floor(obj.pagingLines)) : 10,
    pagingTime: typeof obj.pagingTime === "number" && Number.isFinite(obj.pagingTime) ? Math.max(0, Math.floor(obj.pagingTime)) : 0,
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "16px",
    fontWeight: typeof obj.fontWeight === "string" ? obj.fontWeight : "400",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
    columns,
  };
}

export default function VisualizationLayout() {
  const { visualizationId: visualizationIdParam } = useParams<{ visualizationId?: string }>();

  const { eventList } = useEventList();
  const { visualizationList } = useVisualizationList();

  const activeEventId = eventList?.activeEventId ?? null;
  const activeVisualizationId = visualizationList?.activeVisualizationId ?? null;

  // If the route provides a specific visualizationId, prefer that.
  const effectiveVisualizationId = (visualizationIdParam ? String(visualizationIdParam).trim() : "") || activeVisualizationId;

  const eventListEntry = useMemo(() => {
    if (!activeEventId) return null;
    return eventList?.events.find((e) => e.id === activeEventId) ?? null;
  }, [eventList?.events, activeEventId]);

  const visualizationListEntry = useMemo(() => {
    if (!effectiveVisualizationId) return null;
    return visualizationList?.visualizations.find((v) => v.id === effectiveVisualizationId) ?? null;
  }, [visualizationList?.visualizations, effectiveVisualizationId]);

  const eventDocId = activeEventId ? `Event-${activeEventId}` : null;
  const visualizationDocId = effectiveVisualizationId ? `Visualization-${effectiveVisualizationId}` : null;

  const { data: rawEvent } = useRealtimeDoc<Partial<FullEvent>>(eventDocId);
  const { data: rawVisualization } = useRealtimeDoc<Partial<FullVisualization>>(visualizationDocId);

  const event = useMemo(() => {
    if (!activeEventId) return null;
    return normalizeFullEvent(rawEvent, activeEventId, eventListEntry);
  }, [rawEvent, activeEventId, eventListEntry]);

  const visualization = useMemo(() => {
    if (!effectiveVisualizationId) return null;
    return normalizeFullVisualization(rawVisualization, effectiveVisualizationId, visualizationListEntry);
  }, [rawVisualization, effectiveVisualizationId, visualizationListEntry]);

  // Fullscreen canvas-like area for video wall.
  return (
    <Box
      sx={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        bgcolor: visualization?.backgroundColor ?? "#000",
      }}
    >
      {!effectiveVisualizationId ? (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            No active visualization selected.
          </Typography>
        </Box>
      ) : null}

      <Outlet context={{ event, visualization } satisfies VisualizationOutletContext} />
    </Box>
  );
}
