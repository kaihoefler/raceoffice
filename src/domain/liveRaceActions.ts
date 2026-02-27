// src/domain/liveRaceActions.ts
//
// Domain helpers for working with "LiveRace" feeds.
//
// Responsibilities:
// - Infer race draft fields (ageGroupId + race mode + name) from a live race name.
// - Convert live competitors to local `Athlete` objects (bib/name/nation), which can then be
//   stored as `raceStarters`.

import type { AgeGroup } from "../types/agegroup";
import type { Athlete } from "../types/athlete";
import type { Race } from "../types/race";

// Small ID helper for creating new Athlete ids.
// Uses crypto.randomUUID if available; otherwise falls back to a timestamp-based id.
function newId(): string {
  return (globalThis.crypto as any)?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// Extract nation code from a "LastName (IOC)" string as found in the live feed.
// Example:
//   "Smith (GBR)" -> { lastName: "Smith", nation: "GBR" }
function extractNationFromLastName(lastNameRaw: string): { lastName: string; nation: string | null } {
  const s = String(lastNameRaw ?? "").trim();

  // We only accept "(AAA)" at the end, where AAA are 3 uppercase letters.
  const m = s.match(/\(([A-Z]{3})\)\s*$/);
  if (!m) return { lastName: s, nation: null };

  const nation = m[1];
  const lastName = s.replace(/\s*\([A-Z]{3}\)\s*$/, "").trim();
  return { lastName, nation };
}

// Normalize a bib value from the live feed.
// Live feeds sometimes provide bibs as strings; we accept number-ish values and normalize to
// a positive integer.
function toBib(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  return i > 0 ? i : null;
}

// Infer race mode flags from race name.
// This is heuristic and intentionally simple (substring matching).
function inferRaceModeFromName(name: string): Race["racemode"] {
  const s = String(name ?? "").toLowerCase();

  return {
    // Points race if the name contains either English or German keyword.
    isPointsRace: s.includes("points") || s.includes("punkte"),

    // Elimination race if the name contains either abbreviation or German keyword.
    isEliminationRace: s.includes("elim") || s.includes("ausscheidung"),
  };
}

// Infer ageGroupId from race name.
//
// Heuristics:
// 1) Match the AgeGroup.name as substring.
// 2) If the race name contains a gender hint, prefer/require that gender (men/ladies).
//    - ladies: Ladies / Woman / Women / Damen / Girls
//    - men: men / boys / Herren
// 3) If multiple age groups match, pick the most specific one (longest matching name).
function inferAgeGroupIdFromName(name: string, ageGroups: AgeGroup[]): string {
  const hay = String(name ?? "").toLowerCase();

  const ladiesTokens = ["ladies", "woman", "women", "damen", "girls"];
  const menTokens = ["men", "boys", "herren"];

  const hasAny = (tokens: string[]) => tokens.some((t) => hay.includes(t));

  const ladiesHint = hasAny(ladiesTokens);
  const menHint = hasAny(menTokens);

  // If both hints appear, it's ambiguous -> do not enforce gender filtering.
  const hintedGender: AgeGroup["gender"] | null = ladiesHint && !menHint ? "ladies" : menHint && !ladiesHint ? "men" : null;

  // If multiple age groups match, pick the longest name (most specific).
  // Prefer matching gender if the race name contains a gender hint.
  let best: { id: string; len: number; genderScore: number } | null = null;

  for (const ag of ageGroups) {
    const needle = String(ag?.name ?? "").trim().toLowerCase();
    if (!needle) continue;
    if (!hay.includes(needle)) continue;

    // If the race name clearly hints a gender, filter out non-matching gender groups (except mixed).
    if (hintedGender && ag.gender !== "mixed" && ag.gender !== hintedGender) {
      continue;
    }

    // Used only as tie-breaker when we have a hintedGender.
    const genderScore = hintedGender
      ? ag.gender === hintedGender
        ? 2
        : ag.gender === "mixed"
          ? 1
          : 0
      : 0;

    if (!best) {
      best = { id: ag.id, len: needle.length, genderScore };
      continue;
    }

    // Primary: genderScore (desc) when gender is hinted.
    if (genderScore !== best.genderScore) {
      if (genderScore > best.genderScore) best = { id: ag.id, len: needle.length, genderScore };
      continue;
    }

    // Secondary: longest matching age group name.
    if (needle.length > best.len) best = { id: ag.id, len: needle.length, genderScore };
  }

  // Fallback: first age group if nothing matches (keeps UI usable).
  return best?.id ?? (ageGroups[0]?.id ?? "");
}

/**
 * Domain helper: infer a minimal set of race draft fields from a LiveRace name.
 *
 * Rules:
 * - name: liveRaceName
 * - ageGroupId: if an AgeGroup name appears as substring in the liveRaceName (case-insensitive), use that.
 * - racemode:
 *   - points if name contains "Points" or "Punkte"
 *   - elimination if name contains "Elim" or "Ausscheidung"
 */
export function inferRaceDraftFromLiveName(args: {
  liveRaceName: string;
  ageGroups: AgeGroup[];
}): Pick<Race, "name" | "ageGroupId" | "racemode"> {
  const liveName = String(args.liveRaceName ?? "").trim();
  const ageGroups = Array.isArray(args.ageGroups) ? args.ageGroups : [];

  // These are the only fields we infer. The user can still adjust other metadata
  // (distance/stage/etc.) in RaceEditor before saving.
  return {
    name: liveName || "Live Race",
    ageGroupId: inferAgeGroupIdFromName(liveName, ageGroups),
    racemode: inferRaceModeFromName(liveName),
  };
}

/**
 * Builds race starters from live competitors.
 *
 * Expected competitor shape (defensive):
 * - number: bib
 * - firstName/lastName: rider name parts
 */
export function buildStartersFromLiveCompetitors(args: {
  competitors: unknown;
  ageGroupId?: string | null;
}): Athlete[] {
  // Defensive: live provider returns unknown shapes; we only accept arrays.
  const list = Array.isArray(args.competitors) ? (args.competitors as any[]) : [];
  const ageGroupId = args.ageGroupId ?? null;

  // Dedupe by bib (live feeds can contain duplicates / updates).
  const byBib = new Map<number, Athlete>();

  for (const c of list) {
    const bib = toBib((c as any)?.number);
    if (bib == null) continue;
    if (byBib.has(bib)) continue;

    // Live fields are optional; we trim so UI doesn't show odd whitespace.
    const firstName = String((c as any)?.firstName ?? "").trim();
    const { lastName, nation } = extractNationFromLastName(String((c as any)?.lastName ?? ""));

    byBib.set(bib, {
      id: newId(),
      firstName,
      lastName,
      bib,
      ageGroupId,
      nation,
    });
  }

  // Stable order: sort by bib.
  return Array.from(byBib.values()).sort((a, b) => (Number(a.bib) || 0) - (Number(b.bib) || 0));
}
