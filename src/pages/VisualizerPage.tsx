// src/pages/VisualizerPage.tsx
//
// VisualizerPage
// --------------
// Zweck:
// - Render-Startpunkt für die Videowand-Visualisierung
// - Nutzt die aktive FullVisualization + das aktive Event (Layout stellt beides via Outlet context bereit)
// - Zeigt den Titel des aktiven Rennens + eine Tabelle mit RaceResults (wie Scoreboard "With Result")

import { useMemo } from "react";

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
import type { VisualizationOutletContext } from "../ui/VisualizationLayout";

type StatusKind = "DSQ" | "DNS" | "ELIM" | null;

function getStatus(r: RaceResult): { kind: StatusKind; label: string | null } {
  if (r.dsq) return { kind: "DSQ", label: "DSQ" };
  if (r.dns) return { kind: "DNS", label: "DNS" };
  if (r.eliminated) return { kind: "ELIM", label: `Elim (${r.eliminationLap ?? 0})` };
  return { kind: null, label: null };
}

function hasDisplayResult(r: RaceResult): boolean {
  const hasPoints = typeof r.points === "number" && r.points !== 0;
  const hasFinish = (r.finishRank ?? 0) > 0;
  return Boolean(r.dsq || r.eliminated || hasFinish || hasPoints);
}

function athleteName(a: Athlete | null | undefined): string {
  if (!a) return "";
  return `${String(a.lastName ?? "").trim()} ${String(a.firstName ?? "").trim()}`.trim();
}

export default function VisualizerPage() {
  const theme = useTheme();
  const { visualization, event } = useOutletContext<VisualizationOutletContext>();

  const backgroundColor = visualization?.backgroundColor ?? "#000000";
  const fontSize = visualization?.fontSize ?? "16px";
  const fontColor = visualization?.fontColor ?? "#ffffff";

  const activeRace: Race | null = useMemo(() => {
    if (!event?.activeRaceId) return null;
    const races = Array.isArray(event.races) ? event.races : [];
    return races.find((r) => r.id === event.activeRaceId) ?? null;
  }, [event?.activeRaceId, event?.races]);

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

  const rows = useMemo(() => {
    const base = Array.isArray(activeRace?.raceResults) ? activeRace.raceResults : [];

    // Scoreboard "With Result" rules:
    // - DNS never shown
    // - only entries with a display result
    const filtered = base.filter((r) => {
      if (r.dns) return false;
      return hasDisplayResult(r);
    });

    const list = [...filtered];

    list.sort((a, b) => {
      const ra = a.rank > 0 ? a.rank : Number.POSITIVE_INFINITY;
      const rb = b.rank > 0 ? b.rank : Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return (a.bib ?? 0) - (b.bib ?? 0);
    });

    return list.map((r) => {
      const a = starterByBib.get(r.bib);
      return {
        bib: r.bib,
        rank: r.rank,
        points: r.points,
        status: getStatus(r),
        name: athleteName(a),
      };
    });
  }, [activeRace?.raceResults, starterByBib]);

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
        display: "flex",
        flexDirection: "column",
        p: 4,
        gap: 2,
        boxSizing: "border-box",
      }}
    >
      {/* Title */}
      <Typography component="div" sx={{ fontSize: "1.6em", fontWeight: 800, color: "inherit" }}>
        {activeRace?.name ? activeRace.name : "No active race"}
      </Typography>

      {/* Table */}
      <TableContainer sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Table
          size="small"
          stickyHeader
          sx={{
            "& th, & td": {
              px: { xs: 0.75, sm: 1 },
              py: 0.6,
              fontSize: "1em",
              color: "inherit",
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
              <TableCell sx={{ width: 80 }}>Rank</TableCell>
              <TableCell sx={{ width: 90 }}>Bib</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right" sx={{ width: 160 }}>
                Points
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((r) => {
              const c = statusColor(r.status.kind);
              const isStatus = Boolean(r.status.kind);

              return (
                <TableRow
                  key={r.bib}
                  sx={
                    isStatus
                      ? {
                          "& td": {
                            color: c,
                          },
                        }
                      : undefined
                  }
                >
                  <TableCell>{r.rank > 0 ? r.rank : "-"}</TableCell>
                  <TableCell>{r.bib}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{r.name}</TableCell>

                  <TableCell align="right">
                    {r.status.kind === "ELIM" || r.status.kind === "DSQ" ? (
                      // For eliminations/DSQ: no chip, render plain text in the same typography as the table.
                      <Box component="span" sx={{ color: c, fontWeight: 800 }}>
                        {r.status.label}
                      </Box>
                    ) : r.status.kind ? (
                      <Chip
                        size="small"
                        label={r.status.label}
                        variant="outlined"
                        sx={{
                          color: c,
                          borderColor: c,
                          backgroundColor: alpha(c, 0.10),
                          fontWeight: 800,
                        }}
                      />
                    ) : (
                      r.points ?? 0
                    )}
                  </TableCell>
                </TableRow>
              );
            })}

            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography sx={{ color: alpha(fontColor, 0.8) }}>
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
