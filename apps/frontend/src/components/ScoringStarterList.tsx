import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

import type { Athlete } from "@raceoffice/domain";

export type StarterStatus = {
  dnf?: false | "dnf" | "elimination";
  dns?: boolean;
  dsq?: boolean;
};

type StatusKind = "DSQ" | "DNS" | "DNF" | "ELIM" | null;

type Props = {
  starters: Athlete[];
  /** Bibs that are missing in the live status feed (highlighted in red). */
  missingInLiveBibs?: ReadonlySet<number>;
  /** Athlete IDs that should be highlighted as "selected". */
  selectedIds?: ReadonlySet<string>;
  /** Bibs that are not selectable for scoring actions (DNS/DSQ/DNF/ELIM). */
  blockedBibs?: ReadonlySet<number>;

  /** Live lap deficit per bib (positive values only), used for lapped indication rendering. */
  lapDeficitByBib?: ReadonlyMap<number, number>;

  /** Bibs that should be highlighted for lapped indication (typically gap >= 2 laps). */
  lappedIndicationBibs?: ReadonlySet<number>;

  /** Optional status flags for starters (shown in tile view). */
  statusByBib?: ReadonlyMap<number, StarterStatus>;

  /** Optional points per bib (shown as chip in list view and as short label in tiles). */
  pointsByBib?: ReadonlyMap<number, number>;

  /** Customize how a starter is displayed. */
  formatAthleteLabel?: (a: Athlete) => string;
  /** Optional delete action, shown for starters missing in the live feed. */
  onDeleteStarter?: (starter: Athlete) => void;
  /** Optional click action: allows parent scoring UIs to select/add a starter by click. */
  onStarterClick?: (starter: Athlete) => void;
  title?: string;
  maxHeight?: number;
};

function defaultAthleteLabel(a: Athlete) {
  return `${a.bib ?? ""} - ${(a.lastName ?? "").trim()} ${(a.firstName ?? "").trim()}`.trim();
}

/**
 * ScoringStarterList
 *
 * Performance notes:
 * - Wrapped with React.memo (see file bottom) so unchanged props do not trigger re-render.
 * - Uses lightweight content comparators for Set/Map/Starter arrays.
 * - Callback refs keep event handlers up to date without forcing a render on every new function reference.
 */
