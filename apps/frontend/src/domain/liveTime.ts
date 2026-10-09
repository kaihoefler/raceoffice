// src/domain/liveTime.ts
//
// Time parsing/formatting for live feed times (e.g. "0:15.032").
// LiveRaceStatus shows the leader's total time and, for everybody else, the gap to the
// leader in German notation ("+0,032", "+1:02,500"). Pure functions, no React.

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
    const norm = p.replace(",", ".");
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  };

  if (parts.length === 1) {
    return parseSecondsPart(parts[0]!);
  }

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
  const d = Math.abs(deltaSeconds);

  // Round to milliseconds to avoid float noise.
  const ms = Math.round(d * 1000);
  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    const s = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(totalSeconds);
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
