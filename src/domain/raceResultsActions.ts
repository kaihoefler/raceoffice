/**
 * raceResultsActions
 * ------------------
 * Domain helpers to keep `raceResults` deterministic and easy to rebuild.
 *
 * Mental model:
 * `raceResults` behaves like a materialized view with two data sources:
 * 1) Manual input fields maintained in dedicated UIs
 *    (e.g. finishRank, finishTime, lapsCompleted)
 * 2) Derived fields calculated from the activity stream (`raceActivities`)
 *    (e.g. points, eliminated/eliminationLap, dsq, dns)
 *
 * Expected update pipeline for callers:
 * 1) `applyActivitiesToRaceResults(...)`
 *    -> merges all known bibs and recalculates activity-derived fields
 * 2) `recomputeRaceResults(...)`
 *    -> recomputes consolidated standings rank with tie handling
 *
 * Use `materializeRaceResults(...)` when both steps should be executed together.
 */

import type { Athlete } from "../types/athlete";
import type {
  RaceActivity,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityElimination,
  RaceActivityPointsSprint,
} from "../types/raceactivities";
import type { RaceResult } from "../types/race";

/**
 * Parses an unknown bib value into a normalized positive integer.
 *
 * Accepted inputs: number or numeric string (e.g. 12, "12", " 12 ").
 * Returns `null` for missing/invalid/non-positive values.
 */
export function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

/**
 * Creates a default `RaceResult` row for bibs that are discovered via starters
 * or activities but do not yet exist in persisted `raceResults`.
 *
 * Defaults are intentionally neutral so later derivation can safely overwrite
 * activity-based fields without affecting manual input semantics.
 */
export function makeDefaultRaceResult(bib: number): RaceResult {
  return {
    bib,
    rank: 0,
    points: 0,
    eliminated: false,
    eliminationLap: 0,
    dns: false,
    dsq: false,
    lapsCompleted: 0,
    finishTime: "",
    finishRank: 0,
  };
}

// Narrow, explicit activity type guards used to keep the derivation pass readable.
function isPointsSprintActivity(a: RaceActivity | any): a is RaceActivityPointsSprint {
  return a?.type === "pointsSprint";
}

function isEliminationActivity(a: RaceActivity | any): a is RaceActivityElimination {
  return a?.type === "elimination";
}

function isDsqActivity(a: RaceActivity | any): a is RaceActivityDisqualfication {
  return a?.type === "DSQ";
}

function isDnsActivity(a: RaceActivity | any): a is RaceActivityDns {
  return a?.type === "DNS";
}

/**
 * Rebuilds all activity-derived fields of `RaceResult` rows.
 *
 * What this function does:
 * - discovers the complete bib universe from previous results, starters and activities
 * - ensures each discovered bib has a `RaceResult` row
 * - recomputes derived fields from non-deleted activities only
 *
 * Derived fields:
 * - `points`: summed from pointsSprint activity entries
 * - `eliminated` + `eliminationLap`: from elimination activities
 *   (if multiple entries exist for one bib, the highest lap wins)
 * - `dsq` / `dns`: set by DSQ/DNS activities
 *
 * Preserved (not derived here):
 * - manual fields such as `finishRank`, `finishTime`, `lapsCompleted`
 *
 * Ordering contract:
 * - existing row order is preserved first
 * - newly discovered bibs are appended in ascending bib order
 */
