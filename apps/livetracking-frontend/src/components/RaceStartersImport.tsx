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
import {
  analyzeStarterImportCsv,
  parseDelimitedText,
  type CsvParseResult,
  type StarterImportRow,
} from "@raceoffice/domain";


type Encoding = "utf-8" | "windows-1252";



type ImportPreviewRow = StarterImportRow;


type ImportMode = "replace" | "merge";

type Props = {
  raceName: string;
  ageGroupLabel: string;
  onImport: (mode: ImportMode, rows: ImportPreviewRow[]) => void | Promise<void>;
};



export default function RaceStartersImport(props: Props ) {
  const [tab, setTab] = useState<"relevant" | "original">("relevant");
  const [originalMode, setOriginalMode] = useState<"table" | "raw">("table");
  const [dragOver, setDragOver] = useState(false);

  const [encoding, setEncoding] = useState<Encoding>("windows-1252");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function resetImporter() {
    setFileName(null);
    setRawText("");
    setParsed(null);
    setParseError(null);
    setTab("relevant");
    setOriginalMode("table");
    setDragOver(false);
  }

  const handleImport = async (mode: ImportMode) => {
    if (previewAnalysis.importable.length === 0) return;

    const msg =
            mode === "replace"
        ? `Replace: Alle aktuellen Starter werden gelöscht und durch den Import ersetzt.\n\nImportiere ${previewAnalysis.importable.length} Zeile(n)?`
        : `Merge: Vorhandene Starter werden aktualisiert (Match über Bib, sonst Name+IOC) und neue hinzugefügt.\n\nVerarbeite ${previewAnalysis.importable.length} Zeile(n)?`;

    const ok = window.confirm(msg);
    if (!ok) return;

    try {
      await props.onImport(mode, previewAnalysis.importable);
      // "erfolgreich" => kein Throw / keine Promise-Rejection
      resetImporter();
    } catch (e) {
      // optional: keine Reset, damit User Daten nicht verliert
      const m = e instanceof Error ? e.message : "Unbekannter Fehler beim Import.";
      window.alert(m);
    }
  };

  async function readFile(file: File) {
    setParseError(null);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const decoder = new TextDecoder(encoding);
      const text = decoder.decode(buf);

      setRawText(text);

            const result = parseDelimitedText(text, ";");

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

    const previewAnalysis = useMemo(() => {
    if (!parsed) {
      return {
        importable: [] as ImportPreviewRow[],
        skippedEmpty: [],
        missingRequiredHeaders: [],
      };
    }

    return analyzeStarterImportCsv(parsed);
  }, [parsed]);

  const missingHeaderWarning = useMemo(() => {
    if (!parsed) return null;
    return previewAnalysis.missingRequiredHeaders.length
      ? `Fehlende Spalten: ${previewAnalysis.missingRequiredHeaders.join(", ")}`
      : null;
  }, [parsed, previewAnalysis]);


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
              <MenuItem value="windows-1252">Windows-1252 (ANSI)</MenuItem>
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
            onClick={resetImporter}
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Import:
              </Typography>

              <Button
                size="small"
                variant="contained"
                disabled={previewAnalysis.importable.length === 0}
                                onClick={() => void handleImport("replace")}
              >
                Replace
              </Button>

              <Button
                size="small"
                variant="contained"
                disabled={previewAnalysis.importable.length === 0}
                onClick={() => void handleImport("merge")}
              >
                Merge
              </Button>
            </Box>
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
                      <TableCell>Transponder IDs</TableCell>
                    </TableRow>

                  </TableHead>
                  <TableBody>
                    {previewAnalysis.importable.slice(0, 30).map((r, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{r.bib ?? ""}</TableCell>
                        <TableCell>{r.firstName}</TableCell>
                        <TableCell>{r.lastName}</TableCell>
                        <TableCell>{r.nation ?? ""}</TableCell>
                        <TableCell>{(r.transponderIds ?? []).join(", ")}</TableCell>

                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {previewAnalysis.skippedEmpty.length > 0 ? (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="warning">
                      Es wurden {previewAnalysis.skippedEmpty.length} Zeile(n) gefunden, die für den Starter-Import leer sind
                                            (Bib/Name/IOC/Transponder leer). Diese Zeilen werden nicht importiert.

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
           </Box>
        )}
      </CardContent>
    </Card>
  );
}