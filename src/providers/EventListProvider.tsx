// src/providers/EventListProvider.tsx
import React, { createContext, useContext, useMemo } from "react";
import { useRealtimeDoc, type RealtimeStatus } from "../realtime/useRealtimeDoc";
import type { EventList, Event } from "../types/event";
import type { EventDraft } from "../components/EventEditor";

type Ctx = {
  eventList: EventList | null;
  status: RealtimeStatus;
  error: string | null;

  setActiveEvent: (id: string) => void;

  /**
   * If editingId is null -> create with random id
   * If editingId is set but not found in list -> create with that id
   * If editingId is found -> update
   */
  saveEvent: (editingId: string | null, draft: EventDraft) => void;

  deleteEvent: (e: Event) => void;
};

const EventListContext = createContext<Ctx | null>(null);

export function EventListProvider({ children }: { children: React.ReactNode }) {
  const { data: eventList, update, status, error } = useRealtimeDoc<EventList>("eventList");

  const api = useMemo<Ctx>(
    () => ({
      eventList,
      status,
      error,

      setActiveEvent: (id) => update((prev) => ({ ...prev, activeEventId: id })),

      saveEvent: (editingId, draft) => {
        const name = draft.name.trim();
        if (!name) return;

        const slug = draft.slug;

        update((prev) => {
          const exists = editingId ? prev.events.some((e) => e.id === editingId) : false;

          // CREATE (either explicit id from caller, or generated)
          if (editingId === null || !exists) {
            const newEventId = editingId ?? crypto.randomUUID();

            const newEvent: Event = {
              id: newEventId,
              name,
              slug,
            };

            return { ...prev, events: [newEvent, ...prev.events] };
          }

          // UPDATE
          return {
            ...prev,
            events: prev.events.map((e) => (e.id === editingId ? { ...e, name, slug } : e)),
          };
        });
      },

      deleteEvent: (e) => {
        update((prev) => ({
          ...prev,
          events: prev.events.filter((x) => x.id !== e.id),
          activeEventId: prev.activeEventId === e.id ? null : prev.activeEventId,
        }));
      },
    }),
    [eventList, status, error, update]
  );

  return <EventListContext.Provider value={api}>{children}</EventListContext.Provider>;
}

export function useEventList() {
  const ctx = useContext(EventListContext);
  if (!ctx) throw new Error("useEventList must be used within EventListProvider");
  return ctx;
}