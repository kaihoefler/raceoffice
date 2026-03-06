import { useMemo, useState } from "react";

import {
  Box,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

import DeleteIcon from "@mui/icons-material/Delete";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";

import type { Athlete } from "../types/athlete";

export type StarterStatus = {
  eliminated?: boolean;
  dns?: boolean;
  dsq?: boolean;
};

type StatusKind = "DSQ" | "DNS" | "ELIM" | null;

type Props = {
  starters: Athlete[];
  /** Bibs that are missing in the live status feed (highlighted in red). */
  missingInLiveBibs?: ReadonlySet<number>;
  /** Athlete IDs that should be highlighted as "selected". */
  selectedIds?: ReadonlySet<string>;

  /** Optional status flags for starters (shown in tile view). */
  statusByBib?: ReadonlyMap<number, StarterStatus>;

  /** Optional points per bib (shown as chip in list view and as short label in tiles). */
  pointsByBib?: ReadonlyMap<number, number>;

  /** Customize how a starter is displayed. */
  formatAthleteLabel?: (a: Athlete) => string;
  /** Optional delete action, shown for starters missing in the live feed. */
  onDeleteStarter?: (starter: Athlete) => void;
  title?: string;
  maxHeight?: number;
};

function defaultAthleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

export default function ScoringStarterList({
  starters,
  missingInLiveBibs,
  selectedIds,
  statusByBib,
  pointsByBib,
  formatAthleteLabel,
  onDeleteStarter,
  title = "Starters",
  maxHeight = 420,
}: Props) {
  const theme = useTheme();

  const labelOf = formatAthleteLabel ?? defaultAthleteLabel;

  const [view, setView] = useState<"tiles" | "list">("tiles");

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

  function pointsLabel(points: number, style: "short" | "long") {
    const p = Math.floor(Number(points));
    if (!Number.isFinite(p) || p === 0) return "";
    if (style === "short") return `${p} Pts`;
    return `${p} ${p === 1 ? "Point" : "Points"}`;
  }

  const statusMetaByBib = useMemo(() => {
    const m = new Map<number, { kind: StatusKind; label: string }>();
    if (!statusByBib) return m;

    for (const [bib, s] of statusByBib.entries()) {
      const parts = [s?.eliminated ? "ELIM" : null, s?.dns ? "DNS" : null, s?.dsq ? "DSQ" : null].filter(
        Boolean,
      ) as string[];
      if (!parts.length) continue;

      // Choose a primary kind for coloring (matches Scoreboard.tsx intent).
      const kind: StatusKind = s?.dsq ? "DSQ" : s?.dns ? "DNS" : s?.eliminated ? "ELIM" : null;

      m.set(bib, { kind, label: parts.join(" ") });
    }

    return m;
  }, [statusByBib]);

  const orderedStarters = useMemo(() => {
    // Desired grouping (first -> last): normal, ELIM, DSQ, DNS
    const priority: Record<Exclude<StatusKind, null> | "NONE", number> = {
      NONE: 0,
      ELIM: 1,
      DSQ: 2,
      DNS: 3,
    };

    function kindOfBib(bib: number | null): StatusKind {
      if (bib == null) return null;
      const s = statusByBib?.get(bib);
      if (!s) return null;
      if (s.dsq) return "DSQ";
      if (s.dns) return "DNS";
      if (s.eliminated) return "ELIM";
      return null;
    }

    const list = [...(Array.isArray(starters) ? starters : [])];

    list.sort((a, b) => {
      const ak = kindOfBib(a.bib ?? null) ?? "NONE";
      const bk = kindOfBib(b.bib ?? null) ?? "NONE";
      const ap = priority[ak];
      const bp = priority[bk];
      if (ap !== bp) return ap - bp;

      // within group: bib asc (nulls last)
      const ab = a.bib ?? Number.MAX_SAFE_INTEGER;
      const bb = b.bib ?? Number.MAX_SAFE_INTEGER;
      if (ab !== bb) return ab - bb;

      // stabilize ordering for null/duplicate bibs
      return String(a.id).localeCompare(String(b.id));
    });

    return list;
  }, [starters, statusByBib]);

  return (
    <Box sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5, gap: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => {
              if (v) setView(v);
            }}
            aria-label="Starter list view"
          >
            <ToggleButton value="tiles" aria-label="Tile view">
              <GridViewIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="list" aria-label="List view">
              <ViewListIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>

          <Typography variant="caption" color="text.secondary">
            {starters.length}
          </Typography>
        </Box>
      </Box>

      {starters.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No starters.
        </Typography>
      ) : view === "list" ? (
        <List dense sx={{ maxHeight, overflow: "auto", py: 0 }}>
          {orderedStarters.map((a) => {
            const bib = a.bib ?? null;
            const missing = bib != null && missingInLiveBibs?.has(bib);
            const isSelected = selectedIds?.has(a.id) ?? false;

            const st = bib != null ? statusMetaByBib.get(bib) ?? null : null;
            const c = st?.kind ? statusColor(st.kind) : undefined;

            const pts = bib != null ? (pointsByBib?.get(bib) ?? 0) : 0;
            const ptsText = pts ? pointsLabel(pts, "long") : "";

            return (
              <ListItem
                key={a.id}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  border: missing ? "2px solid" : undefined,
                  borderColor: missing ? "error.main" : undefined,
                  bgcolor: isSelected ? "action.selected" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <ListItemText
                  primary={labelOf(a)}
                  sx={{ minWidth: 0, flex: 1 }}
                  slotProps={{
                    primary: {
                      variant: "body2",
                      sx: missing
                        ? { color: theme.palette.error.main, fontWeight: 700 }
                        : c
                          ? { color: c, fontWeight: 700 }
                          : undefined,
                    },
                  }}
                />

                {st?.label ? (
                  <Chip
                    size="small"
                    label={st.label}
                    variant="outlined"
                    sx={{
                      height: 22,
                      fontWeight: 700,
                      borderColor: c,
                      color: c,
                      "& .MuiChip-label": { px: 0.75 },
                    }}
                  />
                ) : null}

                {ptsText ? (
                  <Chip
                    size="small"
                    label={ptsText}
                    variant="outlined"
                    sx={{
                      height: 22,
                      fontWeight: 700,
                      "& .MuiChip-label": { px: 0.75 },
                    }}
                  />
                ) : null}

                {missing && onDeleteStarter ? (
                  <Tooltip title="Delete starter" arrow>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onDeleteStarter(a)}
                        aria-label={`Delete starter ${bib ?? ""}`.trim()}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
              </ListItem>
            );
          })}
        </List>
      ) : (
        <Box
          sx={{
            maxHeight,
            overflow: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))",
            gap: 0.5,
            pr: 0.25,
          }}
        >
          {orderedStarters.map((a) => {
            const bib = a.bib ?? null;
            const missing = bib != null && missingInLiveBibs?.has(bib);
            const isSelected = selectedIds?.has(a.id) ?? false;

            const st = bib != null ? statusMetaByBib.get(bib) ?? null : null;
            const c = st?.kind ? statusColor(st.kind) : null;

            const pts = bib != null ? (pointsByBib?.get(bib) ?? 0) : 0;
            const ptsText = pts ? pointsLabel(pts, "short") : "";

            return (
              <Box
                key={a.id}
                title={labelOf(a)}
                sx={{
                  p: 0.5,
                  borderRadius: 1,
                  border: "solid",
                  borderWidth: missing ? 2 : 1,
                  // Frame color: match Scoreboard.tsx statusColor
                  borderColor: missing ? theme.palette.error.main : c ? c : "divider",
                  bgcolor: isSelected ? "action.selected" : "background.paper",
                  minHeight: 44,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0.15,
                  userSelect: "none",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, minHeight: 18 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                      fontWeight: 800,
                      color: missing ? "error.main" : "text.primary",
                    }}
                  >
                    {bib ?? "?"}
                  </Typography>

                  {missing && onDeleteStarter ? (
                    <Tooltip title="Delete starter" arrow>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onDeleteStarter(a)}
                          aria-label={`Delete starter ${bib ?? ""}`.trim()}
                          sx={{ p: 0.15 }}
                        >
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : null}
                </Box>

                {st?.label ? (
                  <Typography variant="caption" sx={{ lineHeight: 1, color: c ?? "text.secondary", fontWeight: 700 }}>
                    {st.label}
                  </Typography>
                ) : ptsText ? (
                  <Typography variant="caption" sx={{ lineHeight: 1, color: "text.secondary", fontWeight: 700 }}>
                    {ptsText}
                  </Typography>
                ) : (
                  // keep row height stable
                  <Box sx={{ height: 10 }} />
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
