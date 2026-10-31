// Finish Line Log (doc/leaderboard-integration/06-frontend.md, section 7)
//
// Chronological list of line crossings ($J) of the current race: time of day, number, name, lap,
// lap time, total time, position. Photo-finish corrections ($COR) are marked.
// - Newest at the top (default) or at the bottom with auto-scroll; scrolling pauses while the
//   pointer is over the list
// - Row height freely adjustable (default 24 px, like finishLineLog.rowHeight of the Java app)
// - Compact view: number, name, lap, position only (e.g. for the commentator or a small screen)
// - URL parameters for kiosk screens (no controls there): ?compact=1&rowHeight=40

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryParam } from "../App";
import {
  Alert,
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { stripIocSuffix, type LeaderboardPassing } from "@raceoffice/domain";
import type { UiSettings } from "../App";
import { useLeaderboardStream, useNow } from "../hooks/useLeaderboardStream";
import { usePassings } from "../hooks/usePassings";
import { useStoredState } from "../hooks/useStoredState";

export type FinishLogSettings = { order: "newest-top" | "newest-bottom"; rowHeight: number; compact?: boolean };
export const DEFAULT_FINISH_LOG: FinishLogSettings = { order: "newest-top", rowHeight: 24, compact: false };
export const ROW_HEIGHT_MIN = 16;
export const ROW_HEIGHT_MAX = 200;

function validRowHeight(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= ROW_HEIGHT_MIN && n <= ROW_HEIGHT_MAX ? n : null;
}
const NEW_HIGHLIGHT_MS = 3000;

export function FinishLinePage({ ui, kiosk }: { ui: UiSettings; kiosk: boolean }) {
  const [settings, setSettings] = useStoredState<FinishLogSettings>("leaderboard.finishLog", DEFAULT_FINISH_LOG);
  const { passings, arrivedAt, connected, raceId } = usePassings();
  const { race } = useLeaderboardStream("current");
  const now = useNow(1000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  // URL parameters (kiosk screens) win over the settings stored on the device.
  const compactParam = useQueryParam("compact");
  const rowHeightParam = validRowHeight(useQueryParam("rowHeight"));
  const compact = compactParam !== null ? compactParam === "1" || compactParam === "true" : (settings.compact ?? false);
  const rowHeight = rowHeightParam ?? validRowHeight(settings.rowHeight) ?? DEFAULT_FINISH_LOG.rowHeight;
  // Free text while typing ("4" on the way to "40"); stored once it is a valid height.
  const [rowHeightText, setRowHeightText] = useState(String(rowHeight));
  useEffect(() => setRowHeightText(String(rowHeight)), [rowHeight]);

  const rows = useMemo(
    () => (settings.order === "newest-top" ? [...passings].reverse() : passings),
    [passings, settings.order],
  );

  // Keep the newest row in view unless the user is looking at older ones.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || hover) return;
    el.scrollTop = settings.order === "newest-top" ? 0 : el.scrollHeight;
  }, [rows, hover, settings.order]);

  const fontSize = `${Math.max(0.75, (rowHeight / 24) * 0.875) * ui.scale}rem`;
  const cellSx = { py: 0, height: rowHeight, fontSize, whiteSpace: "nowrap" } as const;
  const columns = compact ? 4 : 7;
  const numSx = { ...cellSx, fontVariantNumeric: "tabular-nums" } as const;
  const raceName = race && race.raceID === raceId ? race.raceName : null;

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, p: kiosk ? 0 : 2, gap: 1 }}>
      {kiosk ? null : (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Typography component="h1" variant="h6" sx={{ flex: 1, minWidth: 200 }}>
            Zieldurchfahrten{raceName ? ` – ${raceName}` : ""}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={settings.order}
            onChange={(_, v: FinishLogSettings["order"] | null) => v && setSettings({ ...settings, order: v })}
          >
            <ToggleButton value="newest-top">Neueste oben</ToggleButton>
            <ToggleButton value="newest-bottom">Neueste unten</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={compact ? "compact" : "full"}
            disabled={compactParam !== null}
            onChange={(_, v: "compact" | "full" | null) => v && setSettings({ ...settings, compact: v === "compact" })}
          >
            <ToggleButton value="full">Alle Spalten</ToggleButton>
            <ToggleButton value="compact">Kompakt</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            type="number"
            size="small"
            label="Zeilenhöhe (px)"
            value={rowHeightText}
            disabled={rowHeightParam !== null}
            error={validRowHeight(rowHeightText) === null}
            onChange={(e) => {
              setRowHeightText(e.target.value);
              const valid = validRowHeight(e.target.value);
              if (valid !== null) setSettings({ ...settings, rowHeight: valid });
            }}
            onBlur={() => setRowHeightText(String(rowHeight))}
            slotProps={{ htmlInput: { min: ROW_HEIGHT_MIN, max: ROW_HEIGHT_MAX, step: 2 } }}
            sx={{ width: 140 }}
          />
        </Box>
      )}
      {connected ? null : <Alert severity="warning">Verbindung zum Leaderboard-Service getrennt – neuer Versuch läuft.</Alert>}

      <Box
        ref={scrollRef}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        sx={{ flex: 1, minHeight: 200, overflow: "auto", border: kiosk ? 0 : 1, borderColor: "divider", borderRadius: 1 }}
      >
        <Table size="small" stickyHeader aria-label="Zieldurchfahrten">
          <TableHead>
            <TableRow>
              {compact ? null : <TableCell sx={cellSx}>Zeit</TableCell>}
              <TableCell sx={cellSx} align="right">
                #
              </TableCell>
              <TableCell sx={cellSx}>Name</TableCell>
              <TableCell sx={cellSx} align="right">
                Runde
              </TableCell>
              {compact ? null : (
                <>
                  <TableCell sx={cellSx} align="right">
                    Rundenzeit
                  </TableCell>
                  <TableCell sx={cellSx} align="right">
                    Gesamt
                  </TableCell>
                </>
              )}
              <TableCell sx={cellSx} align="right">
                {compact ? "Platz" : "Pos"}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} sx={{ ...cellSx, color: "text.secondary", py: 2 }}>
                  {raceId === null ? "Kein aktives Rennen" : "Noch keine Durchfahrten"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => {
                const fresh = now - (arrivedAt.get(p.seq) ?? 0) < NEW_HIGHLIGHT_MS;
                return (
                  <TableRow
                    key={p.seq}
                    sx={{
                      bgcolor: (t) => (fresh ? alpha(t.palette.success.main, 0.18) : undefined),
                      transition: "background-color 1s",
                    }}
                  >
                    {compact ? null : <TableCell sx={numSx}>{p.timeOfDay}</TableCell>}
                    <TableCell sx={{ ...cellSx, fontWeight: 700 }} align="right">
                      {p.number}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{riderName(p)}</TableCell>
                    <TableCell sx={cellSx} align="right">
                      {p.lap ?? ""}
                    </TableCell>
                    {compact ? null : (
                      <>
                        <TableCell sx={numSx} align="right">
                          {p.lapTime === "0:00" ? "–" : p.lapTime}
                        </TableCell>
                        <TableCell sx={numSx} align="right">
                          {p.correctionMs !== undefined ? (
                            <Tooltip title={`Zielfoto-Korrektur ${p.correctionMs > 0 ? "+" : ""}${(p.correctionMs / 1000).toFixed(3)} s`}>
                              <PhotoCameraIcon aria-label="Zielfoto-Korrektur" sx={{ fontSize: "1em", mr: 0.5, verticalAlign: "-0.1em" }} />
                            </Tooltip>
                          ) : null}
                          {p.totalTime}
                        </TableCell>
                      </>
                    )}
                    <TableCell sx={cellSx} align="right">
                      {p.position ?? ""}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

function riderName(p: LeaderboardPassing): string {
  const last = stripIocSuffix(p.lastName);
  return last && p.firstName ? `${last}, ${p.firstName}` : last || p.firstName;
}
