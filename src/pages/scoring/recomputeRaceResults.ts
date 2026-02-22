/**
 * recomputeRaceResults
 * -------------------
 * Computes the consolidated `rank` field for each `RaceResult`.
 *
 * The UI (FinishLineScoring, PointsScoring, Activities editor, etc.) edits different parts of a race.
 * `RaceResult` is treated as the "materialized" / consolidated state that other views can rely on.
 *
 * Ranking rules are implemented as a deterministic sort + tie handling:
 * - Entries are sorted by the configured priority criteria.
 * - If ALL ranking criteria are identical, athletes share the same rank/place (1, 1, 3 ...).
 *
 * IMPORTANT: This helper only sets `rank`. It does not modify points/finishRank/etc.
 */
import type { RaceResult } from "../../types/race";

// Internal comparable key representing the ranking criteria.
// Lower values are better for `bucket` and `finishRankKey`, higher is better for `points`/`eliminationLap`.
type SortKey = {
  bucket: number;
  eliminationLap: number;
  points: number;
  finishRankKey: number; // finishRank=0 => Infinity (treated as "no finish" -> last)
};

function toFiniteInt(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.floor(v);
}

function toFiniteNumber(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Status priority (ascending = better):
 * 0: not eliminated, not DSQ, not DNS
 * 1: eliminated
 * 2: DSQ
 * 3: DNS
 *
 * Note: if multiple flags are true (shouldn't normally happen), DSQ/DNS win by priority.
 */
function statusBucket(r: RaceResult): number {
  if (r.dsq) return 2;
  if (r.dns) return 3;
  return r.eliminated ? 1 : 0;
}

function sortKey(r: RaceResult): SortKey {
  // finishRank=0 means "not finished" and must be sorted last.
  const finishRank = toFiniteInt(r.finishRank, 0);

  return {
    bucket: statusBucket(r),
    eliminationLap: toFiniteInt(r.eliminationLap, 0),
    points: toFiniteNumber(r.points, 0),
    finishRankKey: finishRank > 0 ? finishRank : Number.POSITIVE_INFINITY,
  };
}

function keysEqual(a: SortKey, b: SortKey): boolean {
  return (
    a.bucket === b.bucket &&
    a.eliminationLap === b.eliminationLap &&
    a.points === b.points &&
    a.finishRankKey === b.finishRankKey
  );
}

export function recomputeRaceResults(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];

  // Sort deterministically by the configured priority criteria.
  // This sort order is what defines who is "ahead" in the race.
  const sorted = [...list].sort((ra, rb) => {
    const a = sortKey(ra);
    const b = sortKey(rb);

    // 1) status bucket (asc)
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;

    // 2) eliminationLap (desc)
    if (a.eliminationLap !== b.eliminationLap) return b.eliminationLap - a.eliminationLap;

    // 3) points (desc)
    if (a.points !== b.points) return b.points - a.points;

    // 4) finishRank (asc), finishRank=0 => Infinity => end
    if (a.finishRankKey !== b.finishRankKey) return a.finishRankKey - b.finishRankKey;

    // Final tie-breaker for stable ordering (does NOT affect rank ties):
    return toFiniteInt(ra.bib, 0) - toFiniteInt(rb.bib, 0);
  });

  // Assign ranks with ties: 1, 1, 3 ...
  // If two athletes have identical SortKeys, they share the same rank.
  const rankByBib = new Map<number, number>();
  let prevKey: SortKey | null = null;
  let prevRank = 0;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const bib = toFiniteInt(r.bib, 0);
    if (bib <= 0) continue;

    const key = sortKey(r);
    const isTie = prevKey !== null && keysEqual(prevKey, key);

    const rank = isTie ? prevRank : i + 1;

    rankByBib.set(bib, rank);
    prevKey = key;
    prevRank = rank;
  }

  // Return in original order to minimize document churn.
  // This way only the `rank` fields change, while the array order stays stable.
  return list.map((r) => {
    const bib = toFiniteInt(r.bib, 0);
    const nextRank = rankByBib.get(bib);
    return nextRank != null ? { ...r, rank: nextRank } : r;
  });
}