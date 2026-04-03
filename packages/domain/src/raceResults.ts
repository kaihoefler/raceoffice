/**
 * raceResults
 * -----------
 * Shared domain model + pure race-results logic.
 *
 * This module is framework-agnostic by design:
 * - no React
 * - no HTTP layer
 * - no DB access
 *
 * So both client and server can consume exactly the same domain behavior.
 */

import type { Athlete } from "./athlete.js";
import type {
  RaceActivity,
  RaceActivityDNF,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityPointsRemoval,
  RaceActivityPointsSprint,
} from "./raceactivities.js";

/**
 * DNF domain state:
 * - `false`: rider is not DNF
 * - `"dnf"`: rider did not finish
 * - `"elimination"`: rider was eliminated (points/elimination mode)
 */
export type RaceResultDnf = false | "dnf" | "elimination";

/**
 * Canonical race result shape shared across applications.
 */
export interface RaceResult {
  bib: number;
  rank: number;
  points: number;
  dnf: RaceResultDnf;
  dnfLap: number;
  dns: boolean;
  dsq: boolean;
  lapsCompleted: number;
  finishTime: string;
  finishRank: number;
}

/**
 * Input activity shape accepted by derivation helpers.
 *
 * Why this exists:
 * - persisted activities include additional metadata (id, createdAt, full history)
 * - derivation logic only needs a subset of fields
 * - keeping input tolerant makes tests and migration adapters simpler
 */
export type RaceActivityInput =
  | RaceActivity
  | {
      type?: unknown;
      data?: {
        isDeleted?: unknown;
        lap?: unknown;
        dnfType?: unknown;
        bib?: unknown;
        bibs?: unknown;
        results?: Array<{ bib?: unknown; points?: unknown }>;
      };
    };

/**
 * Normalized key used for sorting and tie detection.
 */
type SortKey = {
  bucket: number;
  dnfLap: number;
  points: number;
  finishRankKey: number;
};

/**
 * Coerce unknown values to finite integers.
 * Invalid input falls back to the provided default.
 */
function toFiniteInt(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.floor(v);
}

/**
 * Coerce unknown values to finite numbers.
 * Invalid input falls back to the provided default.
 */
