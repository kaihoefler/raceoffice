import type { RaceActivity } from "../types/raceactivities";

import { bibToInt } from "./raceResultsActions";

/**
 * Keeps only activity references to bibs that are still allowed in the race.
 *
 * Rules:
 * - pointsSprint / DNF(elimination): filter `data.results` by bib
 * - DNS / DSQ: drop the whole activity if its bib is no longer allowed
 * - empty points / DNF(elimination) activities are removed completely
 */
export function filterActivitiesByAllowedBibs(activities: RaceActivity[], allowedBibs: Iterable<number>): RaceActivity[] {
  const base = Array.isArray(activities) ? activities : [];

  const allowed = new Set<number>();
  for (const bib of allowedBibs) {
    const normalized = bibToInt(bib);
    if (normalized != null) allowed.add(normalized);
  }

  return base
    .map((activity) => {
      if (activity.type === "pointsSprint") {
        const nextResults = (Array.isArray(activity.data?.results) ? activity.data.results : []).filter((row) => {
          const bib = bibToInt((row as any)?.bib);
          return bib != null && allowed.has(bib);
        });

        if (nextResults.length === 0) return null;

        return {
          ...activity,
          data: {
            ...activity.data,
            results: nextResults,
          },
        };
      }

      if (activity.type === "DNF" && activity.data?.dnfType === "elimination") {
        const nextResults = (Array.isArray(activity.data?.results) ? activity.data.results : []).filter((row) => {
          const bib = bibToInt((row as any)?.bib);
          return bib != null && allowed.has(bib);
        });

        if (nextResults.length === 0) return null;

        return {
          ...activity,
          data: {
            ...activity.data,
            results: nextResults,
          },
        };
      }

      if (activity.type === "DNS" || activity.type === "DSQ") {
        const bib = bibToInt(activity.data?.bib);
        if (bib == null || !allowed.has(bib)) return null;
      }

      return activity;
    })
    .filter((activity): activity is RaceActivity => activity !== null);
}

/**
 * Removes all references to a single bib from the race activities.
 */
export function removeBibFromActivities(activities: RaceActivity[], bib: number): RaceActivity[] {
  const toRemove = bibToInt(bib);
  if (toRemove == null) return Array.isArray(activities) ? [...activities] : [];

  const allowed = new Set<number>();
  for (const activity of Array.isArray(activities) ? activities : []) {
    if (activity.type === "pointsSprint" || (activity.type === "DNF" && activity.data?.dnfType === "elimination")) {
      for (const row of Array.isArray(activity.data?.results) ? activity.data.results : []) {
        const rowBib = bibToInt((row as any)?.bib);
        if (rowBib != null && rowBib !== toRemove) allowed.add(rowBib);
      }
      continue;
    }

    if (activity.type === "DNS" || activity.type === "DSQ") {
      const rowBib = bibToInt(activity.data?.bib);
      if (rowBib != null && rowBib !== toRemove) allowed.add(rowBib);
    }
  }

  return filterActivitiesByAllowedBibs(activities, allowed);
}