function ScoringStarterList({
  starters,
  missingInLiveBibs,
  selectedIds,
  blockedBibs,
  lapDeficitByBib,
  lappedIndicationBibs,
  statusByBib,
  pointsByBib,
  formatAthleteLabel,
  onDeleteStarter,
  onStarterClick,
  title = "Starters",
  maxHeight = 420,
}: Props) {
  const theme = useTheme();

  const labelOf = formatAthleteLabel ?? defaultAthleteLabel;
  const lappedIndicationBackgroundColor = "#FFF9C4";
  const lappedWithPointsBackgroundColor = "#FFE0B2";
  const lappedIndicationTooltip = "Lapped Athlete. DNF or Elim?";
  const lappedWithPointsTooltip = "Lapped Athlete with Points";

  // Keep latest callback props in refs.
  // This avoids stale closures in click handlers while still allowing memoized renders.
  const onStarterClickRef = useRef(onStarterClick);
  const onDeleteStarterRef = useRef(onDeleteStarter);

  useEffect(() => {
    onStarterClickRef.current = onStarterClick;
  }, [onStarterClick]);

  useEffect(() => {
    onDeleteStarterRef.current = onDeleteStarter;
  }, [onDeleteStarter]);

  // Render booleans are derived from props (safe to use during render).
  const clickEnabled = Boolean(onStarterClick);
  const deleteEnabled = Boolean(onDeleteStarter);

  // Stable handlers so row elements don't receive fresh inline callback identities each render.
  const handleStarterItemClick = useCallback((starter: Athlete) => {
    onStarterClickRef.current?.(starter);
  }, []);

  const handleDeleteStarter = useCallback((starter: Athlete) => {
    onDeleteStarterRef.current?.(starter);
  }, []);

  const [view, setView] = useState<"tiles" | "list">("tiles");

  function statusColor(kind: StatusKind): string {
    switch (kind) {
      case "DNS":
        return theme.palette.text.secondary;
      case "DSQ":
        return theme.palette.error.dark;
      case "DNF":
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
      const dnfLabel = s?.dnf === "elimination" ? "ELIM" : s?.dnf === "dnf" ? "DNF" : null;
      const parts = [dnfLabel, s?.dns ? "DNS" : null, s?.dsq ? "DSQ" : null].filter(Boolean) as string[];
      if (!parts.length) continue;

      // Choose a primary kind for coloring (matches Scoreboard.tsx intent).
      const kind: StatusKind =
        s?.dsq ? "DSQ" : s?.dns ? "DNS" : s?.dnf === "elimination" ? "ELIM" : s?.dnf === "dnf" ? "DNF" : null;

      m.set(bib, { kind, label: parts.join(" ") });
    }

    return m;
  }, [statusByBib]);

  const orderedStarters = useMemo(() => {
    // Desired grouping (first -> last): normal, DNF/ELIM, DSQ, DNS
    const priority: Record<Exclude<StatusKind, null> | "NONE", number> = {
      NONE: 0,
      DNF: 1,
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
      if (s.dnf === "elimination") return "ELIM";
      if (s.dnf === "dnf") return "DNF";
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
            const blocked = bib != null && (blockedBibs?.has(bib) ?? false);
            const isLappedIndication = bib != null && (lappedIndicationBibs?.has(bib) ?? false);
            const lapDeficit = bib != null ? Math.max(0, Math.floor(Number(lapDeficitByBib?.get(bib) ?? 0))) : 0;
            const lapDeficitText = isLappedIndication && lapDeficit > 0 ? `+${lapDeficit} Laps` : "";

            const pts = bib != null ? (pointsByBib?.get(bib) ?? 0) : 0;
            const ptsText = pts ? pointsLabel(pts, "long") : "";
            const isLappedWithPoints = isLappedIndication && pts > 0;
            const lappedTooltipText = isLappedWithPoints ? lappedWithPointsTooltip : lappedIndicationTooltip;

            const rowNode = (
              <ListItem
                key={a.id}
                onClick={() => {
                  if (blocked) return;
                  handleStarterItemClick(a);
                }}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  border: missing ? "2px solid" : undefined,
                  borderColor: missing ? "error.main" : undefined,
                  bgcolor: isSelected
                    ? "action.selected"
                    : isLappedWithPoints
                      ? lappedWithPointsBackgroundColor
                      : isLappedIndication
                        ? lappedIndicationBackgroundColor
                        : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  cursor: blocked ? "not-allowed" : clickEnabled ? "pointer" : "default",
                  opacity: blocked ? 0.65 : 1,
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

                {lapDeficitText ? (
                  <Chip
                    size="small"
                    label={lapDeficitText}
                    sx={{
                      height: 22,
                      fontWeight: 700,
                      bgcolor: isLappedWithPoints ? lappedWithPointsBackgroundColor : lappedIndicationBackgroundColor,
                      color: isLappedWithPoints ? "warning.dark" : "warning.dark",
                      "& .MuiChip-label": { px: 0.75 },
                    }}
                  />
                ) : ptsText ? (
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

                {missing && deleteEnabled ? (
                  <Tooltip title="Delete starter" arrow>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteStarter(a);
                        }}
                        aria-label={`Delete starter ${bib ?? ""}`.trim()}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : null}
              </ListItem>
            );

            return isLappedIndication ? (
              <Tooltip key={a.id} title={lappedTooltipText} arrow>
                {rowNode}
              </Tooltip>
            ) : rowNode;
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
            const blocked = bib != null && (blockedBibs?.has(bib) ?? false);
            const isLappedIndication = bib != null && (lappedIndicationBibs?.has(bib) ?? false);
            const lapDeficit = bib != null ? Math.max(0, Math.floor(Number(lapDeficitByBib?.get(bib) ?? 0))) : 0;
            const lapDeficitText = isLappedIndication && lapDeficit > 0 ? `+${lapDeficit} Laps` : "";

            const pts = bib != null ? (pointsByBib?.get(bib) ?? 0) : 0;
            const ptsText = pts ? pointsLabel(pts, "short") : "";
            const isLappedWithPoints = isLappedIndication && pts > 0;
            const lappedTooltipText = isLappedWithPoints ? lappedWithPointsTooltip : lappedIndicationTooltip;

            const tileNode = (
              <Box
                title={labelOf(a)}
                onClick={() => {
                  if (blocked) return;
                  handleStarterItemClick(a);
                }}
                sx={{
                  p: 0.5,
                  borderRadius: 1,
                  border: "solid",
                  borderWidth: missing ? 2 : 1,
                  // Frame color: match Scoreboard.tsx statusColor
                  borderColor: missing ? theme.palette.error.main : c ? c : "divider",
                  bgcolor: isSelected
                    ? "action.selected"
                    : isLappedWithPoints
                      ? lappedWithPointsBackgroundColor
                      : isLappedIndication
                        ? lappedIndicationBackgroundColor
                        : "background.paper",
                  minHeight: 44,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0.15,
                  userSelect: "none",
                  cursor: blocked ? "not-allowed" : clickEnabled ? "pointer" : "default",
                  opacity: blocked ? 0.65 : 1,
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

                  {missing && deleteEnabled ? (
                    <Tooltip title="Delete starter" arrow>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteStarter(a);
                          }}
                          aria-label={`Delete starter ${bib ?? ""}`.trim()}
                          sx={{ p: 0.15 }}
                        >
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : null}
                </Box>

                {lapDeficitText ? (
                  <Typography
                    variant="caption"
                    sx={{ lineHeight: 1, color: isLappedWithPoints ? "warning.dark" : "warning.dark", fontWeight: 700 }}
                  >
                    {lapDeficitText}
                  </Typography>
                ) : st?.label ? (
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

            return isLappedIndication ? (
              <Tooltip key={a.id} title={lappedTooltipText} arrow>
                {tileNode}
              </Tooltip>
            ) : (
              <Box key={a.id}>{tileNode}</Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/** Content equality for Set props used in React.memo comparator. */
function areSetsEqual<T>(a?: ReadonlySet<T>, b?: ReadonlySet<T>) {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/** Content equality for Map props used in React.memo comparator. */
function areMapsEqual<K, V>(a?: ReadonlyMap<K, V>, b?: ReadonlyMap<K, V>) {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.size !== b.size) return false;
  for (const [k, v] of a.entries()) {
    if (!b.has(k) || b.get(k) !== v) return false;
  }
  return true;
}

/**
 * Lightweight structural compare for starter rows.
 * We compare only fields rendered in this component.
 */
function areStartersEqual(a: Athlete[], b: Athlete[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.bib !== y.bib ||
      x.firstName !== y.firstName ||
      x.lastName !== y.lastName ||
      x.ageGroupId !== y.ageGroupId ||
      x.nation !== y.nation
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Custom memo comparator:
 * prevents re-render when only unrelated parent state changes.
 */
function arePropsEqual(prev: Props, next: Props) {
  return (
    areStartersEqual(prev.starters, next.starters) &&
    areSetsEqual(prev.missingInLiveBibs, next.missingInLiveBibs) &&
    areSetsEqual(prev.selectedIds, next.selectedIds) &&
    areSetsEqual(prev.blockedBibs, next.blockedBibs) &&
    areMapsEqual(prev.lapDeficitByBib, next.lapDeficitByBib) &&
    areSetsEqual(prev.lappedIndicationBibs, next.lappedIndicationBibs) &&
    areMapsEqual(prev.statusByBib, next.statusByBib) &&
    areMapsEqual(prev.pointsByBib, next.pointsByBib) &&
    prev.formatAthleteLabel === next.formatAthleteLabel &&
    Boolean(prev.onDeleteStarter) === Boolean(next.onDeleteStarter) &&
    Boolean(prev.onStarterClick) === Boolean(next.onStarterClick) &&
    prev.title === next.title &&
    prev.maxHeight === next.maxHeight
  );
}

// Export memoized component to reduce costly list/tile re-renders during live polling.
export default memo(ScoringStarterList, arePropsEqual);
