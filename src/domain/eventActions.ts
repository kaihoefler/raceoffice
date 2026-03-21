import type { FullEvent } from "../types/event";
import type { Race, RaceResult } from "../types/race";
import type { RaceActivity } from "../types/raceactivities";

/**
 * A lightweight “draft” shape for creating/updating races.
 *
 * Note: We keep this type in the domain layer (not importing UI types like RaceDraft)
 * so the domain module stays reusable and doesn’t depend on components.
 */
export type RaceDraftLike = {
  id: string;
  eventId: string;
  ageGroupId: string;
  name: string;
  racemode: Race["racemode"];
  stage: Race["stage"];
  stage_value: string;
  distance_value: string;
};

/**
 * Legacy migration on read:
 * - converts old raceResult fields `eliminated`/`eliminationLap`
 *   to `dnf`/`dnfLap`
 */
export function normalizeRaceResultsForRead(rawResults: unknown): RaceResult[] {
  const list = Array.isArray(rawResults) ? rawResults : [];

  return list.map((r: any) => {
    const rawDnf = r?.dnf;

    const dnf: RaceResult["dnf"] =
      rawDnf === "dnf" || rawDnf === "elimination"
        ? rawDnf
        : r?.eliminated
          ? "elimination"
          : false;

    const dnfLapRaw = Number(r?.dnfLap ?? r?.eliminationLap ?? 0);
    const dnfLap = Number.isFinite(dnfLapRaw) ? Math.max(0, Math.floor(dnfLapRaw)) : 0;

    return {
      ...r,
      dnf,
      dnfLap,
    } as RaceResult;
  });
}

/**
 * Legacy migration on read:
 * - converts old `type: "elimination"` activities to
 *   `type: "DNF"` + `data.dnfType: "elimination"`
 */
export function normalizeRaceActivitiesForRead(rawActivities: unknown): RaceActivity[] {
  const list = Array.isArray(rawActivities) ? rawActivities : [];

  return list.map((a: any) => {
    if (a?.type !== "elimination") return a as RaceActivity;

    const data = a?.data ?? {};
    const history = Array.isArray(data.history) ? data.history : [];

    return {
      ...a,
      type: "DNF",
      data: {
        ...data,
        dnfType: "elimination",
        history: history.map((h: any) => ({
          ...h,
          dnfType: "elimination",
        })),
      },
    } as RaceActivity;
  });
}

/**
 * Defensive normalization of an event document coming from realtime storage.
 * Ensures all arrays exist and required Race fields have safe fallbacks.
 */
export function normalizeFullEvent(raw: unknown, eventId: string): FullEvent {
  const obj = raw && typeof raw === "object" ? (raw as any) : {};
  const races = Array.isArray(obj.races) ? obj.races : [];

  const normalizeRace = (r: any): Race => {
    const rm = r?.racemode;
    const racemode: Race["racemode"] = {
      isPointsRace: !!rm?.isPointsRace,
      isEliminationRace: !!rm?.isEliminationRace,
    };

    const stage: Race["stage"] = r?.stage === "heat" || r?.stage === "final" || r?.stage === "qualifying" ? r.stage : "";

    return {
      id: typeof r?.id === "string" ? r.id : "",
      eventId: typeof r?.eventId === "string" ? r.eventId : eventId,
      ageGroupId: typeof r?.ageGroupId === "string" ? r.ageGroupId : "",
      name: typeof r?.name === "string" ? r.name : "",
      slug: typeof r?.slug === "string" ? r.slug : "",
      racemode,
      stage,
      stage_value: typeof r?.stage_value === "string" ? r.stage_value : "",
      distance_value: typeof r?.distance_value === "string" ? r.distance_value : "",
      raceResults: normalizeRaceResultsForRead(r?.raceResults),
      raceStarters: Array.isArray(r?.raceStarters) ? r.raceStarters : [],
      raceActivities: normalizeRaceActivitiesForRead(r?.raceActivities),
    };
  };

  return {
    id: typeof obj.id === "string" ? obj.id : eventId,
    name: typeof obj.name === "string" ? obj.name : "",
    slug: typeof obj.slug === "string" ? obj.slug : "",
    activeRaceId: typeof obj.activeRaceId === "string" ? obj.activeRaceId : null,
    ageGroups: Array.isArray(obj.ageGroups) ? obj.ageGroups : [],
    races: races.map(normalizeRace),
    athletes: Array.isArray(obj.athletes) ? obj.athletes : [],
  };
}

