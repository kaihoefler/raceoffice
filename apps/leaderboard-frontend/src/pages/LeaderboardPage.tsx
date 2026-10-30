// Leaderboard (doc/leaderboard-integration/06-frontend.md, section 3)
//
// - Flag banner, header tiles (elapsed, lap, to go, time of day, riders)
// - Table with selectable columns (stored per device) and presets
// - Gap to the leader and interval to the rider in front (same rule as the scoring)
// - Position changes are marked for a few seconds (▲/▼), personal best lap with a dot,
//   fastest lap of the race highlighted, photo-finish corrections ($COR) marked
// - PURPLE: times hidden, bibs emphasized (start grid)
// - Last state stays visible but greyed out when the data is stale

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import {
  computeStandings,
  nationOf,
  parseTimeToSeconds,
  stripIocSuffix,
  type RaceStatusCompetitor,
  type RaceStatusRace,
} from "@raceoffice/domain";
import type { UiSettings } from "../App";
import { FlagBanner } from "../components/FlagBanner";
import { toggleFullscreen } from "../components/fullscreen";
import { STALE_AFTER_MS, useLeaderboardStream, useNow } from "../hooks/useLeaderboardStream";
import { useStoredState } from "../hooks/useStoredState";

export const COLUMNS = [
  { id: "pos", label: "Pos" },
  { id: "bib", label: "#" },
  { id: "name", label: "Name" },
  { id: "nation", label: "Nation" },
  { id: "laps", label: "Runden" },
  { id: "total", label: "Gesamtzeit" },
  { id: "gap", label: "Abstand" },
  { id: "interval", label: "Intervall" },
  { id: "last", label: "Letzte" },
  { id: "best", label: "Beste" },
  { id: "quali", label: "Quali" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

export const PRESETS: Record<string, ColumnId[]> = {
  Rennleitung: ["pos", "bib", "name", "nation", "laps", "gap", "interval", "last", "best"],
  Sprecher: ["pos", "bib", "name", "nation", "laps", "gap", "last"],
  Beamer: ["pos", "bib", "name", "laps", "gap"],
};

const TIME_COLUMNS: ColumnId[] = ["total", "gap", "interval", "last", "best"];
const MOBILE_COLUMNS: ColumnId[] = ["pos", "bib", "name", "gap"];
const CHANGE_HIGHLIGHT_MS = 4000;

type Props = { ui: UiSettings; kiosk: boolean };

export function LeaderboardPage({ ui, kiosk }: Props) {
  const { race, connected, lastUpdateAt } = useLeaderboardStream("current");
  const now = useNow(1000);
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [columns, setColumns] = useStoredState<ColumnId[]>("leaderboard.columns", PRESETS.Rennleitung!);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  // Keyboard: F toggles fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !(e.target instanceof HTMLInputElement)) toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stale = !connected || lastUpdateAt === null || now - lastUpdateAt > STALE_AFTER_MS;
  const hasRace = race !== null && race.raceID !== -1;
  const flag = String(race?.flagStatus ?? "").toUpperCase();
  const purple = flag === "PURPLE";
  const changes = usePositionChanges(race);

  const visible = (mobile ? MOBILE_COLUMNS : columns).filter((c) => !(purple && TIME_COLUMNS.includes(c)));

  return (
    <Box sx={{ fontSize: `${ui.scale * 100}%` }}>
      <FlagBanner flag={hasRace ? race.flagStatus : null}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
          <Typography component="h1" sx={{ fontSize: "1.4em", fontWeight: 700, lineHeight: 1.2 }}>
            {hasRace ? race.raceName || `Rennen ${race.raceID}` : "Kein aktives Rennen"}
          </Typography>
          {hasRace && race.trackName ? (
            <Typography component="span" sx={{ opacity: 0.85, fontSize: "0.95em" }}>
              {race.trackName}
              {race.trackLength ? ` · ${Math.round(race.trackLength * 1000)} m` : ""}
            </Typography>
          ) : null}
        </Box>
      </FlagBanner>

      {stale ? (
        <Alert severity={connected ? "warning" : "error"} sx={{ borderRadius: 0 }}>
          {!connected
            ? "Verbindung zum Leaderboard-Service getrennt – letzter Stand wird angezeigt."
            : `Keine Daten seit ${Math.round((now - (lastUpdateAt ?? now)) / 1000)} s – Verbindung zu Orbits prüfen.`}
        </Alert>
      ) : null}

      {hasRace ? (
        <Box sx={{ opacity: stale ? 0.55 : 1, transition: "opacity 300ms" }}>
          <HeaderTiles race={race} />
          {!kiosk && !mobile ? (
            <Box sx={{ display: "flex", justifyContent: "flex-end", px: 2 }}>
              <Tooltip title="Spalten">
                <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="Spalten wählen">
                  <ViewColumnIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <ColumnMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} columns={columns} onChange={setColumns} />
            </Box>
          ) : null}
          <StandingsTable race={race} columns={visible} density={ui.density} purple={purple} changes={changes} now={now} />
        </Box>
      ) : (
        <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>
          <Typography sx={{ fontSize: "1.3em" }}>Kein aktives Rennen</Typography>
          <Typography variant="body2">Sobald Orbits ein Rennen meldet, erscheint es hier.</Typography>
        </Box>
      )}
    </Box>
  );
}

function HeaderTiles({ race }: { race: RaceStatusRace }) {
  const lapsToGo = race.lapsToGo ?? 0;
  const tiles = [
    { label: "Rennzeit", value: race.elapsedTime || "—" },
    { label: "Runde", value: String(race.lapsComplete ?? 0) },
    // Orbits sends 9999 for races without a lap limit.
    { label: "Noch", value: lapsToGo > 0 && lapsToGo < 9999 ? `${lapsToGo} Runden` : "—" },
    { label: "Tageszeit", value: race.timeOfDay || "—" },
    { label: "Fahrer:innen", value: String(race.competitors.length) },
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 1, p: 2 }}>
      {tiles.map((t) => (
        <Paper key={t.label} variant="outlined" sx={{ px: 1.5, py: 1 }}>
          <Typography sx={{ fontSize: "0.75em", color: "text.secondary", textTransform: "uppercase" }}>{t.label}</Typography>
          <Typography sx={{ fontSize: "1.5em", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} aria-label={t.label}>
            {t.value}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}

function ColumnMenu(props: {
  anchor: HTMLElement | null;
  onClose: () => void;
  columns: ColumnId[];
  onChange: (c: ColumnId[]) => void;
}) {
  const { anchor, onClose, columns, onChange } = props;
  const toggle = (id: ColumnId) =>
    onChange(columns.includes(id) ? columns.filter((c) => c !== id) : COLUMNS.map((c) => c.id).filter((c) => c === id || columns.includes(c)));
  return (
    <Menu anchorEl={anchor} open={anchor !== null} onClose={onClose}>
      <Box sx={{ px: 2, py: 0.5, display: "flex", gap: 1 }}>
        {Object.entries(PRESETS).map(([name, cols]) => (
          <Button key={name} size="small" variant="outlined" onClick={() => onChange(cols)}>
            {name}
          </Button>
        ))}
      </Box>
      <Divider />
      {COLUMNS.map((c) => (
        <MenuItem key={c.id} dense onClick={() => toggle(c.id)}>
          <FormControlLabel control={<Checkbox size="small" checked={columns.includes(c.id)} />} label={c.label} sx={{ pointerEvents: "none" }} />
        </MenuItem>
      ))}
    </Menu>
  );
}

type Change = { dir: "up" | "down"; at: number };

/** Remembers position changes per bib for a few seconds. */
function usePositionChanges(race: RaceStatusRace | null): Map<string, Change> {
  const previous = useRef<{ raceId: number | null; positions: Map<string, number> }>({ raceId: null, positions: new Map() });
  const [changes, setChanges] = useState<Map<string, Change>>(new Map());

  useEffect(() => {
    if (!race) return;
    const prev = previous.current;
    const positions = new Map(race.competitors.filter((c) => c.position > 0).map((c) => [c.number, c.position]));
    if (prev.raceId === race.raceID) {
      const at = Date.now();
      const found: Array<[string, Change]> = [];
      for (const [bib, pos] of positions) {
        const before = prev.positions.get(bib);
        if (before !== undefined && before !== pos) found.push([bib, { dir: pos < before ? "up" : "down", at }]);
      }
      if (found.length) {
        setChanges((current) => {
          const next = new Map(current);
          for (const [bib, change] of found) next.set(bib, change);
          return next;
        });
      }
    } else {
      setChanges(new Map());
    }
    previous.current = { raceId: race.raceID, positions };
  }, [race]);

  return changes;
}

function StandingsTable(props: {
  race: RaceStatusRace;
  columns: ColumnId[];
  density: UiSettings["density"];
  purple: boolean;
  changes: Map<string, Change>;
  now: number;
}) {
  const { race, columns, density, purple, changes, now } = props;
  const rows = useMemo(() => computeStandings(race), [race]);
  const fastest = useMemo(() => fastestLap(race.competitors), [race]);
  const padY = density === "compact" ? 0.25 : density === "large" ? 1.25 : 0.6;

  return (
    <Box sx={{ px: { xs: 0, sm: 2 }, pb: 2, overflowX: "auto" }}>
      <Table size="small" aria-label="Rangliste" sx={{ "& td, & th": { fontSize: "1em", py: padY, whiteSpace: "nowrap" } }}>
        <TableHead>
          <TableRow>
            {columns.map((id) => (
              <TableCell key={id} align={alignOf(id)} sx={{ fontWeight: 700 }}>
                {COLUMNS.find((c) => c.id === id)?.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const c = row.competitor;
            const change = changes.get(c.number);
            const recent = change && now - change.at < CHANGE_HIGHLIGHT_MS ? change : null;
            return (
              <TableRow
                key={`${c.number}-${c.firstName}-${c.lastName}`}
                sx={{
                  transition: "background-color 1.5s",
                  bgcolor: recent ? (recent.dir === "up" ? "rgba(46,125,50,0.18)" : "rgba(198,40,40,0.14)") : undefined,
                  opacity: row.classified ? 1 : 0.7,
                }}
              >
                {columns.map((id) => (
                  <TableCell key={id} align={alignOf(id)} sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {cell(id, row, { purple, fastest, recent })}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function alignOf(id: ColumnId): "left" | "right" | "center" {
  if (id === "name" || id === "nation") return "left";
  if (id === "pos" || id === "bib") return "center";
  return "right";
}

function cell(
  id: ColumnId,
  row: ReturnType<typeof computeStandings>[number],
  ctx: { purple: boolean; fastest: number | null; recent: Change | null },
): React.ReactNode {
  const c = row.competitor;
  const corrected = c.timeCorrection && c.timeCorrection.lap === c.lapsComplete ? c.timeCorrection : null;
  switch (id) {
    case "pos":
      return (
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontWeight: 700 }}>
          {row.classified ? c.position : "–"}
          {ctx.recent ? (
            <Box component="span" aria-label={ctx.recent.dir === "up" ? "verbessert" : "verloren"} sx={{ color: ctx.recent.dir === "up" ? "success.main" : "error.main", fontSize: "0.8em" }}>
              {ctx.recent.dir === "up" ? "▲" : "▼"}
            </Box>
          ) : null}
        </Box>
      );
    case "bib":
      return (
        <Box component="span" sx={{ fontWeight: 700, fontSize: ctx.purple ? "1.3em" : undefined }}>
          {c.number}
        </Box>
      );
    case "name": {
      const last = stripIocSuffix(c.lastName);
      return last && c.firstName ? `${last}, ${c.firstName}` : last || c.firstName;
    }
    case "nation":
      return nationOf(c);
    case "laps":
      return c.lapsComplete;
    case "total":
      return withCorrection(blankZero(c.totalTime), corrected);
    case "gap":
      return withCorrection(row.gap, corrected);
    case "interval":
      return row.interval;
    case "last": {
      const isPersonalBest = c.lastLap && c.lastLap !== "0:00" && c.lastLap === c.bestLap;
      return (
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          {withCorrection(blankZero(c.lastLap ?? ""), corrected)}
          {isPersonalBest ? <Box component="span" title="persönliche Bestrunde" sx={{ color: "success.main" }}>●</Box> : null}
        </Box>
      );
    }
    case "best": {
      const best = parseTimeToSeconds(c.bestLap ?? "");
      const isFastest = best !== null && best > 0 && ctx.fastest !== null && Math.abs(best - ctx.fastest) < 0.0005;
      return (
        <Box component="span" sx={isFastest ? { color: "#9c27b0", fontWeight: 700 } : undefined} title={isFastest ? "schnellste Runde" : undefined}>
          {blankZero(c.bestLap ?? "")}
        </Box>
      );
    }
    case "quali":
      return c.qualiPosition ? c.qualiPosition : "";
  }
}

function withCorrection(text: string, corrected: { lap: number; deltaMs: number } | null): React.ReactNode {
  if (!corrected || !text) return text;
  const delta = (corrected.deltaMs / 1000).toLocaleString("de-DE", { minimumFractionDigits: 3, signDisplay: "always" });
  return (
    <Tooltip title={`Zielfoto-Korrektur Runde ${corrected.lap}: ${delta} s`}>
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        {text}
        <PhotoCameraIcon aria-label="Zielfoto-Korrektur" sx={{ fontSize: "0.9em", color: "info.main" }} />
      </Box>
    </Tooltip>
  );
}

function blankZero(time: string): string {
  return !time || time === "0:00" ? "" : time;
}

function fastestLap(competitors: RaceStatusCompetitor[]): number | null {
  let best: number | null = null;
  for (const c of competitors) {
    const t = parseTimeToSeconds(c.bestLap ?? "");
    if (t !== null && t > 0 && (best === null || t < best)) best = t;
  }
  return best;
}