function toFiniteNumber(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Parse unknown bib-like values into a positive integer.
 */
export function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

/**
 * Create a neutral default race-result row for newly discovered bibs.
 */
export function makeDefaultRaceResult(bib: number): RaceResult {
  return {
    bib,
    rank: 0,
    points: 0,
    dnf: false,
    dnfLap: 0,
    dns: false,
    dsq: false,
    lapsCompleted: 0,
    finishTime: "",
    finishRank: 0,
  };
}

function isPointsSprintActivity(a: RaceActivityInput | any): a is RaceActivityPointsSprint {
  return a?.type === "pointsSprint";
}

function isDnfActivity(a: RaceActivityInput | any): a is RaceActivityDNF {
  return a?.type === "DNF";
}

function isPointsRemovalActivity(a: RaceActivityInput | any): a is RaceActivityPointsRemoval {
  return a?.type === "pointsRemoval";
}

function isDsqActivity(a: RaceActivityInput | any): a is RaceActivityDisqualfication {
  return a?.type === "DSQ";
}

function isDnsActivity(a: RaceActivityInput | any): a is RaceActivityDns {
  return a?.type === "DNS";
}

/**
 * Rebuild activity-derived race-result fields:
 * - points (with points removal by lap cutoff)
 * - dnf / dnfLap
 * - dsq / dns
 *
 * Manual fields such as finishTime / finishRank stay untouched.
 */
export function applyActivitiesToRaceResults(args: {
  prevResults: RaceResult[];
  starters: Array<Pick<Athlete, "bib">>;
  activities: RaceActivityInput[];
}): RaceResult[] {
  const prevResults = Array.isArray(args.prevResults) ? args.prevResults : [];
  const starters = Array.isArray(args.starters) ? args.starters : [];
  const activities = Array.isArray(args.activities) ? args.activities : [];

  const bibs = new Set<number>();

  for (const r of prevResults) {
    const bib = bibToInt(r?.bib);
    if (bib != null) bibs.add(bib);
  }

  for (const s of starters) {
    const bib = bibToInt(s?.bib);
    if (bib != null) bibs.add(bib);
  }

  for (const a of activities) {
    if (isPointsSprintActivity(a) || isPointsRemovalActivity(a) || isDnfActivity(a)) {
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt(r?.bib);
        if (bib != null) bibs.add(bib);
      }
      continue;
    }

    if (isDsqActivity(a) || isDnsActivity(a)) {
      const bib = bibToInt(a.data?.bib);
      if (bib != null) bibs.add(bib);
      continue;
    }

    const anyA = a as any;
    const maybeBib = bibToInt(anyA?.data?.bib);
    if (maybeBib != null) bibs.add(maybeBib);

    const maybeBibs = Array.isArray(anyA?.data?.bibs) ? (anyA.data.bibs as any[]) : [];
    for (const b of maybeBibs) {
      const bib = bibToInt(b);
      if (bib != null) bibs.add(bib);
    }
  }

  const byBib = new Map<number, RaceResult>();
  for (const r of prevResults) {
    const bib = bibToInt(r?.bib);
    if (bib == null || byBib.has(bib)) continue;
    byBib.set(bib, { ...r, bib });
  }

  for (const bib of bibs) {
    if (!byBib.has(bib)) byBib.set(bib, makeDefaultRaceResult(bib));
  }

  const pointsEntriesByBib = new Map<number, Array<{ lap: number; points: number }>>();
  const pointsRemovalCutoffByBib = new Map<number, number>();
  const dnfByBib = new Map<number, { dnf: "dnf" | "elimination"; lap: number }>();
  const dsqBibs = new Set<number>();
  const dnsBibs = new Set<number>();

  for (const a of activities) {
    if (isPointsSprintActivity(a)) {
      if (a.data?.isDeleted) continue;
      const lap = bibToInt(a.data?.lap) ?? 0;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt(r?.bib);
        const pts = Number(r?.points);
        if (bib == null || !Number.isFinite(pts)) continue;

        const prev = pointsEntriesByBib.get(bib) ?? [];
        prev.push({ lap, points: pts });
        pointsEntriesByBib.set(bib, prev);
      }
      continue;
    }

    if (isPointsRemovalActivity(a)) {
      if (a.data?.isDeleted) continue;

      const lap = bibToInt(a.data?.lap) ?? 0;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt(r?.bib);
        if (bib == null) continue;

        const prevCutoff = pointsRemovalCutoffByBib.get(bib) ?? 0;
        if (lap > prevCutoff) pointsRemovalCutoffByBib.set(bib, lap);
      }
      continue;
    }

    if (isDnfActivity(a)) {
      if (a.data?.isDeleted) continue;

      const dnfType = a.data?.dnfType === "dnf" || a.data?.dnfType === "elimination" ? a.data.dnfType : null;
      if (!dnfType) continue;

      const lap = bibToInt(a.data?.lap) ?? 0;
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt(r?.bib);
        if (bib == null) continue;

        const prev = dnfByBib.get(bib);
        if (!prev || lap > prev.lap || (lap === prev.lap && dnfType === "elimination" && prev.dnf !== "elimination")) {
          dnfByBib.set(bib, { dnf: dnfType, lap });
        }
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

    const anyA = a as any;
    const t = String(anyA?.type ?? "");
    const isDeleted = !!anyA?.data?.isDeleted;
    if (isDeleted) continue;

    const bib = bibToInt(anyA?.data?.bib);
    if (bib == null) continue;

    if (t === "DSQ") dsqBibs.add(bib);
    else if (t === "DNS") dnsBibs.add(bib);
  }

  const pointsByBib = new Map<number, number>();
  for (const [bib, entries] of pointsEntriesByBib) {
    const cutoffLap = pointsRemovalCutoffByBib.get(bib) ?? 0;
    const points = entries
      .filter((entry) => entry.lap > cutoffLap)
      .reduce((sum, entry) => sum + entry.points, 0);

    pointsByBib.set(bib, points);
  }

  for (const bib of pointsRemovalCutoffByBib.keys()) {
    if (!pointsByBib.has(bib)) pointsByBib.set(bib, 0);
  }

  // Domain rule: DNF always overrides sprint points.
  for (const [bib, status] of dnfByBib) {
    if (status.lap > 0) pointsByBib.set(bib, 0);
  }

  const used = new Set<number>();

  const applyDerived = (base: RaceResult): RaceResult => {
    const bib = bibToInt(base.bib) ?? base.bib;

    const points = pointsByBib.get(bib) ?? 0;
    const dnfStatus = dnfByBib.get(bib);
    const dnf = dnfStatus?.dnf ?? false;
    const dnfLap = dnfStatus?.lap ?? 0;

    return {
      ...base,
      bib,
      points,
      dnf,
      dnfLap,
      dsq: dsqBibs.has(bib),
      dns: dnsBibs.has(bib),
    };
  };

  const next: RaceResult[] = [];
  for (const r of prevResults) {
    const bib = bibToInt(r?.bib);
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

/**
 * Status ordering bucket (lower = better):
 * 0 = normal result
 * 1 = DNF / elimination
 * 2 = DSQ
 * 3 = DNS
 */
function statusBucket(r: RaceResult): number {
  if (r.dsq) return 2;
  if (r.dns) return 3;
  return r.dnf !== false ? 1 : 0;
}

/**
 * Convert a race result into a comparison key.
 *
 * Domain decision:
 * - `finishRank <= 0` means "no valid finish rank" and is treated as Infinity
 *   so it naturally sorts to the back when finish rank is considered.
 */
function sortKey(r: RaceResult): SortKey {
  const finishRank = toFiniteInt(r.finishRank, 0);

  return {
    bucket: statusBucket(r),
    dnfLap: toFiniteInt(r.dnfLap, 0),
    points: toFiniteNumber(r.points, 0),
    finishRankKey: finishRank > 0 ? finishRank : Number.POSITIVE_INFINITY,
  };
}

/**
 * Comparator for standings (best -> worst):
 * 1) status bucket
 * 2) dnf lap (higher is better)
 * 3) points (higher is better)
 * 4) finish rank (lower is better)
 * 5) bib as deterministic final tie-breaker
 */
function compareRaceResultsForStandings(ra: RaceResult, rb: RaceResult): number {
  const a = sortKey(ra);
  const b = sortKey(rb);

  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  if (a.dnfLap !== b.dnfLap) return b.dnfLap - a.dnfLap;
  if (a.points !== b.points) return b.points - a.points;
  if (a.finishRankKey !== b.finishRankKey) return a.finishRankKey - b.finishRankKey;

  return toFiniteInt(ra.bib, 0) - toFiniteInt(rb.bib, 0);
}

/**
 * Key equality used for tie handling in rank assignment.
 */
function keysEqual(a: SortKey, b: SortKey): boolean {
  return (
    a.bucket === b.bucket &&
    a.dnfLap === b.dnfLap &&
    a.points === b.points &&
    a.finishRankKey === b.finishRankKey
  );
}

/**
 * Returns a sorted copy for standings display.
 *
 * Does not mutate input and does not assign rank values.
 */
export function sortRaceResultsForStandings(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];
  return list.sort(compareRaceResultsForStandings);
}

