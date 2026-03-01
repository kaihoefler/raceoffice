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
import type { FullVisualization, Visualization } from "../types/visualization";

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

function normalizeFullVisualization(raw: unknown, visualizationId: string, listEntry: Visualization | null): FullVisualization {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};

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
    fontSize: typeof obj.fontSize === "string" ? obj.fontSize : "16px",
    fontColor: typeof obj.fontColor === "string" ? obj.fontColor : "#ffffff",
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
