// src/components/Scoreboard.tsx
//
// Scoreboard: tabellarische Darstellung von RaceResult-Einträgen.
//
// Features:
// - 2 Anzeigemodi (umschaltbar im Header):
//   - "All": zeigt alle Einträge außer DNS
//   - "With Result": zeigt nur Einträge mit verwertbarem Result (Punkte/Finish/ELIM/DSQ), ebenfalls ohne DNS
// - Sortierung: rank aufsteigend (rank > 0 zuerst), danach ungerankte (rank = 0) nach bib
// - Statusdarstellung (DSQ/DNS/ELIM) ersetzt Points+Finish durch ein Chip-Label
// - Optional scrollbarer Container via maxHeight

import { useMemo, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import RefreshIcon from "@mui/icons-material/Refresh";

import type { RaceResult } from "../types/race";

type Props = {
  /** Liste der Ergebnisse für das Rennen. */
  results: RaceResult[];
  /** Titel im Header (Default: "Standings"). */
  title?: string;
  /**
   * Wenn gesetzt, wird die Tabelle innerhalb dieser maximalen Höhe scrollbar.
   * (Realisiert über maxHeight + overflow:auto im TableContainer)
   */
  maxHeight?: number;
  /** Optional action to force a full results recomputation. */
  onRecalculateResults?: () => void;
};

/**
 * Status-Typen, die in der Tabelle gesondert dargestellt werden.
 * Hinweis: DNS wird zwar erkannt, aber DNS-Zeilen werden in beiden Modi ausgefiltert (siehe rows-Memo).
 */
type StatusKind = "DSQ" | "DNS" | "ELIM" | null;

/**
 * Ermittelt den Status eines RaceResult:
 * - DSQ / DNS / ELIM => liefert Kind + Label
 * - sonst => null
 */
function getStatus(r: RaceResult): { kind: StatusKind; label: string | null } {
  if (r.dsq) return { kind: "DSQ", label: "DSQ" };
  if (r.dns) return { kind: "DNS", label: "DNS" };
  if (r.eliminated) return { kind: "ELIM", label: `Elim (${r.eliminationLap ?? 0})` };
  return { kind: null, label: null };
}

/**
 * Anzeige-Modus der Tabelle.
 * - all: alle Einträge (außer DNS)
 * - withResult: nur Einträge mit "verwertbarem" Ergebnis (außer DNS)
 */
type DisplayMode = "all" | "withResult";

/**
 * Definition für "With Result":
 * Ein Fahrer gilt als "hat Result", wenn mindestens eines gilt:
 * - DSQ
 * - eliminated
 * - finishRank > 0
 * - points != 0
 *
 * DNS wird separat behandelt und niemals angezeigt.
 */
function hasDisplayResult(r: RaceResult): boolean {
  const hasPoints = typeof r.points === "number" && r.points !== 0;
  const hasFinish = (r.finishRank ?? 0) > 0;
  return Boolean(r.dsq || r.eliminated || hasFinish || hasPoints);
}

export default function Scoreboard({
  results,
  title = "Standings",
  maxHeight = 900,
  onRecalculateResults,
}: Props) {
  const theme = useTheme();

  /**
   * Default-Modus:
   * - "withResult" ist im Live-Scoring meist hilfreicher, weil leere/noch-nicht-gewertete Einträge ausgeblendet werden.
   * - kann natürlich auf "all" geändert werden.
   */
  const [mode, setMode] = useState<DisplayMode>("withResult");

  /**
   * Gesamtanzahl aller Einträge, die NICHT DNS sind.
   * Wird für die "x / y"-Anzeige im "With Result"-Modus genutzt.
   */
  const totalNonDns = useMemo(() => {
    return (Array.isArray(results) ? results : []).filter((r) => !r.dns).length;
  }, [results]);

  /**
   * rows = gefilterte + sortierte Anzeige-Liste.
   *
   * Filterregeln:
   * - DNS wird niemals angezeigt
   * - "all": zeigt alle verbleibenden
   * - "withResult": zeigt nur hasDisplayResult(...)
   *
   * Sortierung:
   * - rank > 0 zuerst (aufsteigend)
   * - rank == 0 (unranked) ans Ende
   * - tie-breaker: bib aufsteigend
   */
  const rows = useMemo(() => {
    const base = Array.isArray(results) ? results : [];

    const filtered = base.filter((r) => {
      if (r.dns) return false; // DNS Sportler werden nie angezeigt
      if (mode === "all") return true;
      return hasDisplayResult(r);
    });

    const list = [...filtered];

    list.sort((a, b) => {
      const ra = a.rank > 0 ? a.rank : Number.POSITIVE_INFINITY;
      const rb = b.rank > 0 ? b.rank : Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return (a.bib ?? 0) - (b.bib ?? 0);
    });

    return list;
  }, [results, mode]);

  /**
   * Text-/Chip-Farbe für Statuszeilen.
   * - DNS: grau (wird i.d.R. nicht gerendert, weil vorher gefiltert)
   * - DSQ/ELIM: rot-Töne
   * - default: normale Textfarbe
   */
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
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minWidth: 0 }}>
      {/* Header: Titel + Mode-Umschalter + Count */}
            <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 0.5, flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          {/* Neu-Berechnung der Ergebnisse (optional, vom Parent gesteuert) */}
          {onRecalculateResults ? (
            <Tooltip title="Recalculate results" arrow>
              <span>
                <IconButton
                  size="small"
                  onClick={onRecalculateResults}
                  aria-label="Recalculate results"
                  sx={{ p: 0.5 }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}

          {/* Umschalten zwischen "All" und "With Result" */}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, next) => {
              // ToggleButtonGroup liefert bei "deselect" null; wir verhindern das und behalten den aktuellen Modus.
              if (next) setMode(next);
            }}
            aria-label="scoreboard display mode"
            sx={{
              "& .MuiToggleButton-root": {
                px: 0.75,
                py: 0.25,
                fontSize: 12,
              },
            }}
          >
            <ToggleButton value="all" aria-label="all results">
              All
            </ToggleButton>
            <ToggleButton value="withResult" aria-label="only with result">
              With Result
            </ToggleButton>
          </ToggleButtonGroup>


          {/* Anzahl: im WithResult-Modus als "gefiltert / gesamt(ohne DNS)" */}
          <Typography variant="caption" color="text.secondary">
            {mode === "withResult" ? `${rows.length} / ${totalNonDns}` : rows.length}
          </Typography>
        </Box>
      </Box>

      {/* Body */}
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No results.
        </Typography>
      ) : (
        /**
         * Scroll-Verhalten:
         * - maxHeight begrenzt die Höhe (Default 900)
         * - overflow:auto zeigt Scrollbar bei Bedarf
         */
        <TableContainer sx={{ maxHeight, overflow: "auto" }}>
          <Table
            size="small"
            stickyHeader
            aria-label="scoreboard"
                        sx={{
              // More compact cell padding (important for smaller screens)
              "& th, & td": {
                px: { xs: 0.5, sm: 1 },
                py: 0.5,
              },
            }}

          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Place</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>BIB</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Points
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Finish
                </TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {rows.map((r) => {
                const st = getStatus(r);
                const c = statusColor(st.kind);

                return (
                  <TableRow
                    key={r.bib}
                    hover
                    sx={
                      // Bei Statuszeilen färben wir die komplette Zeile ein
                      st.kind
                        ? {
                            "& td": { color: c },
                          }
                        : undefined
                    }
                  >
                    <TableCell>{r.rank > 0 ? r.rank : "-"}</TableCell>
                    <TableCell>{r.bib}</TableCell>

                    {st.kind ? (
                      /**
                       * Statusdarstellung:
                       * Statt Points + Finish zeigen wir ein Chip-Label, das beide Spalten belegt (colSpan=2).
                       */
                      <TableCell colSpan={2} align="right">
                        <Chip
                          size="small"
                          label={st.label}
                          variant="outlined"
                          sx={{
                            color: c,
                            borderColor: c,
                            backgroundColor: alpha(c, 0.10),
                            fontWeight: 700,
                          }}
                        />
                      </TableCell>
                    ) : (
                      /**
                       * Normaldarstellung:
                       * - Points: default 0 falls null/undefined
                       * - Finish: '-' wenn finishRank <= 0
                       */
                      <>
                        <TableCell align="right">{r.points ?? 0}</TableCell>
                        <TableCell align="right">{r.finishRank > 0 ? r.finishRank : "-"}</TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}