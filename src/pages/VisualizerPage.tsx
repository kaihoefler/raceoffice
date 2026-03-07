// src/pages/VisualizerPage.tsx
//
// VisualizerPage
// --------------
// Zweck:
// - Render-Startpunkt für die Videowand-Visualisierung
// - Nutzt die aktive FullVisualization + das aktive Event (Layout stellt beides via Outlet context bereit)
// - Zeigt den Titel des aktiven Rennens + eine Tabelle mit RaceResults (wie Scoreboard "With Result")

import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";

import { useOutletContext } from "react-router-dom";

import type { Athlete } from "../types/athlete";
import type { Race, RaceResult } from "../types/race";
import type { VisualizationColumn } from "../types/visualization";
import type { VisualizationOutletContext } from "../ui/VisualizationLayout";

// Alle verfügbaren Flaggen-SVGs einmalig laden.
// Der Dateiname (z. B. "GER.svg") dient als Nation-Code.
const flagModules = import.meta.glob("../assets/flags/*.svg", {
  eager: true,
  import: "default",
}) as Record<string, string>;

// Mapping Nation-Code -> URL der Flagge.
const flagByNation = Object.fromEntries(
  Object.entries(flagModules).map(([path, url]) => {
    const match = path.match(/\/([A-Za-z0-9_-]+)\.svg$/);
    const code = match?.[1]?.toUpperCase() ?? "";
    return [code, url];
  }),
) as Record<string, string>;

type StatusKind = "DSQ" | "DNS" | "ELIM" | null;

// Interner Zeilentyp für die Tabellenansicht:
// - "result": normale Ergebniszeile
// - "skippedIndicator": Platzhalterzeile "..." für ausgeblendete Fahrer ohne Resultat
type ResultRow = {
  kind: "result";
  key: number;
  result: RaceResult;
  athlete: Athlete | null;
  bib: number;
  rank: number;
  points: number;
  status: { kind: StatusKind; label: string | null };
  name: string;
};

type SkippedRowsIndicatorRow = {
  kind: "skippedIndicator";
  key: string;
};

type VisualizerRow = ResultRow | SkippedRowsIndicatorRow;

// Leitet aus einem RaceResult den darzustellenden Status ab.
function getStatus(r: RaceResult): { kind: StatusKind; label: string | null } {
  if (r.dsq) return { kind: "DSQ", label: "DSQ" };
  if (r.dns) return { kind: "DNS", label: "DNS" };
  if (r.eliminated) return { kind: "ELIM", label: `Elim (${r.eliminationLap ?? 0})` };
  return { kind: null, label: null };
}

// Entspricht der bisherigen "With Result"-Logik:
// angezeigt werden nur Einträge mit relevantem Resultat.
function hasDisplayResult(r: RaceResult): boolean {
  const hasPoints = typeof r.points === "number" && r.points !== 0;
  const hasFinish = (r.finishRank ?? 0) > 0;
  return Boolean(r.dsq || r.eliminated || hasFinish || hasPoints);
}

// Standard-Namensdarstellung für die Fallback-/Standardansicht.
function athleteName(a: Athlete | null | undefined): string {
  if (!a) return "";
  return `${String(a.lastName ?? "").trim()} ${String(a.firstName ?? "").trim()}`.trim();
}

// Primitive Werte für Template-Platzhalter in String umwandeln.
function templateValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}


// Reproduziert das Verhalten der bisherigen Standard-Result-Spalte.
// - DSQ immer als hervorgehobener Status
// - ELIM nur bei Elimination-Rennen als hervorgehobener Status
// - DNS als Chip
// - bei Punkte-Rennen: Punkte
// - sonst: Zielzeit
function renderDynamicResultNode(
  result: RaceResult,
  isPointsRace: boolean,
  isEliminationRace: boolean,
  statusColorValue: string,
): ReactNode {
  const status = getStatus(result);

  if (status.kind === "DSQ") {
    return (
      <Box component="span" sx={{ color: statusColorValue, fontWeight: 800 }}>
        {status.label}
      </Box>
    );
  }

  if (status.kind === "ELIM") {
    if (!isEliminationRace) return "";

    return (
      <Box component="span" sx={{ color: statusColorValue, fontWeight: 800 }}>
        {status.label}
      </Box>
    );
  }

  if (status.kind) {
    return (
      <Chip
        size="small"
        label={status.label}
        variant="outlined"
        sx={{
          color: statusColorValue,
          borderColor: statusColorValue,
          backgroundColor: alpha(statusColorValue, 0.10),
          fontWeight: 800,
        }}
      />
    );
  }

  if (isPointsRace) {
    return result.points ?? 0;
  }

  return String(result.finishTime ?? "").trim();
}

