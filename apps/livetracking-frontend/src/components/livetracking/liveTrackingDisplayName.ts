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

  const unknownTransponderPrefix = "unknown:transponder:";
  const fallbackAthleteId = String(row.athleteId ?? "").trim();
  const fallbackDisplay = fallbackAthleteId.startsWith(unknownTransponderPrefix)
    ? String(row.transponderId ?? "").trim() || fallbackAthleteId.slice(unknownTransponderPrefix.length)
    : fallbackAthleteId;

  return participantName || participantNameByChip || (!syntheticUnknownName ? computedName : "") || fallbackDisplay;
}

/** "Ava Sophie" -> "A. S.", "Anna-Lena" -> "A.-L." */
function firstNameInitials(firstName: string): string {
  return firstName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}.`)
        .join("-"),
    )
    .join(" ");
}

/**
 * Shortens a display name for space-constrained boards: if the full name is longer than
 * `maxLength`, the first name is reduced to initials ("Ava Sophie Diaz Heidrich" ->
 * "A. S. Diaz Heidrich"). The last name is never shortened, since athletes are identified
 * by it; anything still too long is left to CSS ellipsis.
 *
 * Only applies when `fullName` actually starts with `firstName`, so transponder fallbacks
 * and other non-person names stay untouched.
 */
export function abbreviateLiveTrackingDisplayName(fullName: string, firstName: string | null | undefined, maxLength = 20): string {
  const first = String(firstName ?? "").trim();
  if (fullName.length <= maxLength || !first || !fullName.startsWith(`${first} `)) return fullName;

  const rest = fullName.slice(first.length + 1).trim();
  return `${firstNameInitials(first)} ${rest}`;
}

