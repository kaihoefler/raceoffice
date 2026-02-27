// src/hooks/useEventsActions.ts
//
// Centralized write-actions for a single Event document (realtime).
//
// Why this hook exists:
// - Pages/components should not implement their own realtime merge logic.
// - All write paths (upsert/delete/activate/starters/scoring) should be consistent.
// - Some updates must be atomic, e.g. "create race + set starters + materialize results".
//
// Design notes:
// - Reads: useRealtimeDoc gives us a Partial<FullEvent> from the backend.
// - We normalize defensively via normalizeFullEvent(...) on every update/read.
// - Writes: useRealtimeDoc.update(...) accepts an updater(prev) => next.

import { useCallback, useMemo } from "react";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

import type { Athlete } from "../types/athlete";
import type { FullEvent } from "../types/event";
import type { Race, RaceResult } from "../types/race";
import type { RaceActivity } from "../types/raceactivities";

import { upsertStarters } from "../domain/startersActions";

import {
  applyActivitiesToRaceResults,
  materializeRaceResults,
  recomputeRaceResults,
} from "../domain/raceResultsActions";

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
  /**
   * Create/Update race AND set starters in the same realtime update (avoids intermediate states).
   * Optionally also sets the created/updated race as the active race.
   */
  saveRaceWithStarters: (
    draft: RaceDraftLike,
    starters: Athlete[],
    options?: { setActiveRace?: boolean },
  ) => void;
  deleteRace: (raceId: string) => void;
  setActiveRace: (raceId: string) => void;
  toggleActiveRace: (raceId: string) => void;

  /** Starters helpers. */
  replaceRaceStarters: (raceId: string, nextStarters: Athlete[]) => void;
  upsertRaceStarters: (raceId: string, incoming: Athlete[], options?: { recomputeResults?: boolean }) => void;

  // ---------------------------------------------------------------------------
  // Scoring helpers
  // ---------------------------------------------------------------------------
  // These actions guarantee that changes to activities/manual results always write
  // consistent, materialized raceResults (derived fields + rank).
  addRaceActivity: (raceId: string, activity: RaceActivity) => void;
  /** Append multiple activities in a SINGLE realtime update (important for non-optimistic backend). */
  addRaceActivities: (raceId: string, activities: RaceActivity[]) => void;
  updateRaceActivity: (raceId: string, updated: RaceActivity) => void;
  replaceRaceActivities: (raceId: string, nextActivities: RaceActivity[]) => void;
  setRaceResultsManual: (raceId: string, nextResults: RaceResult[]) => void;

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
  // Resolve the event id early and use it consistently in all actions.
  // If no eventId is selected, docId becomes null and all actions become no-ops.
  const resolvedEventId = String(eventId ?? "").trim();
  const docId = resolvedEventId ? `Event-${resolvedEventId}` : null;

  // Realtime document connection.
  // - raw is Partial<FullEvent> (backend may omit fields)
  // - update(...) is the only write entry-point
  const { data: raw, update, status, error } = useRealtimeDoc<Partial<FullEvent>>(docId);

  // Always expose a normalized FullEvent to consumers.
  // Normalization makes the UI robust against missing arrays/fields.
  const fullEvent = useMemo(() => normalizeFullEvent(raw, resolvedEventId), [raw, resolvedEventId]);

  // Low-level helper: update a single race by id.
  // This keeps all array merging logic in one place.
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

  // Upsert a race using a draft. This is the generic "save" used by RaceEditor.
  // Note: raceStarters/raceResults are preserved/merged in buildRaceFromDraft depending on existing state.
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

  // Atomic helper: upsert race + set starters + materialize raceResults in one realtime update.
  // This avoids intermediate document states (race exists without starters/results).
  // Optionally sets the race active to support "create from live" flows.
  const saveRaceWithStarters = useCallback(
    (draft: RaceDraftLike, starters: Athlete[], options?: { setActiveRace?: boolean }) => {
      if (!resolvedEventId) return;

      update((prev) => {
        const current = normalizeFullEvent(prev, resolvedEventId);
        const existing = current.races.find((r) => r.id === draft.id) ?? null;

        const base = buildRaceFromDraft(draft, existing);
        const safeStarters = Array.isArray(starters) ? starters : [];

        const nextResults = materializeRaceResults({
          prevResults: Array.isArray(base.raceResults) ? base.raceResults : [],
          starters: safeStarters,
          activities: Array.isArray(base.raceActivities) ? base.raceActivities : [],
        });

        const race: Race = {
          ...base,
          raceStarters: safeStarters,
          raceResults: nextResults,
        };

        const next = upsertRace(current, race) as FullEvent;

        if (options?.setActiveRace) {
          return { ...next, activeRaceId: String(draft.id ?? "").trim() || null } as Partial<FullEvent>;
        }

        return next as Partial<FullEvent>;
      });
    },
    [update, resolvedEventId],
  );

  // Remove a race from the event document.
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

  // Set fullEvent.activeRaceId to the provided raceId.
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

  // Toggle fullEvent.activeRaceId:
  // - if already active -> set to null
  // - otherwise -> set to this raceId
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

  // Replace the entire starters list for a race.
  // Use this for bulk editing screens.
  const replaceRaceStarters = useCallback(
    (raceId: string, nextStarters: Athlete[]) => {
      updateRace(raceId, (r) => ({ ...r, raceStarters: Array.isArray(nextStarters) ? nextStarters : [] }));
    },
    [updateRace],
  );

  // Add/merge starters into an existing starters list (dedupe by bib/id handled by upsertStarters).
  // Optionally recompute/materialize raceResults so UI stays consistent.
  const upsertRaceStarters = useCallback(
    (raceId: string, incoming: Athlete[], options?: { recomputeResults?: boolean }) => {
      updateRace(raceId, (r) => {
        const nextStarters = upsertStarters(r.raceStarters ?? [], incoming ?? []);

        if (!options?.recomputeResults) {
          return { ...r, raceStarters: nextStarters };
        }

        const nextResults = materializeRaceResults({
          prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
          starters: nextStarters,
          activities: Array.isArray(r.raceActivities) ? r.raceActivities : [],
        });

        return { ...r, raceStarters: nextStarters, raceResults: nextResults };
      });
    },
    [updateRace],
  );

  // ---------------------------------------------------------------------------
  // Scoring actions
  // ---------------------------------------------------------------------------
  // These helpers guarantee that any change that affects raceResults keeps
  // `raceResults` materialized (derived fields) and consistent.
  const addRaceActivity = useCallback(
    (raceId: string, activity: RaceActivity) => {
      updateRace(raceId, (r) => {
        const activities = Array.isArray(r.raceActivities) ? r.raceActivities : [];
        const nextActivities = [...activities, activity];

        const nextResults = materializeRaceResults({
          prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
          starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
          activities: nextActivities,
        });

        return { ...r, raceActivities: nextActivities, raceResults: nextResults };
      });
    },
    [updateRace],
  );

  const addRaceActivities = useCallback(
    (raceId: string, activitiesToAdd: RaceActivity[]) => {
      const toAdd = Array.isArray(activitiesToAdd) ? activitiesToAdd : [];
      if (toAdd.length === 0) return;

      updateRace(raceId, (r) => {
        const activities = Array.isArray(r.raceActivities) ? r.raceActivities : [];
        const nextActivities = [...activities, ...toAdd];

        const nextResults = materializeRaceResults({
          prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
          starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
          activities: nextActivities,
        });

        return { ...r, raceActivities: nextActivities, raceResults: nextResults };
      });
    },
    [updateRace],
  );

  const updateRaceActivity = useCallback(
    (raceId: string, updated: RaceActivity) => {
      updateRace(raceId, (r) => {
        const activities = Array.isArray(r.raceActivities) ? r.raceActivities : [];
        const idx = activities.findIndex((a: any) => a?.id === (updated as any)?.id);
        if (idx < 0) return r;

        const nextActivities = activities.slice();
        nextActivities[idx] = updated;

        const nextResults = materializeRaceResults({
          prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
          starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
          activities: nextActivities,
        });

        return { ...r, raceActivities: nextActivities, raceResults: nextResults };
      });
    },
    [updateRace],
  );

  const replaceRaceActivities = useCallback(
    (raceId: string, nextActivities: RaceActivity[]) => {
      updateRace(raceId, (r) => {
        const safeActivities = Array.isArray(nextActivities) ? nextActivities : [];

        const nextResults = materializeRaceResults({
          prevResults: Array.isArray(r.raceResults) ? r.raceResults : [],
          starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
          activities: safeActivities,
        });

        return { ...r, raceActivities: safeActivities, raceResults: nextResults };
      });
    },
    [updateRace],
  );

  const setRaceResultsManual = useCallback(
    (raceId: string, nextResults: RaceResult[]) => {
      updateRace(raceId, (r) => {
        const merged = applyActivitiesToRaceResults({
          prevResults: Array.isArray(nextResults) ? nextResults : [],
          starters: Array.isArray(r.raceStarters) ? r.raceStarters : [],
          activities: Array.isArray(r.raceActivities) ? r.raceActivities : [],
        });

        const computed = recomputeRaceResults(merged);
        return { ...r, raceResults: computed };
      });
    },
    [updateRace],
  );

  // UI helper: create a "next race" template from an existing race.
  // This is pure and does not touch realtime state.
  const nextRaceTemplate = useCallback((from: Race) => makeNextRaceTemplate(from), []);

  return {
    fullEvent,
    status: String(status ?? ""),
    error: error ? String(error) : null,
    updateRace,
    saveRace,
    saveRaceWithStarters,
    deleteRace,
    setActiveRace,
    toggleActiveRace,
    replaceRaceStarters,
    upsertRaceStarters,

    addRaceActivity,
    addRaceActivities,
    updateRaceActivity,
    replaceRaceActivities,
    setRaceResultsManual,

    makeNextRaceTemplate: nextRaceTemplate,
  };
}
