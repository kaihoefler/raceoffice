/**
 * livetracking/list
 * -----------------
 * Registry document for all known LiveTracking setups and participant pools.
 *
 * Follows the same lightweight-index pattern as `eventList`:
 * - this document holds only IDs, names, and minimal metadata
 * - full data lives in `liveTrackingSetup:{id}` and `liveTrackingParticipants:{id}`
 */

export type LiveTrackingSetupEntry = {
  setupId: string;
  name: string;
  updatedAt: string | null;
};

export type LiveTrackingParticipantPoolEntry = {
  poolId: string;
  name: string;
  updatedAt: string | null;
};

export type LiveTrackingListDocument = {
  kind: "liveTrackingList";
  version: 1;
  setups: LiveTrackingSetupEntry[];
  participantPools: LiveTrackingParticipantPoolEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createLiveTrackingListDocument(): LiveTrackingListDocument {
  return {
    kind: "liveTrackingList",
    version: 1,
    setups: [],
    participantPools: [],
  };
}

function isLiveTrackingSetupEntry(value: unknown): value is LiveTrackingSetupEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.setupId === "string" &&
    typeof value.name === "string" &&
    (typeof value.updatedAt === "string" || value.updatedAt === null)
  );
}

function isLiveTrackingParticipantPoolEntry(value: unknown): value is LiveTrackingParticipantPoolEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.poolId === "string" &&
    typeof value.name === "string" &&
    (typeof value.updatedAt === "string" || value.updatedAt === null)
  );
}

export function isLiveTrackingListDocument(value: unknown): value is LiveTrackingListDocument {
  if (!isRecord(value)) return false;
  return (
    value.kind === "liveTrackingList" &&
    value.version === 1 &&
    Array.isArray(value.setups) &&
    value.setups.every(isLiveTrackingSetupEntry) &&
    Array.isArray(value.participantPools) &&
    value.participantPools.every(isLiveTrackingParticipantPoolEntry)
  );
}