export function applyActivitiesToRaceResults(args: {
  prevResults: RaceResult[];
  starters: Athlete[];
  activities: RaceActivity[];
}): RaceResult[] {
  const prevResults = Array.isArray(args.prevResults) ? args.prevResults : [];
  const starters = Array.isArray(args.starters) ? args.starters : [];
  const activities = Array.isArray(args.activities) ? args.activities : [];

  // Collect all bibs we need RaceResult rows for.
  const bibs = new Set<number>();

  for (const r of prevResults) {
    const bib = bibToInt((r as any)?.bib);
    if (bib != null) bibs.add(bib);
  }

  for (const s of starters) {
    const bib = bibToInt((s as any)?.bib);
    if (bib != null) bibs.add(bib);
  }

  for (const a of activities) {
    if (isPointsSprintActivity(a) || isEliminationActivity(a)) {
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        if (bib != null) bibs.add(bib);
      }
      continue;
    }

    if (isDsqActivity(a) || isDnsActivity(a)) {
      const bib = bibToInt(a.data?.bib);
      if (bib != null) bibs.add(bib);
      continue;
    }

    // Forward-compatibility fallback for potential future activity payload shapes.
    const maybeBib = bibToInt((a as any)?.data?.bib);
    if (maybeBib != null) bibs.add(maybeBib);

    const maybeBibs = Array.isArray((a as any)?.data?.bibs) ? ((a as any).data.bibs as any[]) : [];
    for (const b of maybeBibs) {
      const bib = bibToInt(b);
      if (bib != null) bibs.add(bib);
    }
  }

  // Base map: copy existing rows first so manual fields are preserved as-is.
  const byBib = new Map<number, RaceResult>();
  for (const r of prevResults) {
    const bib = bibToInt((r as any)?.bib);
    if (bib == null) continue;
    if (byBib.has(bib)) continue;
    byBib.set(bib, { ...r, bib });
  }

  for (const bib of bibs) {
    if (!byBib.has(bib)) byBib.set(bib, makeDefaultRaceResult(bib));
  }

  // Accumulators for a single derivation pass over the activity stream.
  const pointsByBib = new Map<number, number>();
  const elimLapByBib = new Map<number, number>();
  const dsqBibs = new Set<number>();
  const dnsBibs = new Set<number>();

  for (const a of activities) {
    if (isPointsSprintActivity(a)) {
      if (a.data?.isDeleted) continue;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        const pts = Number((r as any)?.points);
        if (bib == null || !Number.isFinite(pts)) continue;
        pointsByBib.set(bib, (pointsByBib.get(bib) ?? 0) + pts);
      }
      continue;
    }

    if (isEliminationActivity(a)) {
      if (a.data?.isDeleted) continue;
      const lap = bibToInt((a as any)?.data?.lap) ?? 0;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        if (bib == null) continue;
        const prev = elimLapByBib.get(bib) ?? 0;
        elimLapByBib.set(bib, Math.max(prev, lap));
      }
      continue;
    }

    if (isDsqActivity(a)) {
      if (a.data?.isDeleted) continue;
      const bib = bibToInt(a.data?.bib);
      if (bib != null) dsqBibs.add(bib);
      continue;
    }

    if (isDnsActivity(a)) {
      if (a.data?.isDeleted) continue;
      const bib = bibToInt(a.data?.bib);
      if (bib != null) dnsBibs.add(bib);
      continue;
    }

    // Forward-compatibility fallback for potential future activity payload shapes.
    const t = String((a as any)?.type ?? "");
    const isDeleted = !!(a as any)?.data?.isDeleted;
    if (isDeleted) continue;

    const bib = bibToInt((a as any)?.data?.bib);
    if (bib == null) continue;

    if (t === "DSQ") dsqBibs.add(bib);
    else if (t === "DNS") dnsBibs.add(bib);
  }

  // Business rule: any bib marked as eliminated loses all points.
  // Apply this after the full activity pass so elimination always wins.
  for (const [bib, lap] of elimLapByBib) {
    if (lap > 0) pointsByBib.set(bib, 0);
  }

  // Build output in stable order: keep prior ordering, then append newly introduced bibs.
  const used = new Set<number>();

  const applyDerived = (base: RaceResult): RaceResult => {
    const bib = bibToInt(base.bib) ?? base.bib;

    const points = pointsByBib.get(bib) ?? 0;
    const elimLap = elimLapByBib.get(bib) ?? 0;

    return {
      ...base,
      bib,
      points,
      eliminated: elimLap > 0,
      eliminationLap: elimLap,
      dsq: dsqBibs.has(bib),
      dns: dnsBibs.has(bib),
    };
  };

  const next: RaceResult[] = [];
  for (const r of prevResults) {
    const bib = bibToInt((r as any)?.bib);
    if (bib == null) continue;
    const base = byBib.get(bib);
    if (!base) continue;
    next.push(applyDerived(base));
    used.add(bib);
  }

  const missing = Array.from(byBib.keys())
    .filter((b) => !used.has(b))
    .sort((a, b) => a - b);

  for (const bib of missing) {
    const base = byBib.get(bib);
    if (!base) continue;
    next.push(applyDerived(base));
  }

  return next;
}

// -----------------------------------------------------------------------------
// Standings / rank computation
// -----------------------------------------------------------------------------