/**
 * Slugify helper used when persisting race names.
 */
export function slugify(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Increments a stage_value (used for “next race from template”).
 * - numeric: "1" -> "2"
 * - alpha: "A" -> "B", "Z" -> "AA", "AZ" -> "BA"
 */
export function incrementStageValue(value: string): string {
  const v = String(value ?? "").trim();
  if (!v) return "";

  if (/^\d+$/.test(v)) return String(Number(v) + 1);

  if (/^[A-Za-z]+$/.test(v)) {
    const upper = v.toUpperCase();
    const chars = upper.split("").map((c) => c.charCodeAt(0) - 65);
    let carry = 1;

    for (let i = chars.length - 1; i >= 0; i--) {
      const next = chars[i] + carry;
      chars[i] = next % 26;
      carry = Math.floor(next / 26);
      if (!carry) break;
    }

    if (carry) chars.unshift(carry - 1);
    return chars.map((n) => String.fromCharCode(65 + n)).join("");
  }

  return v;
}

/**
 * Builds the persisted Race object from a draft.
 *
 * Important: When editing an existing race, keep existing results/starters/activities
 * unless the caller explicitly wants to reset them.
 */
export function buildRaceFromDraft(draft: RaceDraftLike, existing?: Race | null): Race {
  const existingResults = existing?.raceResults ?? [];
  const existingStarters = existing?.raceStarters ?? [];
  const existingActivities = existing?.raceActivities ?? [];

  const normalizedStageValue = draft.stage === "" ? "" : String(draft.stage_value ?? "");

  return {
    id: draft.id,
    eventId: draft.eventId,
    ageGroupId: draft.ageGroupId,
    name: String(draft.name ?? "").trim(),
    slug: slugify(draft.name),
    racemode: {
      isPointsRace: !!draft.racemode?.isPointsRace,
      isEliminationRace: !!draft.racemode?.isEliminationRace,
    },
    stage: draft.stage,
    stage_value: normalizedStageValue,
    distance_value: String(draft.distance_value ?? ""),
    raceResults: existingResults,
    raceStarters: existingStarters,
    raceActivities: existingActivities,
  };
}

/**
 * Inserts/updates a Race inside the event (immutable upsert).
 */
export function upsertRace(event: FullEvent, race: Race): FullEvent {
  const exists = event.races.some((r) => r.id === race.id);
  const nextRaces = exists
    ? event.races.map((r) => (r.id === race.id ? { ...r, ...race } : r))
    : [race, ...event.races];

  return { ...event, races: nextRaces };
}

/**
 * Deletes a race and clears activeRaceId if it pointed to the deleted race.
 */
export function deleteRace(event: FullEvent, raceId: string): FullEvent {
  const nextActiveRaceId = event.activeRaceId === raceId ? null : event.activeRaceId;
  return {
    ...event,
    activeRaceId: nextActiveRaceId,
    races: event.races.filter((r) => r.id !== raceId),
  };
}

/**
 * Sets the event’s active race (only if the race exists).
 */
export function setActiveRace(event: FullEvent, raceId: string): FullEvent {
  if (!event.races.some((r) => r.id === raceId)) return event;
  return { ...event, activeRaceId: raceId };
}

/**
 * Creates a “next race” template from an existing race.
 *
 * Notes:
 * - We keep starters (usually the same field of competitors), but clear results/activities.
 * - RaceEditor (in "new" mode) will generate a fresh id anyway.
 */
export function makeNextRaceTemplate(from: Race): Race {
  return {
    ...from,
    name: "",
    slug: "",
    stage_value: incrementStageValue(from.stage_value),
    raceResults: [],
    raceActivities: [],
  };
}