/**
 * Recompute `rank` values using standings rules.
 *
 * Tie behavior:
 * - regular ties produce standard competition ranking (1,1,3,...)
 * - special domain rule: all DNF riders in the same DNF lap share a rank,
 *   regardless of points/finish rank
 *
 * Output order behavior:
 * - ranks are computed on a sorted copy
 * - returned array preserves original row order to minimize persistence churn
 */
export function recomputeRaceResults(input: RaceResult[]): RaceResult[] {
  const list = Array.isArray(input) ? [...input] : [];
  const sorted = [...list].sort(compareRaceResultsForStandings);

  const rankByBib = new Map<number, number>();
  let prevKey: SortKey | null = null;
  let prevRank = 0;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const bib = toFiniteInt(r.bib, 0);
    if (bib <= 0) continue;

    const key = sortKey(r);

    const sameDnfLapTie =
      prevKey !== null &&
      prevKey.bucket === 1 &&
      key.bucket === 1 &&
      prevKey.dnfLap > 0 &&
      prevKey.dnfLap === key.dnfLap;

    const isTie = prevKey !== null && (keysEqual(prevKey, key) || sameDnfLapTie);
    const rank = isTie ? prevRank : i + 1;

    rankByBib.set(bib, rank);
    prevKey = key;
    prevRank = rank;
  }

  return list.map((r) => {
    const bib = toFiniteInt(r.bib, 0);
    const nextRank = rankByBib.get(bib);
    return nextRank != null ? { ...r, rank: nextRank } : r;
  });
}

/**
 * Convenience helper for the common flow:
 * - derive activity-based fields
 * - then recompute consolidated rank
 */
export function materializeRaceResults(args: {
  prevResults: RaceResult[];
  starters: Array<Pick<Athlete, "bib">>;
  activities: RaceActivityInput[];
}): RaceResult[] {
  return recomputeRaceResults(applyActivitiesToRaceResults(args));
}