type SortKey = {
  bucket: number;
  eliminationLap: number;
  points: number;
  finishRankKey: number; // finishRank=0 => Infinity (treated as "no finish" -> last)
};

/**
 * Coerces unknown input into a finite integer; otherwise returns fallback.
 */
function toFiniteInt(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.floor(v);
}

/**
 * Coerces unknown input into a finite number; otherwise returns fallback.
 */
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
 */
function statusBucket(r: RaceResult): number {
  if (r.dsq) return 2;
  if (r.dns) return 3;
  return r.eliminated ? 1 : 0;
}

/**
 * Converts a row into a normalized comparison key used for ordering and tie checks.
 */
function sortKey(r: RaceResult): SortKey {
  const finishRank = toFiniteInt(r.finishRank, 0);

  return {
    bucket: statusBucket(r),
    eliminationLap: toFiniteInt(r.eliminationLap, 0),
    points: toFiniteNumber(r.points, 0),
    finishRankKey: finishRank > 0 ? finishRank : Number.POSITIVE_INFINITY,
  };
}

/**
 * Comparator used for standings sorting.
 *
 * Sort priority (best to worst):
 * 1) status bucket (active, eliminated, DSQ, DNS)
 * 2) elimination lap (higher is better)
 * 3) points (higher is better)
 * 4) finishRank (lower is better; 0 behaves like "no finish" and is pushed back)
 * 5) bib (stable deterministic tie-breaker only)
 */
function compareRaceResultsForStandings(ra: RaceResult, rb: RaceResult): number {
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

  // Stable tie-breaker (does NOT affect rank ties)
  return toFiniteInt(ra.bib, 0) - toFiniteInt(rb.bib, 0);
}

/**
 * Equality check for ranking-relevant fields.
 * Used to detect ties when assigning rank numbers (1, 1, 3 ...).
 */
function keysEqual(a: SortKey, b: SortKey): boolean {
  return (
    a.bucket === b.bucket &&
    a.eliminationLap === b.eliminationLap &&
    a.points === b.points &&
    a.finishRankKey === b.finishRankKey
  );
}

/**
 * Returns a new array sorted by standings criteria.
 *
 * IMPORTANT: This helper only sorts; it does not assign or modify `rank`.
 */
export function sortRaceResultsForStandings(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];
  return list.sort(compareRaceResultsForStandings);
}

/**
 * Recomputes the consolidated `rank` field for each row.
 *
 * Ranking behavior:
 * - Uses the same comparator as standings sort
 * - Supports ties (e.g. 1, 1, 3)
 * - Special rule: eliminated riders in the same elimination lap share the same rank,
 *   regardless of points or finishRank
 * - Keeps original array order in the return value to minimize document churn
 */
export function recomputeRaceResults(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];

  // Deterministic sort by configured standings criteria.
  const sorted = [...list].sort(compareRaceResultsForStandings);

  // Assign ranks with ties: 1, 1, 3 ...
  const rankByBib = new Map<number, number>();
  let prevKey: SortKey | null = null;
  let prevRank = 0;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const bib = toFiniteInt(r.bib, 0);
    if (bib <= 0) continue;

    const key = sortKey(r);

    // Special tie rule: riders eliminated in the same lap share rank,
    // independent from points/finishRank.
    const sameEliminationLapTie =
      prevKey !== null &&
      prevKey.bucket === 1 &&
      key.bucket === 1 &&
      prevKey.eliminationLap > 0 &&
      prevKey.eliminationLap === key.eliminationLap;

    const isTie = prevKey !== null && (keysEqual(prevKey, key) || sameEliminationLapTie);

    const rank = isTie ? prevRank : i + 1;

    rankByBib.set(bib, rank);
    prevKey = key;
    prevRank = rank;
  }

  // Re-apply ranks onto the original order to minimize persistence churn.
  return list.map((r) => {
    const bib = toFiniteInt(r.bib, 0);
    const nextRank = rankByBib.get(bib);
    return nextRank != null ? { ...r, rank: nextRank } : r;
  });
}

/**
 * Convenience helper for the common "activities changed" flow:
 * derive fields from activities AND recompute rank.
 */
export function materializeRaceResults(args: {
  prevResults: RaceResult[];
  starters: Athlete[];
  activities: RaceActivity[];
}): RaceResult[] {
  return recomputeRaceResults(applyActivitiesToRaceResults(args));
}
