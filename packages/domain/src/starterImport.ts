/**
 * starterImport
 * ------------
 * Shared CSV parsing and normalization helpers for race-starter imports.
 *
 * Why this exists:
 * - Import rules must be deterministic across UI contexts (web pages, admin tools, batch jobs).
 * - Keeping this logic in domain avoids drift between multiple frontend implementations.
 *
 * Scope:
 * - delimiter-based CSV parsing with quoted-field support
 * - starter row extraction (bib, name, IOC, transponder ids)
 * - stable empty-row detection and explainable skip reasons
 */

export type CsvParseResult = {
  headers: string[];
  rows: string[][];
};

export type StarterImportRow = {
  bib: number | null;
  firstName: string;
  lastName: string;
  nation: string | null;
  transponderIds: string[];
};

export type SkippedStarterRowInfo = {
  /** 1-based line number in source CSV (including header line). */
  csvLineNo: number;
  row: string[];
  reason: string;
};

export type StarterImportAnalysis = {
  importable: StarterImportRow[];
  skippedEmpty: SkippedStarterRowInfo[];
  missingRequiredHeaders: string[];
};

function splitCsvLine(line: string, delimiter: string): string[] {
  // Supports quoted fields with escaped quotes ("").
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

/**
 * Parses delimited text into a header + rows matrix.
 *
 * Domain decision:
 * - we keep parser permissive and never throw for row width mismatches
 * - validation/mapping logic is done in a separate analysis step
 */
export function parseDelimitedText(text: string, delimiter = ";"): CsvParseResult {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  // Trim UTF-8 BOM if present.
  if (lines.length > 0) lines[0] = lines[0].replace(/^\uFEFF/, "");

  // Remove trailing empty lines for stable preview counts.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const matrix = lines.map((line) => splitCsvLine(line, delimiter));
  const headers = matrix[0] ?? [];
  const rows = matrix.slice(1);

  return { headers, rows };
}

export function buildHeaderIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < headers.length; i += 1) {
    map[String(headers[i] ?? "").trim()] = i;
  }
  return map;
}

function parseBib(input: string): number | null {
  const value = String(input ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIoc(input: string): string | null {
  const value = String(input ?? "").trim().toUpperCase();
  if (!value) return null;

  // IOC is intentionally strict here (exactly three letters).
  if (!/^[A-Z]{3}$/.test(value)) return null;
  return value;
}

function extractIocFromLastName(lastName: string): string | null {
  // Example: "Presti (ITA)" -> "ITA"
  const match = String(lastName ?? "").match(/\(([A-Za-z]{3})\)\s*$/);
  return match ? normalizeIoc(match[1]) : null;
}

function stripIocFromLastName(lastName: string): string {
  return String(lastName ?? "").replace(/\s*\([A-Za-z]{3}\)\s*$/, "").trim();
}

function normalizeTransponderIds(values: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of values) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    unique.add(id);
  }
  return [...unique];
}

/**
 * Maps raw CSV rows to starter import rows with deterministic skip behavior.
 */
export function analyzeStarterImportCsv(parsed: CsvParseResult): StarterImportAnalysis {
  const result: StarterImportAnalysis = {
    importable: [],
    skippedEmpty: [],
    missingRequiredHeaders: [],
  };

  const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const headerIndex = buildHeaderIndex(headers);

  const requiredHeaders = ["No", "FirstName", "LastName"];
  result.missingRequiredHeaders = requiredHeaders.filter((name) => headerIndex[name] === undefined);

  const idxNo = headerIndex["No"];
  const idxFirst = headerIndex["FirstName"];
  const idxLast = headerIndex["LastName"];
  const idxAdditional1 = headerIndex["Additional1"];
  const idxTransponder1 = headerIndex["Transponder1"];
  const idxTransponder2 = headerIndex["Transponder2"];

  rows.forEach((row, rowIdx) => {
    const bibRaw = idxNo !== undefined ? (row[idxNo] ?? "") : "";
    const firstRaw = idxFirst !== undefined ? (row[idxFirst] ?? "") : "";
    const lastRaw = idxLast !== undefined ? (row[idxLast] ?? "") : "";
    const iocRaw = idxAdditional1 !== undefined ? (row[idxAdditional1] ?? "") : "";
    const transponder1Raw = idxTransponder1 !== undefined ? (row[idxTransponder1] ?? "") : "";
    const transponder2Raw = idxTransponder2 !== undefined ? (row[idxTransponder2] ?? "") : "";

    const firstName = String(firstRaw).trim();
    const lastNameWithMaybeIoc = String(lastRaw).trim();

    const nation = normalizeIoc(iocRaw) ?? extractIocFromLastName(lastNameWithMaybeIoc);
    const lastName = stripIocFromLastName(lastNameWithMaybeIoc);
    const bib = parseBib(bibRaw);
    const transponderIds = normalizeTransponderIds([transponder1Raw, transponder2Raw]);

    // Empty starter row: no bib + no names + no IOC + no transponder ids.
    const isEmptyStarterRow = bib === null && firstName === "" && lastName === "" && !nation && transponderIds.length === 0;

    if (isEmptyStarterRow) {
      result.skippedEmpty.push({
        csvLineNo: rowIdx + 2, // +1 header, +1 because csv lines are 1-based.
        row,
        reason: "Leere Starter-Zeile (Bib/FirstName/LastName/Nation/Transponder leer) – wird nicht importiert",
      });
      return;
    }

    result.importable.push({
      bib,
      firstName,
      lastName,
      nation,
      transponderIds,
    });
  });

  return result;
}
