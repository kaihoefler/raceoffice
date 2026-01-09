// src/providers/EventListProvider.tsx
import React, { createContext, useContext, useMemo } from "react";
import { useRealtimeDoc, type RealtimeStatus } from "../realtime/useRealtimeDoc";
import type { EventList, Event } from "../types/event";
import type { EventDraft } from "../components/EventEditor";

type Ctx = {
  eventList: EventList | null;

  // Realtime transport status for the underlying "eventList" doc
  status: RealtimeStatus;
  error: string | null;

  // Convenience/derived state (no separate source of truth)
  activeEventId: string | null;
  currentEvent: Event | null;

  setActiveEvent: (id: string) => void;
  saveEvent: (editingId: string | null, draft: EventDraft) => void;
  deleteEvent: (e: Event) => void;
};

const EventListContext = createContext<Ctx | null>(null);

export function EventListProvider({ children }: { children: React.ReactNode }) {
  const { data: eventList, update, status, error } = useRealtimeDoc<EventList>("eventList");

  const api = useMemo<Ctx>(() => {
    const activeEventId = eventList?.activeEventId ?? null;

    // Derive the active event from the single source of truth (eventList)
    const currentEvent =
      eventList && activeEventId
        ? eventList.events.find((e) => e.id === activeEventId) ?? null
        : null;

    return {
      eventList,
      status,
      error,

      activeEventId,
      currentEvent,

      setActiveEvent: (id) => update((prev) => ({ ...prev, activeEventId: id })),

      saveEvent: (editingId, draft) => {
        const name = draft.name.trim();
        if (!name) return;

        const slug = draft.slug;

        // CREATE
        if (editingId === null) {
          const newEventId = crypto.randomUUID();

          const newEvent: Event = {
            id: newEventId,
            name,
            slug,
            ageGroups: draft.ageGroups
              .filter((ag) => ag.name.trim() !== "")
              .map((ag) => ({
                ...ag,
                name: ag.name.trim(),
                eventId: newEventId,
              })),
          };

          update((prev) => ({ ...prev, events: [newEvent, ...prev.events] }));
          return;
        }

        // UPDATE
        const normalizedAgeGroups = draft.ageGroups
          .filter((ag) => ag.name.trim() !== "")
          .map((ag) => ({
            ...ag,
            name: ag.name.trim(),
            eventId: editingId,
          }));

        update((prev) => ({
          ...prev,
          events: prev.events.map((e) =>
            e.id === editingId ? { ...e, name, slug, ageGroups: normalizedAgeGroups } : e
          ),
        }));
      },

      deleteEvent: (e) => {
        update((prev) => ({
          ...prev,
          events: prev.events.filter((x) => x.id !== e.id),
          activeEventId: prev.activeEventId === e.id ? null : prev.activeEventId,
        }));
      },
    };
  }, [eventList, status, error, update]);

  return <EventListContext.Provider value={api}>{children}</EventListContext.Provider>;
}

export function useEventList() {
  const ctx = useContext(EventListContext);
  if (!ctx) throw new Error("useEventList must be used within EventListProvider");
  return ctx;
}

/**
 * Convenience hook: components that only care about the currently active event
 * can use this instead of reading/navigating the whole EventList.
 */
export function useCurrentEvent() {
  const { currentEvent, activeEventId, setActiveEvent, status, error } = useEventList();
  return { currentEvent, activeEventId, setActiveEvent, status, error };
}

/**
 * Strict variant: if your route/page requires an active event, this hook will
 * fail fast instead of forcing null-checks everywhere.
 */
export function useRequiredCurrentEvent() {
  const { currentEvent, ...rest } = useCurrentEvent();
  if (!currentEvent) throw new Error("No active event selected");
  return { currentEvent, ...rest };
}