// Finish Line Log (doc/leaderboard-integration/06-frontend.md, section 7)
//
// Chronological list of line crossings ($J) of the current race: time of day, number, name, lap,
// lap time, total time, position. Photo-finish corrections ($COR) are marked.
// - Newest at the top (default) or at the bottom with auto-scroll; scrolling pauses while the
//   pointer is over the list
// - Row height adjustable (default 24 px, like finishLineLog.rowHeight of the Java app)

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  MenuItem,
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

export type FinishLogSettings = { order: "newest-top" | "newest-bottom"; rowHeight: number };
export const DEFAULT_FINISH_LOG: FinishLogSettings = { order: "newest-top", rowHeight: 24 };
const ROW_HEIGHTS = [24, 32, 40, 56];
const NEW_HIGHLIGHT_MS = 3000;

export function FinishLinePage({ ui, kiosk }: { ui: UiSettings; kiosk: boolean }) {
  const [settings, setSettings] = useStoredState<FinishLogSettings>("leaderboard.finishLog", DEFAULT_FINISH_LOG);
  const { passings, arrivedAt, connected, raceId } = usePassings();
  const { race } = useLeaderboardStream("current");
  const now = useNow(1000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);

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

  const fontSize = `${Math.max(0.75, (settings.rowHeight / 24) * 0.875) * ui.scale}rem`;
  const cellSx = { py: 0, height: settings.rowHeight, fontSize, whiteSpace: "nowrap" } as const;
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
          <TextField
            select
            size="small"
            label="Zeilenhöhe"
            value={settings.rowHeight}
            onChange={(e) => setSettings({ ...settings, rowHeight: Number(e.target.value) })}
            sx={{ minWidth: 120 }}
          >
            {ROW_HEIGHTS.map((h) => (
              <MenuItem key={h} value={h}>
                {h} px
              </MenuItem>
            ))}
          </TextField>
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
              <TableCell sx={cellSx}>Zeit</TableCell>
              <TableCell sx={cellSx} align="right">
                #
              </TableCell>
              <TableCell sx={cellSx}>Name</TableCell>
              <TableCell sx={cellSx} align="right">
                Runde
              </TableCell>
              <TableCell sx={cellSx} align="right">
                Rundenzeit
              </TableCell>
              <TableCell sx={cellSx} align="right">
                Gesamt
              </TableCell>
              <TableCell sx={cellSx} align="right">
                Pos
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ ...cellSx, color: "text.secondary", py: 2 }}>
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
                    <TableCell sx={numSx}>{p.timeOfDay}</TableCell>
                    <TableCell sx={{ ...cellSx, fontWeight: 700 }} align="right">
                      {p.number}
                    </TableCell>
                    <TableCell sx={{ ...cellSx, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{riderName(p)}</TableCell>
                    <TableCell sx={cellSx} align="right">
                      {p.lap ?? ""}
                    </TableCell>
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