// Rendert einen einzelnen Platzhalter als ReactNode.
// Spezialfall: {{athlete.nation}} wird – wenn möglich – als Flagge dargestellt.
function renderPlaceholderNode(
  source: "result" | "athlete",
  key: string,
  result: RaceResult,
  athlete: Athlete | null,
  reactKey: string,
): ReactNode {
  if (source === "athlete" && key === "nation") {
    const nation = String(athlete?.nation ?? "").trim().toUpperCase();
    const flagUrl = nation ? flagByNation[nation] : "";

    if (flagUrl) {
      return (
        <Box
          key={reactKey}
          component="img"
          src={flagUrl}
          alt={nation}
          sx={{
            height: "1.2em",
            width: "auto",
            maxWidth: "2em",
            display: "inline-block",
            verticalAlign: "middle",
          }}
        />
      );
    }
  }

  const obj = source === "result" ? (result as Record<string, unknown>) : ((athlete ?? {}) as Record<string, unknown>);
  return templateValueToString(obj[key]);
}

// Rendert eine frei konfigurierte Column.
// Unterstützt Mischinhalte aus Text, Platzhaltern, Flaggen und {{dynamicResult}}.
function resolveColumnNode(
  column: VisualizationColumn,
  result: RaceResult,
  athlete: Athlete | null,
  isPointsRace: boolean,
  isEliminationRace: boolean,
  statusColorValue: string,
): ReactNode {
  const template = String(column.columnContent ?? "");
  const regex = /{{\s*(dynamicResult|(result|athlete)\.([a-zA-Z0-9_]+))\s*}}/g;
  const parts: ReactNode[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push(template.slice(lastIndex, match.index));
    }

    if (match[1] === "dynamicResult") {
      parts.push(renderDynamicResultNode(result, isPointsRace, isEliminationRace, statusColorValue));
    } else {
      parts.push(
        renderPlaceholderNode(match[2] as "result" | "athlete", match[3], result, athlete, `${match[2]}-${match[3]}-${match.index}`),
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < template.length) {
    parts.push(template.slice(lastIndex));
  }

  const hasMeaningfulContent = parts.some((part) => {
    if (typeof part === "string") return part.trim().length > 0;
    return part != null && part !== false;
  });

  if (!hasMeaningfulContent) {
    return String(column.columnFallback ?? "").trim();
  }

  return <>{parts}</>;
}

export default function VisualizerPage() {
  // Theme wird für Statusfarben und Alpha-Blending verwendet.
  const theme = useTheme();
  const { visualization, event } = useOutletContext<VisualizationOutletContext>();

  const backgroundColor = visualization?.backgroundColor ?? "#000000";
  const alternateRowBackgroundColor = String(visualization?.alternateRowBackgroundColor ?? "").trim();
  const fontSize = visualization?.fontSize ?? "16px";
  const fontWeight = String(visualization?.fontWeight ?? "400").trim() || "400";
  const fontColor = visualization?.fontColor ?? "#ffffff";
  // Optionales UI-Feature: zeigt "..." für ausgelassene Fahrer ohne Resultat.
  const showSkippedRowsIndicator = Boolean(visualization?.showSkippedRowsIndicator);

  // Aktives Rennen aus dem aktuell geladenen Event bestimmen.
  const activeRace: Race | null = useMemo(() => {
    if (!event?.activeRaceId) return null;
    const races = Array.isArray(event.races) ? event.races : [];
    return races.find((r) => r.id === event.activeRaceId) ?? null;
  }, [event?.activeRaceId, event?.races]);

  // Lookup-Tabelle Bib -> Athlete.
  // Zuerst Race-Starters, danach Fallback auf Event-Athleten.
  const starterByBib = useMemo(() => {
    const m = new Map<number, Athlete>();
    const starters = Array.isArray(activeRace?.raceStarters) ? activeRace.raceStarters : [];
    for (const a of starters) {
      const bib = a?.bib;
      if (typeof bib === "number") m.set(bib, a);
    }

    // Fallback: also index event athletes (if available)
    const athletes = Array.isArray(event?.athletes) ? event!.athletes : [];
    for (const a of athletes) {
      const bib = a?.bib;
      if (typeof bib === "number" && !m.has(bib)) m.set(bib, a);
    }

    return m;
  }, [activeRace?.raceStarters, event?.athletes]);

  // Sichtbare Tabellenzeilen in Anzeige-Reihenfolge vorbereiten.
  //
  // Wichtige Regeln:
  // 1) DNS wird nie angezeigt und erzeugt auch nie eine "..."-Zeile.
  // 2) Fahrer ohne anzeigbares Resultat werden ausgeblendet.
  // 3) Für zusammenhängende Blöcke solcher ausgeblendeten Fahrer kann optional
  //    eine einzelne "..."-Zeile eingefügt werden (showSkippedRowsIndicator).
  const rows = useMemo<VisualizerRow[]>(() => {
    const base = Array.isArray(activeRace?.raceResults) ? activeRace.raceResults : [];

    // Scoreboard "With Result" rules:
    // - DNS never shown
    // - only entries with a display result
    const sorted = [...base].sort((a, b) => {
      const ra = a.rank > 0 ? a.rank : Number.POSITIVE_INFINITY;
      const rb = b.rank > 0 ? b.rank : Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return (a.bib ?? 0) - (b.bib ?? 0);
    });

    const mapped: VisualizerRow[] = [];
    let skippedRunCount = 0;

    for (const result of sorted) {
      // DNS: komplett ignorieren (keine Anzeige, kein "..."-Trigger).
      if (result.dns) continue;

      // Ohne Resultat wird die Zeile ausgelassen; wir zählen nur den aktuellen Skip-Block.
      if (!hasDisplayResult(result)) {
        if (showSkippedRowsIndicator) skippedRunCount += 1;
        continue;
      }

      // Sobald nach einem Skip-Block wieder eine sichtbare Zeile kommt,
      // wird genau eine "..."-Zeile davor eingefügt.
      if (showSkippedRowsIndicator && skippedRunCount > 0) {
        mapped.push({ kind: "skippedIndicator", key: `skipped-rows-indicator-${mapped.length}` });
        skippedRunCount = 0;
      }

      const athlete = starterByBib.get(result.bib) ?? null;
      mapped.push({
        kind: "result",
        key: result.bib,
        result,
        athlete,
        bib: result.bib,
        rank: result.rank,
        points: result.points,
        status: getStatus(result),
        name: athleteName(athlete),
    });
    }

    // Falls der letzte Block der sortierten Liste nur aus "skipped" besteht,
    // kommt der Indicator ans Ende (DNS wurde bereits vorher ausgeschlossen).
    if (showSkippedRowsIndicator && skippedRunCount > 0) {
      mapped.push({ kind: "skippedIndicator", key: `skipped-rows-indicator-${mapped.length}` });
    }

    return mapped;
  }, [activeRace?.raceResults, starterByBib, showSkippedRowsIndicator]);

  // Nur tatsächlich konfigurierte dynamische Spalten verwenden.
  const dynamicColumns = useMemo(() => {
    const cols = Array.isArray(visualization?.columns) ? visualization.columns : [];
    return cols.filter((col): col is VisualizationColumn => {
      return Boolean(String(col?.columnTitle ?? "").trim() || String(col?.columnContent ?? "").trim());
    });
  }, [visualization?.columns]);

  // Wenn Columns definiert sind, wird die Standardansicht ersetzt.
  const useDynamicColumns = dynamicColumns.length > 0;
  const isPointsRace = Boolean(activeRace?.racemode?.isPointsRace);
  const isEliminationRace = Boolean(activeRace?.racemode?.isEliminationRace);
  const pagingEnabledByConfig = Boolean(visualization?.usePaging);
  const pagingLines = Math.max(1, Math.floor(Number(visualization?.pagingLines ?? 10) || 10));
  const pagingTime = Math.max(0, Math.floor(Number(visualization?.pagingTime ?? 0) || 0));

  const totalPages = useMemo(() => {
    if (!pagingEnabledByConfig) return 1;
    return Math.max(1, Math.ceil(rows.length / pagingLines));
  }, [pagingEnabledByConfig, rows.length, pagingLines]);

  const [autoPagingRunning, setAutoPagingRunning] = useState(pagingEnabledByConfig && pagingTime > 0);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    setAutoPagingRunning(pagingEnabledByConfig && pagingTime > 0);
    setCurrentPage(0);
  }, [pagingEnabledByConfig, pagingTime, activeRace?.id]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  useEffect(() => {
    if (!pagingEnabledByConfig) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter") {
        event.preventDefault();
        setAutoPagingRunning((prev) => !prev);
        return;
      }

      if (totalPages <= 1) return;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setCurrentPage((prev) => (prev + 1) % totalPages);
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setCurrentPage((prev) => (prev - 1 + totalPages) % totalPages);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pagingEnabledByConfig, totalPages]);

  useEffect(() => {
    if (!pagingEnabledByConfig || !autoPagingRunning || pagingTime <= 0 || totalPages <= 1) return undefined;

    const intervalId = window.setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % totalPages);
    }, pagingTime * 1000);

    return () => window.clearInterval(intervalId);
  }, [pagingEnabledByConfig, autoPagingRunning, pagingTime, totalPages]);

  const visibleRows = useMemo(() => {
    if (!pagingEnabledByConfig) return rows;

    const start = currentPage * pagingLines;
    return rows.slice(start, start + pagingLines);
  }, [pagingEnabledByConfig, rows, currentPage, pagingLines]);

  // Farbwahl für Status-Zeilen.
  function statusColor(kind: StatusKind): string {
    switch (kind) {
      case "DNS":
        return theme.palette.text.secondary;
      case "DSQ":
        return theme.palette.error.dark;
      case "ELIM":
        return theme.palette.error.main;
      default:
        return theme.palette.text.primary;
    }
  }

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        bgcolor: backgroundColor,
        color: fontColor,
        fontSize,
        fontWeight,
        display: "flex",
        flexDirection: "column",
        px: 6,
        py: 4,
        gap: 2,
        boxSizing: "border-box",
      }}
    >
      {/* Title + dezente Seitenanzeige oben rechts */}
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
        <Typography component="div" sx={{ fontSize: "1.6em", fontWeight: 800, color: "inherit" }}>
          {activeRace?.name ? activeRace.name : "No active race"}
        </Typography>

        {pagingEnabledByConfig ? (
          <Typography
            component="div"
            sx={{
              fontSize: "0.9em",
              fontWeight: "inherit",
              color: alpha(fontColor, 0.65),
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            {!autoPagingRunning && pagingTime > 0 ? "⏸ " : null}
            {Math.min(currentPage + 1, totalPages)} / {totalPages}
          </Typography>
        ) : null}
      </Box>

      {/* Ergebnistabelle */}
      <TableContainer sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Table
          size="small"
          stickyHeader
          sx={{
            "& th, & td": {
              px: { xs: 0.75, sm: 1 },
              py: 0.6,
              fontSize: "1em",
              fontWeight,
              color: "inherit",
            },
            "& .MuiTableBody-root .MuiTableCell-root": {
              borderBottom: "none",
            },
            // Make sticky header opaque; otherwise scrolled rows can visually "bleed" through.
            "& .MuiTableCell-stickyHeader": {
              fontWeight: 800,
              bgcolor: alpha(backgroundColor, 0.98),
              borderBottom: `1px solid ${alpha(fontColor, 0.20)}`,
              zIndex: 2,
            },
          }}
        >
          <TableHead>
            <TableRow>
              {useDynamicColumns ? (
                // Konfigurierbare Header-Zeile aus Visualization.columns
                dynamicColumns.map((col, idx) => (
                  <TableCell key={`${col.columnTitle}-${idx}`} align={col.columnAlign} sx={{ width: col.columnWidth || undefined }}>
                    {col.columnTitle || " "}
                  </TableCell>
                ))
              ) : (
                // Bisherige Standardansicht ohne konfigurierte Columns
                <>
                  <TableCell sx={{ width: 80 }}>Rank</TableCell>
                  <TableCell sx={{ width: 90 }}>Bib</TableCell>
                  <TableCell align="center" sx={{ width: 70 }}>
                    Nat
                  </TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right" sx={{ width: 200 }}>
                    {isPointsRace ? "Points" : "Result"}
                  </TableCell>
                </>
              )}
            </TableRow>
          </TableHead>

          <TableBody>
            {visibleRows.map((r, idx) => {
              const rowBg = alternateRowBackgroundColor && idx % 2 === 1 ? alternateRowBackgroundColor : undefined;

              // Platzhalterzeile für ausgelassene Fahrer ohne anzeigbares Resultat.
              if (r.kind === "skippedIndicator") {
                return (
                  <TableRow
                    key={r.key}
                    sx={
                      rowBg
                        ? {
                            "& .MuiTableCell-root": {
                              backgroundColor: rowBg,
                            },
                          }
                        : undefined
                    }
                  >
                    {useDynamicColumns ? (
                      dynamicColumns.map((col, colIdx) => {
                        // In dynamischen Spalten wird "..." nur in der Rank-Spalte gerendert.
                        const isRankColumn = String(col.columnTitle ?? "").trim().toLowerCase() === "rank";
                        return (
                          <TableCell
                            key={`${r.key}-${colIdx}`}
                            align={col.columnAlign}
                            sx={{ whiteSpace: "nowrap", width: col.columnWidth || undefined }}
                          >
                            {isRankColumn ? "..." : ""}
                          </TableCell>
                        );
                      })
                    ) : (
                      <>
                        <TableCell>...</TableCell>
                        <TableCell />
                        <TableCell align="center" sx={{ width: 70 }} />
                        <TableCell />
                        <TableCell align="right" />
                      </>
                    )}
                  </TableRow>
                );
              }

              // Zeilenweise Statusfarbe und optionale Zebra-Färbung vorbereiten.
              const c = statusColor(r.status.kind);
              const isStatus = Boolean(r.status.kind);

              return (
                <TableRow
                  key={r.key}
                  sx={{
                    ...(rowBg || isStatus
                      ? {
                          "& .MuiTableCell-root": {
                            ...(rowBg ? { backgroundColor: rowBg } : {}),
                            ...(isStatus ? { color: c } : {}),
                          },
                        }
                      : {}),
                  }}
                >
                  {useDynamicColumns ? (
                    // Frei konfigurierte Zellen aus den Column-Definitionen rendern.
                    dynamicColumns.map((col, colIdx) => (
                      <TableCell
                        key={`${r.key}-${colIdx}`}
                        align={col.columnAlign}
                        sx={{ whiteSpace: "nowrap", width: col.columnWidth || undefined }}
                      >
                        {resolveColumnNode(col, r.result, r.athlete, isPointsRace, isEliminationRace, c)}
                      </TableCell>
                    ))
                  ) : (
                    // Standardansicht: Rank, Bib, Nation, Name, Result/Points
                    <>
                      <TableCell>{r.rank > 0 ? r.rank : "-"}</TableCell>
                      <TableCell>{r.bib}</TableCell>
                      <TableCell align="center" sx={{ width: 70 }}>
                        {renderPlaceholderNode("athlete", "nation", r.result, r.athlete, `standard-nation-${r.key}`)}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{r.name}</TableCell>

                      <TableCell align="right">
                        {renderDynamicResultNode(r.result, isPointsRace, isEliminationRace, c)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}

            {/* Leerzustand, wenn nach Filterung keine Resultate anzeigbar sind. */}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={useDynamicColumns ? dynamicColumns.length : 5}>
                  <Typography sx={{ fontWeight: "inherit", color: alpha(fontColor, 0.8) }}>
                    No results (with result).
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
