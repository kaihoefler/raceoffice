// src/components/RaceStartersImport.tsx
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

type CsvParseResult = {
  headers: string[];
  rows: string[][];
};

type Encoding = "utf-8" | "windows-1252";

function splitCsvLine(line: string, delimiter: string): string[] {
  // supports quoted fields with escaped quotes ("")
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
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

function parseDelimited(text: string, delimiter = ";"): CsvParseResult {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  // trim BOM if present
  if (lines.length > 0) lines[0] = lines[0].replace(/^\uFEFF/, "");

  // remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const matrix = lines.map((l) => splitCsvLine(l, delimiter));
  const headers = matrix[0] ?? [];
  const rows = matrix.slice(1);

  return { headers, rows };
}

function normalizeIoc(input: string): string | null {
  const v = input.trim().toUpperCase();
  if (!v) return null;

  // Only accept real IOC codes (exactly 3 letters).
  // If the field contains something else, we treat it as "no IOC" so that
  // we can fall back to parsing "(IOC)" from the LastName.
  if (!/^[A-Z]{3}$/.test(v)) return null;

  return v;
}

function parseBib(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractIocFromLastName(lastName: string): string | null {
  // e.g. "Presti (ITA)" -> "ITA"
  const m = lastName.match(/\(([A-Za-z]{3})\)\s*$/);
  return m ? normalizeIoc(m[1]) : null;
}

function stripIocFromLastName(lastName: string): string {
  return lastName.replace(/\s*\([A-Za-z]{3}\)\s*$/, "").trim();
}

type ImportPreviewRow = {
  bib: number | null;
  firstName: string;
  lastName: string;
  nation: string | null;
};

type ImportMode = "overwrite" | "merge";

type Props = {
  raceName: string;
  ageGroupLabel: string;
  onImport: (mode: ImportMode, rows: ImportPreviewRow[]) => void;
};

type SkippedRowInfo = {
  csvLineNo: number; // 1-based line number in CSV file (including header)
  row: string[];
  reason: string;
};

export default function RaceStartersImport(props: Props ) {
  const [tab, setTab] = useState<"relevant" | "original">("relevant");
  const [originalMode, setOriginalMode] = useState<"table" | "raw">("table");
  const [dragOver, setDragOver] = useState(false);

  const [encoding, setEncoding] = useState<Encoding>("utf-8");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  async function readFile(file: File) {
    setParseError(null);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const decoder = new TextDecoder(encoding);
      const text = decoder.decode(buf);

      setRawText(text);

      const result = parseDelimited(text, ";");
      if (!result.headers.length) {
        setParsed(null);
        setParseError("CSV scheint leer zu sein (keine Header gefunden).");
        return;
      }
      setParsed(result);
    } catch (e) {
      setParsed(null);
      setRawText("");
      setParseError(e instanceof Error ? e.message : "Unbekannter Fehler beim Einlesen.");
    }
  }

  const headerIndex = useMemo(() => {
    const h = parsed?.headers ?? [];
    const map: Record<string, number> = {};
    h.forEach((name, i) => (map[name.trim()] = i));
    return map;
  }, [parsed]);

  const previewAnalysis = useMemo(() => {
    const result: { importable: ImportPreviewRow[]; skippedEmpty: SkippedRowInfo[] } = {
      importable: [],
      skippedEmpty: [],
    };

    if (!parsed) return result;

    const idxNo = headerIndex["No"];
    const idxFirst = headerIndex["FirstName"];
    const idxLast = headerIndex["LastName"];
    const idxAdditional1 = headerIndex["Additional1"];

    parsed.rows.forEach((r, rowIdx) => {
      const bibRaw = idxNo !== undefined ? (r[idxNo] ?? "") : "";
      const firstRaw = idxFirst !== undefined ? (r[idxFirst] ?? "") : "";
      const lastRaw = idxLast !== undefined ? (r[idxLast] ?? "") : "";
      const iocRaw = idxAdditional1 !== undefined ? (r[idxAdditional1] ?? "") : "";

      const firstName = firstRaw.trim();
      const lastNameWithMaybeIoc = lastRaw.trim();

      const nation = normalizeIoc(iocRaw) ?? extractIocFromLastName(lastNameWithMaybeIoc);
      const lastName = stripIocFromLastName(lastNameWithMaybeIoc);
      const bib = parseBib(bibRaw);

      // "Leere Starter-Zeile": keine Bib + keine Namen + kein IOC (aber z.B. Class kann dennoch gefüllt sein)
      const isEmptyStarterRow = bib === null && firstName === "" && lastName === "" && !nation;

      if (isEmptyStarterRow) {
        result.skippedEmpty.push({
          csvLineNo: rowIdx + 2, // +1 header, +1 because 1-based
          row: r,
          reason: "Leere Starter-Zeile (Bib/FirstName/LastName/Nation leer) – wird nicht importiert",
        });
        return;
      }

      // Alles andere zeigen wir als "importable preview" (auch wenn später evtl. weitere Regeln kommen)
      // (Wenn du hier schon streng sein willst: firstName && lastName als Voraussetzung)
      result.importable.push({
        bib,
        firstName,
        lastName,
        nation,
      });
    });

    return result;
  }, [parsed, headerIndex]);

  const missingHeaderWarning = useMemo(() => {
    if (!parsed) return null;
    const required = ["No", "FirstName", "LastName"];
    const missing = required.filter((h) => headerIndex[h] === undefined);
    return missing.length ? `Fehlende Spalten: ${missing.join(", ")}` : null;
  }, [parsed, headerIndex]);

  const originalRowsTrimmed = useMemo(() => {
    if (!parsed) return [];
    // remove rows that are completely empty across all columns
    return parsed.rows.filter((r) => r.some((cell) => (cell ?? "").trim() !== ""));
  }, [parsed]);

  return (
    <Card variant="outlined">
      <CardHeader
        title="Starter Import (CSV)"
        subheader={
          <Typography variant="caption" color="text.secondary">
            Race: {props.raceName} • AgeGroup: {props.ageGroupLabel}
          </Typography>
        }
      />
      <Divider />

      <CardContent>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="csv-encoding">Encoding</InputLabel>
            <Select
              labelId="csv-encoding"
              value={encoding}
              label="Encoding"
              onChange={(e) => setEncoding(e.target.value as Encoding)}
            >
              <MenuItem value="windows-1252">Windows-1252 (bei “J�ssica” etc.)</MenuItem>
              <MenuItem value="utf-8">UTF-8</MenuItem>
            </Select>
          </FormControl>

          <Button variant="contained" component="label">
            CSV auswählen
            <input
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.currentTarget.value = "";
              }}
            />
          </Button>

          <Button
            variant="outlined"
            disabled={!parsed && !rawText}
            onClick={() => {
              setFileName(null);
              setRawText("");
              setParsed(null);
              setParseError(null);
              setTab("relevant");
              setOriginalMode("table");
            }}
          >
            Reset
          </Button>

          <Typography variant="body2" color="text.secondary">
            {fileName ? `Datei: ${fileName}` : "Keine Datei geladen"}
          </Typography>
        </Box>

        <Box
          sx={{
            mt: 2,
            p: 2,
            border: "2px dashed",
            borderColor: dragOver ? "primary.main" : "divider",
            borderRadius: 1,
            bgcolor: dragOver ? "action.hover" : "transparent",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void readFile(f);
          }}
        >
          <Typography variant="body2">CSV hierher ziehen & ablegen (Drag & Drop)</Typography>
          <Typography variant="caption" color="text.secondary">
            Erwartetes Format wie in:{" "}
            <code>examples/Cadets_ladies_4_8_000_m_Elimination_1F_F01_Final_A_8K.csv</code>
          </Typography>
        </Box>

        {parseError ? (
          <Alert sx={{ mt: 2 }} severity="error">
            {parseError}
          </Alert>
        ) : null}

        {missingHeaderWarning ? (
          <Alert sx={{ mt: 2 }} severity="warning">
            {missingHeaderWarning}
          </Alert>
        ) : null}

        {parsed ? (
          <Box sx={{ mt: 2 }}>
            <ButtonGroup size="small" variant="contained">
              <Button
                disabled={previewAnalysis.importable.length === 0}
                onClick={() => {
                  const ok = window.confirm(
                    `Overwrite: Alle aktuellen Starter werden gelöscht und durch den Import überschrieben.\n\nImportiere ${previewAnalysis.importable.length} Zeile(n)?`
                  );
                  if (ok) props.onImport("overwrite", previewAnalysis.importable);
                }}
              >
                Overwrite
              </Button>

              <Button
                disabled={previewAnalysis.importable.length === 0}
                onClick={() => {
                  const ok = window.confirm(
                    `Merge: Vorhandene Starter werden aktualisiert (Match über Bib, sonst Name+IOC) und neue hinzugefügt.\n\nVerarbeite ${previewAnalysis.importable.length} Zeile(n)?`
                  );
                  if (ok) props.onImport("merge", previewAnalysis.importable);
                }}
              >
                Merge
              </Button>
            </ButtonGroup>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tab value="relevant" label="Import-Preview (relevante Spalten)" />
              <Tab value="original" label="Original (alle Spalten)" />
            </Tabs>

            {tab === "relevant" ? (

              <Box sx={{ mt: 2 }}>
                <Box
                  sx={{
                    display: "flex",
                    gap: 2,
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 1,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Zeilen (Preview): {previewAnalysis.importable.length}
                  </Typography>


                </Box>


                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 100 }}>Bib (No)</TableCell>
                      <TableCell>FirstName</TableCell>
                      <TableCell>LastName</TableCell>
                      <TableCell sx={{ width: 140 }}>Nation (IOC)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewAnalysis.importable.slice(0, 30).map((r, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{r.bib ?? ""}</TableCell>
                        <TableCell>{r.firstName}</TableCell>
                        <TableCell>{r.lastName}</TableCell>
                        <TableCell>{r.nation ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {previewAnalysis.skippedEmpty.length > 0 ? (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="warning">
                      Es wurden {previewAnalysis.skippedEmpty.length} Zeile(n) gefunden, die für den Starter-Import leer sind
                      (Bib/Name/IOC leer). Diese Zeilen werden nicht importiert.
                    </Alert>

                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
                      Originalzeilen (rekonstruiert):
                    </Typography>

                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 110 }}>CSV-Zeile</TableCell>
                          <TableCell>Grund</TableCell>
                          <TableCell>Original</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewAnalysis.skippedEmpty.slice(0, 20).map((x) => (
                          <TableRow key={x.csvLineNo}>
                            <TableCell>{x.csvLineNo}</TableCell>
                            <TableCell>{x.reason}</TableCell>
                            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                              {x.row.join(";")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      Hinweis: Anzeige ist auf die ersten 20 übersprungenen Zeilen begrenzt.
                    </Typography>
                  </Box>
                ) : null}

                <Alert sx={{ mt: 2 }} severity="info">
                  Import-Logik (Übernahme in RaceStarters) ist noch nicht implementiert – sag mir nachher,
                  wie du mappen/mergen willst, dann ergänzen wir Button + Callback.
                </Alert>
              </Box>
            ) : (
              <Box sx={{ mt: 2 }}>
                <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Header-Spalten: {parsed.headers.length} • Zeilen: {originalRowsTrimmed.length}
                  </Typography>

                  <ButtonGroup size="small" variant="outlined">
                    <Button
                      onClick={() => setOriginalMode("table")}
                      variant={originalMode === "table" ? "contained" : "outlined"}
                    >
                      Tabelle
                    </Button>
                    <Button
                      onClick={() => setOriginalMode("raw")}
                      variant={originalMode === "raw" ? "contained" : "outlined"}
                    >
                      Rohtext
                    </Button>
                  </ButtonGroup>
                </Box>

                {originalMode === "table" ? (
                  <Box sx={{ overflowX: "auto" }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {parsed.headers.map((h, i) => (
                            <TableCell key={i} sx={{ whiteSpace: "nowrap" }}>
                              {h}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {originalRowsTrimmed.slice(0, 30).map((row, rIdx) => (
                          <TableRow key={rIdx}>
                            {parsed.headers.map((_, cIdx) => (
                              <TableCell key={cIdx} sx={{ whiteSpace: "nowrap" }}>
                                {row[cIdx] ?? ""}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      Hinweis: Anzeige ist auf die ersten 30 Zeilen begrenzt (UI/Performance).
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    component="pre"
                    sx={{
                      mt: 1,
                      p: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      bgcolor: "background.default",
                      overflow: "auto",
                      maxHeight: 320,
                      whiteSpace: "pre",
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      fontSize: 12,
                    }}
                  >
                    {rawText}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ p: 2, textAlign: "center" }}>
          ... </Box>
        )}
      </CardContent>
    </Card>
  );
}