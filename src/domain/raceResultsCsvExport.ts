import type { RaceResult } from "../types/race";

import { recomputeRaceResults, sortRaceResultsForStandings } from "./raceResultsActions";

export const RACE_RESULTS_CSV_HEADER =
  "bib;rank;finish_time;points;eliminated;elimination_lap;laps_completed;dns;dsq;rank_at_finish;remark";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (!s) return "";

  // Quote if needed (semicolon delimiter).
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

function toBoolString(v: unknown): "true" | "false" {
  return v ? "true" : "false";
}

/**
 * Builds a CSV export for RaceResults.
 * - Separator: ';'
 * - Sorted using the same logic as `recomputeRaceResults` (raceResultsActions.ts)
 * - Includes a header row
 */
export function buildRaceResultsCsv(results: RaceResult[]): string {
  const base = Array.isArray(results) ? results : [];

  // Ensure ranks are consistent with current sorting rules.
  const ranked = recomputeRaceResults(base);

  // Export in standings order (NOT in document order).
  const sorted = sortRaceResultsForStandings(ranked);

  const lines: string[] = [RACE_RESULTS_CSV_HEADER];

  for (const r of sorted) {
    const row = [
      r.bib,
      r.dns ? "" : r.rank > 0 ? r.rank : "",
      r.finishTime ?? "",
      r.points ?? 0,
      toBoolString(r.eliminated),
      r.eliminationLap ?? 0,
      r.lapsCompleted ?? 0,
      toBoolString(r.dns),
      toBoolString(r.dsq),
      r.finishRank > 0 ? r.finishRank : "",
      r.dns ? "DNS" : r.dsq ? "DSQ" : "",
    ];

    lines.push(row.map(csvEscape).join(";"));
  }

  // Add UTF-8 BOM for better Excel compatibility.
  return `\uFEFF${lines.join("\r\n")}`;
}
