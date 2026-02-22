/**
 * applyActivitiesToRaceResults
 * ---------------------------
 * Materializes/derives fields in `RaceResult` from the event log (`raceActivities`).
 *
 * In this client, `raceActivities` are the source-of-truth for things like points sprints and
 * eliminations. `raceResults` is a consolidated "current state" view used by UI components and
 * (later) by exporting/printing.
 *
 * This helper:
 * - Ensures there is a `RaceResult` row for every relevant bib (starters, existing results, bibs in activities).
 * - Preserves "manual" fields that are maintained elsewhere (e.g. finishRank/finishTime/lapsCompleted).
 * - Overwrites ONLY fields that are derived from activities (currently: points + elimination flags).
 *
 * IMPORTANT:
 * - This function does NOT compute `rank`. Call `recomputeRaceResults(...)` afterwards.
 */

import type { Athlete } from "../../types/athlete";
import type {
  RaceActivity,
  RaceActivityDisqualfication,
  RaceActivityDns,
  RaceActivityElimination,
  RaceActivityPointsSprint,
} from "../../types/raceactivities";
import type { RaceResult } from "../../types/race";

// Small parsing helper: allow bib as number or string; normalize to positive integer.
function bibToInt(bib: unknown): number | null {
  if (bib == null) return null;
  const n = typeof bib === "number" ? bib : Number(String(bib).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

// Default RaceResult entry for a bib that exists in starters/activities but not yet in raceResults.
function makeDefaultRaceResult(bib: number): RaceResult {
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
 * Derive the activity-based fields of RaceResults.
 *
 * Current derived fields:
 * - points: sum of all non-deleted pointsSprint activity results
 * - eliminated/eliminationLap: from non-deleted elimination activities (per bib we keep the max lap)
 *
 * Preserved fields (examples):
 * - finishRank, finishTime, lapsCompleted
 *
 * Also supported (derived) if present in raceActivities:
 * - DSQ/DNS: sets dsq/dns based on non-deleted activities
 */
export function applyActivitiesToRaceResults(args: {
  prevResults: RaceResult[];
  starters: Athlete[];
  activities: RaceActivity[];
}): RaceResult[] {
  const prevResults = Array.isArray(args.prevResults) ? args.prevResults : [];
  const starters = Array.isArray(args.starters) ? args.starters : [];
  const activities = Array.isArray(args.activities) ? args.activities : [];

  // ---------------------------------------------------------------------------
  // Collect all bibs we need RaceResult rows for.
  //
  // We want RaceResults to be able to represent:
  // - starters
  // - any bib that already has manual data stored (finishRank/finishTime)
  // - any bib referenced by activities (points/elimination)
  // ---------------------------------------------------------------------------
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
    if (isPointsSprintActivity(a)) {
      const res = Array.isArray(a.data?.results) ? a.data.results : [];
      for (const r of res) {
        const bib = bibToInt((r as any)?.bib);
        if (bib != null) bibs.add(bib);
      }
      continue;
    }

    if (isEliminationActivity(a)) {
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

    // Fallback for potential future activity shapes.
    const maybeBib = bibToInt((a as any)?.data?.bib);
    if (maybeBib != null) bibs.add(maybeBib);
    const maybeBibs = Array.isArray((a as any)?.data?.bibs) ? ((a as any).data.bibs as any[]) : [];
    for (const b of maybeBibs) {
      const bib = bibToInt(b);
      if (bib != null) bibs.add(bib);
    }
  }

  // ---------------------------------------------------------------------------
  // Base map: preserve existing RaceResult rows.
  // This is where we keep manual fields (finishRank/finishTime/lapsCompleted, etc.).
  // We'll later overwrite only the fields we derive from activities.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Derive fields from activities.
  //
  // We compute per-bib aggregates and then apply them in one pass:
  // - pointsByBib: sum of points
  // - elimLapByBib: max elimination lap (max because later eliminations should dominate)
  // ---------------------------------------------------------------------------
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
      // Lap is a number but we treat it like an integer; invalid values -> 0.
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

    // Fallback for potential future activity shapes
    const t = String((a as any)?.type ?? "");
    const isDeleted = !!(a as any)?.data?.isDeleted;
    if (isDeleted) continue;

    const bib = bibToInt((a as any)?.data?.bib);
    if (bib == null) continue;

    if (t === "DSQ") dsqBibs.add(bib);
    else if (t === "DNS") dnsBibs.add(bib);
  }

  // ---------------------------------------------------------------------------
  // Build next array in stable order: keep previous ordering first, then append new bibs.
  // This reduces diff/noise in the realtime doc (and keeps UI stable).
  // ---------------------------------------------------------------------------
  const used = new Set<number>();

  // Apply computed aggregates to a preserved base RaceResult row.
  // Only the derived fields are overwritten.
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
