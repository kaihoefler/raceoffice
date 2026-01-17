import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { useRaceStatus, type RaceStatusCompetitor } from "../providers/RaceStatusProvider";

function parseTimeToSeconds(input: string): number | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  // Accept h:mm:ss(.fff) or m:ss(.fff) or ss(.fff)
  const parts = s.split(":");
  const parseSecondsPart = (p: string) => {
    const norm = p.replace(",", ".");
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  };

  if (parts.length === 1) {
    return parseSecondsPart(parts[0]);
  }

  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = parseSecondsPart(parts[1]);
    if (!Number.isFinite(mm) || ss === null) return null;
    return mm * 60 + ss;
  }

  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = parseSecondsPart(parts[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || ss === null) return null;
    return hh * 3600 + mm * 60 + ss;
  }

  return null;
}

function formatDeltaSeconds(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "-" : "+";
  const d = Math.abs(deltaSeconds);

  // Example requested: +0,032
  // Keep seconds with 3 decimals; if >= 60, show m:ss,fff
  const ms = Math.round(d * 1000);
  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    const s = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(totalSeconds);
    return `${sign}${s}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds - minutes * 60;
  const restStr = new Intl.NumberFormat("de-DE", {
    minimumIntegerDigits: 2,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(rest);

  return `${sign}${minutes}:${restStr}`;
}

function formatLeaderTime(totalTime: string, lapsComplete: number): string {
  const t = String(totalTime ?? "").trim();
  // For the leader we don't show the lap suffix anymore.
  if (!t) return `L${lapsComplete}`;
  return t;
}

function stripIocSuffix(namePart: string): string {
  // Remove IOC code like "(GER)" / "(COL)" (3 letters in parentheses)
  return namePart.replace(/\s*\([A-Z]{3}\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function shortenFirstName(fn: string): string {
  const v = fn.trim();
  if (v.length <= 8) return v;
  return `${v.slice(0, 8)}...`;
}

function shortenLastName(ln: string): string {
  const v = ln.trim();
  if (v.length <= 30) return v;
  return `${v.slice(0, 30)}...`;
}

function competitorName(c: RaceStatusCompetitor): string {
  const fn = shortenFirstName(String(c.firstName ?? ""));
  const ln = shortenLastName(stripIocSuffix(String(c.lastName ?? "")));

  if (ln && fn) return `${ln}, ${fn}`;
  return (ln || fn).trim();
}

export default function LiveRaceStatus() {
  const {
    status,
    error,
    currentRace,
    updatedAt,
    url,
    pollIntervalMs,
    paused,
    setUrl,
    setPollIntervalMs,
    setPaused,
  } = useRaceStatus();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftPollMs, setDraftPollMs] = useState<number>(pollIntervalMs);
  const [draftPaused, setDraftPaused] = useState<boolean>(paused);

  useEffect(() => {
    if (!settingsOpen) return;
    setDraftUrl(url);
    setDraftPollMs(pollIntervalMs);
    setDraftPaused(paused);
  }, [settingsOpen, url, pollIntervalMs, paused]);

  // With 1s polling we allow a little jitter; >3s without an update is considered disconnected.
  const isStale = !updatedAt || Date.now() - updatedAt > 3000;
  const isPaused = paused || status === "paused";
  const isConnected = !isPaused && status === "ok" && !isStale;

  const connectionLabel = isPaused ? "paused" : isConnected ? "connected" : "no response";
  const connectionColor = isPaused ? "text.secondary" : isConnected ? "success.main" : "error.main";

  const flag = String(currentRace?.flagStatus ?? "");
  const flagTrim = flag.trim();
  const isIdle = !currentRace || !flagTrim;

  const flagKey = flagTrim.toUpperCase();
  const flagChipVariant: "filled" | "outlined" =
    flagKey === "GREEN" || flagKey === "PURPLE" || flagKey === "FINISH" ? "filled" : "outlined";

  const flagChipSx =
    flagKey === "GREEN"
      ? { bgcolor: "success.main", color: "common.white" }
      : flagKey === "PURPLE"
        ? { bgcolor: "#7b1fa2", color: "common.white" }
        : flagKey === "FINISH"
          ? { bgcolor: "common.black", color: "common.white" }
          : undefined;

  const rows = useMemo(() => {
    if (!currentRace) return [];

    const competitors = Array.isArray(currentRace.competitors) ? [...currentRace.competitors] : [];
    competitors.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));

    const leader = competitors[0];
    if (!leader) return [];

    const leaderLaps = Number(leader.lapsComplete ?? 0);
    const leaderTimeSec = parseTimeToSeconds(leader.totalTime) ?? 0;

    return competitors.map((c) => {
      const laps = Number(c.lapsComplete ?? 0);
      const timeSec = parseTimeToSeconds(c.totalTime);

      let timeText = "";
      if (c === leader) {
        timeText = formatLeaderTime(c.totalTime, laps);
      } else if (laps < leaderLaps) {
        const diffLaps = leaderLaps - laps;
        timeText = diffLaps === 1 ? "+1 Lap" : `+${diffLaps} Laps`;
      } else if (timeSec !== null) {
        timeText = formatDeltaSeconds(timeSec - leaderTimeSec);
      } else {
        timeText = "";
      }

      return {
        key: `${c.number}-${c.position}`,
        position: c.position,
        bib: c.number,
        name: competitorName(c),
        timeText,
      };
    });
  }, [currentRace]);

  if (isIdle) {
    return (
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              Live status
            </Typography>
            <Tooltip title={url} placement="top" arrow>
              <Typography
                variant="caption"
                noWrap
                role="button"
                tabIndex={0}
                onClick={() => setSettingsOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSettingsOpen(true);
                }}
                sx={{
                  cursor: "pointer",
                  color: connectionColor,
                  opacity: 0.9,
                  userSelect: "none",
                }}
              >
                {connectionLabel}
              </Typography>
            </Tooltip>
          </Box>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Chip size="small" label={flagTrim || "—"} variant={flagChipVariant} sx={flagChipSx} />
          </Box>
        </Box>

        {!isConnected && !isPaused ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            Live status service not responding ({url}){error ? `: ${error}` : ""}
          </Alert>
        ) : null}

        <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Race status connection</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
              <TextField
                label="URL"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                fullWidth
                size="small"
              />

              <TextField
                label="Refresh rate (ms)"
                type="number"
                value={draftPollMs}
                onChange={(e) => setDraftPollMs(Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 250, max: 60000, step: 250 }}
                helperText="Min 250ms, max 60000ms"
              />

              <FormControlLabel
                control={<Switch checked={draftPaused} onChange={(e) => setDraftPaused(e.target.checked)} />}
                label="Paused"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => {
                setUrl(draftUrl);
                setPollIntervalMs(draftPollMs);
                setPaused(draftPaused);
                setSettingsOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogActions>
        </Dialog>

        <Typography variant="body2" color="text.secondary">
          No active race.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            Live status
          </Typography>
          <Tooltip title={url} placement="top" arrow>
            <Typography
              variant="caption"
              noWrap
              role="button"
              tabIndex={0}
              onClick={() => setSettingsOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSettingsOpen(true);
              }}
              sx={{
                cursor: "pointer",
                color: connectionColor,
                opacity: 0.9,
                userSelect: "none",
              }}
            >
              {connectionLabel}
            </Typography>
          </Tooltip>
        </Box>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Chip size="small" label={flagTrim || "—"} variant={flagChipVariant} sx={flagChipSx} />
        </Box>
      </Box>

      {!isConnected && !isPaused ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Live status service not responding ({url}){error ? `: ${error}` : ""}
        </Alert>
      ) : null}

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Race status connection</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="URL"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              fullWidth
              size="small"
            />

            <TextField
              label="Refresh rate (ms)"
              type="number"
              value={draftPollMs}
              onChange={(e) => setDraftPollMs(Number(e.target.value))}
              fullWidth
              size="small"
              inputProps={{ min: 250, max: 60000, step: 250 }}
              helperText="Min 250ms, max 60000ms"
            />

            <FormControlLabel
              control={<Switch checked={draftPaused} onChange={(e) => setDraftPaused(e.target.checked)} />}
              label="Paused"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setUrl(draftUrl);
              setPollIntervalMs(draftPollMs);
              setPaused(draftPaused);
              setSettingsOpen(false);
            }}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", mb: 1, gap: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
          {currentRace?.raceName}
        </Typography>

        <Typography variant="caption" color="text.secondary" noWrap sx={{ textAlign: "right" }}>
          {(() => {
            const lap = currentRace?.lapsComplete;
            const lapsToGo = currentRace?.lapsToGo;
            if (lap == null && lapsToGo == null) return "";
            if (lap != null && lapsToGo != null) return `Lap ${lap} (${lapsToGo} Laps to Go)`;
            if (lap != null) return `Lap ${lap}`;
            return `${lapsToGo} Laps to Go`;
          })()}
        </Typography>
      </Box>

      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 60 }}>Platz</TableCell>
            <TableCell sx={{ width: 70 }}>Bib</TableCell>
            <TableCell>Name</TableCell>
            <TableCell sx={{ width: 120 }}>Time</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} hover>
              <TableCell>{r.position}</TableCell>
              <TableCell>{r.bib}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{r.name}</TableCell>
              <TableCell>{r.timeText}</TableCell>
            </TableRow>
          ))}

          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <Typography variant="body2" color="text.secondary">
                  No data.
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Box>
  );
}
