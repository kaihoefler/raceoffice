import type { Athlete } from "@raceoffice/domain";

/**
 * Generic row type for importing/merging starters.
 * (Used by RaceStartersImport + other sources such as Live feeds.)
 */
export type StarterImportRow = {
  bib: number | null;
  firstName: string;
  lastName: string;
  nation: string | null;
};

/**
 * Normalizes an IOC/nation code.
 * - empty => null
 * - otherwise => trimmed uppercase (we do not hard-reject non-IOC values; UI may still want to store them)
 */
export function normalizeIoc(input: string): string | null {
  const v = String(input ?? "").trim().toUpperCase();
  if (!v) return null;
  return v;
}

/** Parses a bib from a text input. */
export function parseBib(input: string): number | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Returns a new starters list without the given athlete id. */
export function removeStarterById(existing: Athlete[], athleteId: string): Athlete[] {
  const base = Array.isArray(existing) ? existing : [];
  const id = String(athleteId ?? "").trim();
  if (!id) return [...base];
  return base.filter((a) => String(a.id) !== id);
}

/**
 * Stable name key used for deduping when bib is missing.
 * Nation is included because names can repeat across nations.
 */
export function makeNameKey(row: {
  firstName: string;
  lastName: string;
  nation: string | null;
}): string {
  return `${String(row.firstName ?? "").trim().toLowerCase()}|${String(row.lastName ?? "").trim().toLowerCase()}|${String(
    row.nation ?? "",
  )
    .trim()
    .toUpperCase()}`;
}

/**
 * Converts import rows to Athletes (new ids).
 * Filters out rows without first+last name.
 */
export function rowsToAthletes(rows: StarterImportRow[], ageGroupId: string): Athlete[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => String(r.firstName ?? "").trim() && String(r.lastName ?? "").trim())
    .map((r) => ({
      id: crypto.randomUUID(),
      bib: r.bib,
      firstName: String(r.firstName ?? "").trim(),
      lastName: String(r.lastName ?? "").trim(),
      nation: r.nation,
      ageGroupId,
    }));
}

/**
 * Merges imported starters into an existing list.
 *
 * Rules:
 * - If an incoming row has a bib that already exists => UPDATE that athlete (overwrite names/nation).
 * - Else if it matches by (firstName,lastName,nation) => UPDATE that athlete.
 * - Else => ADD a new athlete.
 *
 * The returned list keeps the original order of `existing`, applies updates in-place,
 * and appends new athletes at the end.
 */
export function mergeStarters(existing: Athlete[], rows: StarterImportRow[], ageGroupId: string): Athlete[] {
  const base = Array.isArray(existing) ? existing : [];

  const byBib = new Map<number, Athlete>();
  const byName = new Map<string, Athlete>();

  for (const a of base) {
    if (a.bib != null) byBib.set(a.bib, a);
    byName.set(
      makeNameKey({ firstName: a.firstName ?? "", lastName: a.lastName ?? "", nation: a.nation ?? null }),
      a,
    );
  }

  const updatesById = new Map<string, Athlete>();
  const additions: Athlete[] = [];

  for (const r of Array.isArray(rows) ? rows : []) {
    const firstName = String(r.firstName ?? "").trim();
    const lastName = String(r.lastName ?? "").trim();
    if (!firstName || !lastName) continue;

    const candidate: Omit<Athlete, "id"> = {
      bib: r.bib,
      firstName,
      lastName,
      nation: r.nation,
      ageGroupId,
    };

    const match =
      (candidate.bib != null ? byBib.get(candidate.bib) : undefined) ??
      byName.get(makeNameKey({ firstName, lastName, nation: r.nation }));

    if (match) {
      // Requirement: if bib matches, overwrite name/nation as well.
      updatesById.set(match.id, { ...match, ...candidate, ageGroupId });
    } else {
      additions.push({ id: crypto.randomUUID(), ...candidate });
    }
  }

  return [...base.map((a) => updatesById.get(a.id) ?? a), ...additions];
}

/**
 * Upserts a list of incoming Athletes into an existing starters list.
 *
 * Matching strategy:
 * - bib match (if incoming.bib != null)
 * - else nameKey match
 *
 * On match, we keep the existing id and overwrite fields with incoming.
 */
export function upsertStarters(existing: Athlete[], incoming: Athlete[]): Athlete[] {
  const base = Array.isArray(existing) ? existing : [];

  const byBib = new Map<number, Athlete>();
  const byName = new Map<string, Athlete>();
  for (const a of base) {
    if (a.bib != null) byBib.set(a.bib, a);
    byName.set(makeNameKey({ firstName: a.firstName ?? "", lastName: a.lastName ?? "", nation: a.nation ?? null }), a);
  }

  const updatesById = new Map<string, Athlete>();
  const additions: Athlete[] = [];

  for (const inc of Array.isArray(incoming) ? incoming : []) {
    const incFirst = String(inc.firstName ?? "").trim();
    const incLast = String(inc.lastName ?? "").trim();

    const match =
      (inc.bib != null ? byBib.get(inc.bib) : undefined) ??
      byName.get(makeNameKey({ firstName: incFirst, lastName: incLast, nation: inc.nation ?? null }));

    if (match) {
      updatesById.set(match.id, {
        ...match,
        ...inc,
        id: match.id,
      });
    } else {
      additions.push(inc);
    }
  }

  return [...base.map((a) => updatesById.get(a.id) ?? a), ...additions];
}
