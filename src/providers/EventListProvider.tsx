// src/providers/EventListProvider.tsx
//
// EventListProvider
// -----------------
// Zweck:
// - Lädt und verwaltet die globale Event-Liste (EventList) aus dem Realtime-Store (useRealtimeDoc)
// - Stellt die Liste + Status/Fehler sowie CRUD-Funktionen über React Context bereit
//
// Datenmodell (vereinfacht):
// - EventList enthält i.d.R.:
//   - events: Event[]
//   - activeEventId: string | null
//
// Hinweise:
// - Änderungen werden über update(...) zurück in das Realtime-Dokument geschrieben.
// - saveEvent(...) unterstützt "Create" und "Update" anhand editingId.
// - deleteEvent(...) entfernt Event und setzt activeEventId auf null, falls das gelöschte Event aktiv war.

import React, { createContext, useContext, useMemo } from "react";
import { useRealtimeDoc, type RealtimeStatus } from "../realtime/useRealtimeDoc";
import type { Event, EventList } from "@raceoffice/domain";

import type { EventDraft } from "../components/EventEditor";

/**
 * Context-API, die Consumer erhalten.
 * - eventList: aktuelle EventList (oder null solange nicht geladen/initialisiert)
 * - status/error: Status des Realtime-Dokuments
 * - setActiveEvent: setzt activeEventId
 * - saveEvent: Create/Update eines Events
 * - deleteEvent: Event löschen (inkl. activeEventId ggf. zurücksetzen)
 */
type Ctx = {
  eventList: EventList | null;
  status: RealtimeStatus;
  error: string | null;

  /** Markiert ein Event als aktiv (setzt activeEventId im Realtime-Dokument). */
  setActiveEvent: (id: string) => void;

  /**
   * Speichert ein Event (Create oder Update).
   *
   * Regeln:
   * - editingId === null -> Create mit zufälliger ID
   * - editingId != null, aber nicht in Liste -> Create mit genau dieser ID
   * - editingId != null und existiert -> Update dieses Events
   */
  saveEvent: (editingId: string | null, draft: EventDraft) => void;

  /**
   * Löscht ein Event aus der Liste.
   * Wenn das gelöschte Event aktiv war, wird activeEventId auf null gesetzt.
   */
  deleteEvent: (e: Event) => void;
};

const EventListContext = createContext<Ctx | null>(null);

export function EventListProvider({ children }: { children: React.ReactNode }) {
  /**
   * Realtime-Dokument "eventList" laden/abonnieren.
   * - data: EventList
   * - update: funktionaler Updater, um Änderungen zu persistieren
   * - status/error: Verbindungs-/Lade-Status
   */
  const { data: eventList, update, status, error } = useRealtimeDoc<EventList>("eventList");

  /**
   * Memoized Context-Value:
   * - verhindert unnötige Re-Renders der Consumer, wenn sich die Referenzen nicht ändern
   * - enthält State + "API"-Funktionen, die intern update(...) nutzen
   */
  const api = useMemo<Ctx>(
    () => ({
      eventList,
      status,
      error,

      /**
       * Setzt das aktive Event.
       *
       * Defensive Guards:
       * - ignoriert leere/Whitespace-IDs
       * - wenn eine Event-Liste vorhanden ist und die ID nicht existiert -> keine Änderung
       *   (verhindert inkonsistente States wie activeEventId="foo" ohne passendes Event)
       * - wenn events (noch) leer/fehlend sind, setzen wir trotzdem, damit der State nicht blockiert
       */
      setActiveEvent: (id) =>
        update((prev) => {
          const nextId = String(id ?? "").trim();
          if (!nextId) return prev;

          const events: Event[] = Array.isArray((prev as any)?.events) ? ((prev as any).events as Event[]) : [];
          if (events.length > 0 && !events.some((e) => e?.id === nextId)) return prev;

          return { ...prev, activeEventId: nextId };
        }),

      /**
       * Create/Update:
       * - Name wird getrimmt und muss nicht-leer sein
       * - Slug kommt 1:1 aus draft (hier keine weitere Validierung)
       */
      saveEvent: (editingId, draft) => {
        const name = draft.name.trim();
        if (!name) return;

        const slug = draft.slug;

        update((prev) => {
          // Defensive: prev.events sollte laut Typ existieren, kann aber bei teilinitialisierten Realtime-Docs fehlen.
          const prevEvents: Event[] = Array.isArray((prev as any)?.events) ? ((prev as any).events as Event[]) : [];

          // Prüft, ob editingId in der aktuellen Liste existiert
          const exists = editingId ? prevEvents.some((e) => e.id === editingId) : false;

          // CREATE:
          // - wenn editingId null ist -> neue zufällige ID
          // - oder wenn editingId gesetzt ist, aber (noch) nicht existiert -> Create mit der gewünschten ID
          if (editingId === null || !exists) {
            const newEventId = editingId ?? crypto.randomUUID();

            const newEvent: Event = {
              id: newEventId,
              name,
              slug,
            };

            // neues Event vorne in die Liste
            return { ...prev, events: [newEvent, ...prevEvents] };
          }

          // UPDATE:
          // - existierendes Event wird anhand id ersetzt (name/slug aktualisiert)
          return {
            ...prev,
            events: prevEvents.map((e) => (e.id === editingId ? { ...e, name, slug } : e)),
          };
        });
      },

      /**
       * Löschen:
       * - Event aus events entfernen
       * - wenn es aktiv war: activeEventId auf null setzen
       */
      deleteEvent: (e) => {
        update((prev) => {
          // Defensive: events kann (in Grenzfällen) fehlen -> dann behandeln wir es als leere Liste.
          const prevEvents: Event[] = Array.isArray((prev as any)?.events) ? ((prev as any).events as Event[]) : [];

          return {
            ...prev,
            events: prevEvents.filter((x) => x.id !== e.id),
            activeEventId: prev.activeEventId === e.id ? null : prev.activeEventId,
          };
        });
      },
    }),
    // Dependencies: wenn sich diese Werte ändern, muss das Context-Value-Objekt neu erstellt werden
    [eventList, status, error, update],
  );

  return <EventListContext.Provider value={api}>{children}</EventListContext.Provider>;
}

/**
 * Hook für Consumer:
 * - liefert den Context
 * - wirft einen klaren Fehler, wenn der Hook außerhalb des Providers verwendet wird
 */
export function useEventList() {
  const ctx = useContext(EventListContext);
  if (!ctx) throw new Error("useEventList must be used within EventListProvider");
  return ctx;
}