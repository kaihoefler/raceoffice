import type { LiveTrackingAthleteLiveState } from "@raceoffice/domain";

/**
 * Resolves a human-friendly athlete display name for live-tracking boards.
 *
 * Resolution order:
 * 1) Exact athlete-id lookup from participant pool
 * 2) Transponder-id lookup from participant pool
 * 3) Name present on the live state row (except synthetic unknown-chip shape)
 * 4) Athlete id fallback
 */
export function resolveLiveTrackingDisplayName(args: {
  row: LiveTrackingAthleteLiveState;
  participantNameByAthleteId: Map<string, string>;
  participantNameByTransponderId: Map<string, string>;
}): string {
  const { row, participantNameByAthleteId, participantNameByTransponderId } = args;

  const participantName = participantNameByAthleteId.get(row.athleteId) ?? null;
  const participantNameByChip = row.transponderId
    ? participantNameByTransponderId.get(String(row.transponderId).trim()) ?? null
    : null;
  const computedName = `${String(row.firstName ?? "").trim()} ${String(row.lastName ?? "").trim()}`.trim();
  const syntheticUnknownName = computedName === String(row.transponderId ?? "").trim();

  return participantName || participantNameByChip || (!syntheticUnknownName ? computedName : "") || row.athleteId;
}
