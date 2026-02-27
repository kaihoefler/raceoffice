import { useCallback, useMemo } from "react";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

import type { Athlete } from "../types/athlete";
import type { FullEvent } from "../types/event";
import type { Race } from "../types/race";

import { upsertStarters } from "../domain/startersActions";

import {
  buildRaceFromDraft,
  deleteRace as deleteRaceFromEvent,
  makeNextRaceTemplate,
  normalizeFullEvent,
  setActiveRace as setActiveRaceInEvent,
  upsertRace,
  type RaceDraftLike,
} from "../domain/eventActions";

export type UseEventsActionsResult = {
  /** Normalized (defensive) event document. */
  fullEvent: FullEvent;

  /** Raw realtime status/error passthrough. */
  status: string;
  error: string | null;

  /** Generic race updater to avoid duplicating realtime merge code in pages. */
  updateRace: (raceId: string, updater: (race: Race) => Race) => void;

  /** Race mutations (persisted via realtime update). */
  saveRace: (draft: RaceDraftLike) => void;
  deleteRace: (raceId: string) => void;
  setActiveRace: (raceId: string) => void;
  toggleActiveRace: (raceId: string) => void;

  /** Starters helpers. */
  replaceRaceStarters: (raceId: string, nextStarters: Athlete[]) => void;
  upsertRaceStarters: (raceId: string, incoming: Athlete[]) => void;

  /** Convenience helper for the UI "Next race" flow. */
  makeNextRaceTemplate: (from: Race) => Race;
};

/**
 * Centralized actions for working with a single Event realtime document.
 *
 * Rationale:
 * - Pages/components should not duplicate the event mutation logic.
 * - Keeps all write paths consistent (upsert/delete/activate/...)
 */
export function useEventsActions(eventId: string | null | undefined): UseEventsActionsResult {
  const resolvedEventId = String(eventId ?? "").trim();
  const docId = resolvedEventId ? `Event-${resolvedEventId}` : null;

  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

  const fullEvent = useMemo(() => normalizeFullEvent(raw, resolvedEventId), [raw, resolvedEventId]);

  const updateRace = useCallback(
    (raceId: string, updater: (race: Race) => Race) => {
      const id = String(raceId ?? "").trim();
      if (!resolvedEventId || !id) return;

      update((prev) => {
        const current = normalizeFullEvent(prev, resolvedEventId);
        const idx = current.races.findIndex((r) => r.id === id);
        if (idx < 0) return prev;

        const before = current.races[idx];
        const updated = updater(before);
        const merged: Race = { ...before, ...updated, id };

        const nextRaces = current.races.slice();
        nextRaces[idx] = merged;

        return { ...current, races: nextRaces } as Partial<FullEvent>;
      });
    },
    [update, resolvedEventId],
  );

  const saveRace = useCallback(
    (draft: RaceDraftLike) => {
      if (!resolvedEventId) return;

      update((prev) => {
        const current = normalizeFullEvent(prev, resolvedEventId);
        const existing = current.races.find((r) => r.id === draft.id) ?? null;
        const race = buildRaceFromDraft(draft, existing);
        return upsertRace(current, race) as Partial<FullEvent>;
      });
    },
    [update, resolvedEventId],
  );

  const deleteRace = useCallback(
    (raceId: string) => {
      const id = String(raceId ?? "").trim();
      if (!resolvedEventId || !id) return;

      update((prev) => {
        const current = normalizeFullEvent(prev, resolvedEventId);
        return deleteRaceFromEvent(current, id) as Partial<FullEvent>;
      });
    },
    [update, resolvedEventId],
  );

  const setActiveRace = useCallback(
    (raceId: string) => {
      const id = String(raceId ?? "").trim();
      if (!resolvedEventId || !id) return;

      update((prev) => {
        const current = normalizeFullEvent(prev, resolvedEventId);
        return setActiveRaceInEvent(current, id) as Partial<FullEvent>;
      });
    },
    [update, resolvedEventId],
  );

  const toggleActiveRace = useCallback(
    (raceId: string) => {
      const id = String(raceId ?? "").trim();
      if (!resolvedEventId || !id) return;

      update((prev) => {
        const current = normalizeFullEvent(prev, resolvedEventId);
        const exists = current.races.some((r) => r.id === id);
        if (!exists) return prev;

        const isActive = current.activeRaceId === id;
        return { ...current, activeRaceId: isActive ? null : id } as Partial<FullEvent>;
      });
    },
    [update, resolvedEventId],
  );

  const replaceRaceStarters = useCallback(
    (raceId: string, nextStarters: Athlete[]) => {
      updateRace(raceId, (r) => ({ ...r, raceStarters: Array.isArray(nextStarters) ? nextStarters : [] }));
    },
    [updateRace],
  );

  const upsertRaceStarters = useCallback(
    (raceId: string, incoming: Athlete[]) => {
      updateRace(raceId, (r) => ({ ...r, raceStarters: upsertStarters(r.raceStarters ?? [], incoming ?? []) }));
    },
    [updateRace],
  );

  const nextRaceTemplate = useCallback((from: Race) => makeNextRaceTemplate(from), []);

  return {
    fullEvent,
    status: String(status ?? ""),
    error: error ? String(error) : null,
    updateRace,
    saveRace,
    deleteRace,
    setActiveRace,
    toggleActiveRace,
    replaceRaceStarters,
    upsertRaceStarters,
    makeNextRaceTemplate: nextRaceTemplate,
  };
}
