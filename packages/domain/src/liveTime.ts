/**
 * liveTime
 * --------
 * Display helpers for the live race status feed (times like "0:15.032", names with IOC suffix),
 * shared by the scoring frontend (LiveRaceStatus) and the leaderboard frontend.
 * Pure functions, no React.
 */
import type { RaceStatusCompetitor, RaceStatusRace } from "./raceStatusFeed.js";

/**
 * Parses a time string into seconds.
 * Supports "ss(.fff)", "m:ss(.fff)" and "h:mm:ss(.fff)"; a decimal comma is accepted ("0:15,032").
 * Returns null for empty or unparsable input.
 */
export function parseTimeToSeconds(input: string): number | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  const parts = s.split(":");
  const parseSecondsPart = (p: string) => {
    const n = Number(p.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  if (parts.length === 1) return parseSecondsPart(parts[0]!);
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = parseSecondsPart(parts[1]!);
    if (!Number.isFinite(mm) || ss === null) return null;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = parseSecondsPart(parts[2]!);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || ss === null) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

/**
 * Formats a time difference in seconds (de-DE, 3 decimals, explicit sign):
 * below 60 s "+0,032", from 60 s on "+m:ss,fff".
 */
export function formatDeltaSeconds(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "-" : "+";
  // Round to milliseconds to avoid float noise.
  const totalSeconds = Math.round(Math.abs(deltaSeconds) * 1000) / 1000;

  if (totalSeconds < 60) {
    const s = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(totalSeconds);
    return `${sign}${s}`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds - minutes * 60;
  const restStr = new Intl.NumberFormat("de-DE", {
    minimumIntegerDigits: 2,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(rest);
  return `${sign}${minutes}:${restStr}`;
}

const IOC_SUFFIX = /\s*\(([A-Z]{3})\)\s*/g;

/** Removes IOC suffixes from a name part: "Müller (GER)" → "Müller". */
export function stripIocSuffix(namePart: string): string {
  return String(namePart ?? "").replace(IOC_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/** Nation code from the IOC suffix of the last name ("Rojas Gil (COL)" → "COL"), or "". */
export function nationOf(competitor: Pick<RaceStatusCompetitor, "lastName">): string {
  const m = /\(([A-Z]{3})\)/.exec(String(competitor.lastName ?? ""));
  return m?.[1] ?? "";
}

/** One row of a leaderboard with derived gap/interval texts. */
export type StandingRow = {
  competitor: RaceStatusCompetitor;
  /** Leader: total time (or "L<laps>" without time); others: "+Δ" or "+n Laps"; "" if unknown. */
  gap: string;
  /** Distance to the competitor in front, same notation; "" for the leader. */
  interval: string;
  /** Classified (position > 0). */
  classified: boolean;
};

/** Total time of the leader for display: the time, or "L<laps>" if none is known. */
export function formatLeaderTime(totalTime: string, lapsComplete: number): string {
  const t = String(totalTime ?? "").trim();
  return t && t !== "0:00" ? t : `L${lapsComplete}`;
}

function distance(ahead: RaceStatusCompetitor, behind: RaceStatusCompetitor): string {
  const lapsAhead = Number(ahead.lapsComplete ?? 0);
  const lapsBehind = Number(behind.lapsComplete ?? 0);
  if (lapsBehind < lapsAhead) {
    const diff = lapsAhead - lapsBehind;
    return diff === 1 ? "+1 Lap" : `+${diff} Laps`;
  }
  const a = parseTimeToSeconds(ahead.totalTime);
  const b = parseTimeToSeconds(behind.totalTime);
  if (a === null || b === null || b === 0) return "";
  return formatDeltaSeconds(b - a);
}

/**
 * Sorted standings (classified by position, unclassified last) with gap to the leader and
 * interval to the competitor in front – the same rule as in the scoring (laps first, then time).
 */
export function computeStandings(race: Pick<RaceStatusRace, "competitors">): StandingRow[] {
  const competitors = [...(race.competitors ?? [])].sort((a, b) => {
    const pa = a.position > 0 ? a.position : Number.MAX_SAFE_INTEGER;
    const pb = b.position > 0 ? b.position : Number.MAX_SAFE_INTEGER;
    return pa - pb || String(a.number).localeCompare(String(b.number), "en", { numeric: true });
  });
  const leader = competitors[0];
  return competitors.map((c, i) => {
    const classified = c.position > 0;
    if (!leader || !classified) return { competitor: c, gap: "", interval: "", classified };
    if (c === leader) {
      return { competitor: c, gap: formatLeaderTime(c.totalTime, Number(c.lapsComplete ?? 0)), interval: "", classified };
    }
    const ahead = competitors[i - 1] ?? leader;
    return { competitor: c, gap: distance(leader, c), interval: distance(ahead, c), classified };
  });
}
