/**
 * livetracking/participantPool
 * ----------------------------
 * Event-level participant pool for LiveTracking.
 *
 * Terminology note:
 * - "participant pool" is used as the primary domain wording.
 *
 * Domain intent:
 * - Allows managing transponder mapping per event without requiring a race.
 * - Uses athlete id as participant identity (never name or bib as primary key).
 * - Reuses the established Athlete field vocabulary (`nation`, `ageGroupId`).
 */

export type LiveTrackingAthlete = {
  /** Mirrors Athlete.id and is the primary identity in LiveTracking. */
  id: string;
  bib: number | null;
  firstName: string;
  lastName: string;

  /** Same domain term as Athlete.nation. */
  nation: string | null;

  /** Same domain term as Athlete.ageGroupId. */
  ageGroupId: string | null;

  /** One athlete can carry one or many transponders over time. */
  transponderIds: string[];
};

export type LiveTrackingParticipantPoolDocument = {
  kind: "liveTrackingParticipants";
  version: 1;

  /** Stable participant-pool identity, usually encoded in the document id suffix. */
    poolId?: string;

  /** Optional owner event when this pool is event-scoped. */
  eventId?: string | null;

  /** Optional owner setup when this pool is setup-scoped (standalone live-tracking mode). */
  setupId?: string | null;

  /** Human-readable operations label (e.g. "Cadets Ladies - Setup A"). */
  name?: string;


  athletes: LiveTrackingAthlete[];
  updatedAt: string | null;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createLiveTrackingParticipantPoolDocument(args: {
  poolId: string;
  eventId?: string | null;
  setupId?: string | null;
  name?: string;
}): LiveTrackingParticipantPoolDocument {
  return {
    kind: "liveTrackingParticipants",
    version: 1,
    poolId: String(args.poolId ?? "").trim(),
    eventId: args.eventId == null ? null : String(args.eventId).trim(),
    setupId: args.setupId == null ? null : String(args.setupId).trim(),
    name: String(args.name ?? "").trim(),
    athletes: [],
    updatedAt: null,
  };
}


export function isLiveTrackingAthlete(value: unknown): value is LiveTrackingAthlete {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    (typeof value.bib === "number" || value.bib === null) &&
    typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    (typeof value.nation === "string" || value.nation === null) &&
    (typeof value.ageGroupId === "string" || value.ageGroupId === null) &&
    Array.isArray(value.transponderIds) &&
    value.transponderIds.every((x) => typeof x === "string")
  );
}

export function isLiveTrackingParticipantPoolDocument(value: unknown): value is LiveTrackingParticipantPoolDocument {
  if (!isRecord(value)) return false;

  return (
    value.kind === "liveTrackingParticipants" &&
    value.version === 1 &&
        (value.poolId === undefined || typeof value.poolId === "string") &&
    (value.eventId === undefined || typeof value.eventId === "string" || value.eventId === null) &&
    (value.setupId === undefined || typeof value.setupId === "string" || value.setupId === null) &&
    (value.name === undefined || typeof value.name === "string") &&

    Array.isArray(value.athletes) &&
    value.athletes.every(isLiveTrackingAthlete) &&
    (typeof value.updatedAt === "string" || value.updatedAt === null)
  );
}

