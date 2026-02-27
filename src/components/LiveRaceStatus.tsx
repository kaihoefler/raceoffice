// src/components/LiveRaceStatus.tsx
//
// Zeigt Live-Rennstatus (Polling über RaceStatusProvider) inkl.
// - Verbindungsstatus (connected / paused / no response)
// - Flag-Status (GREEN / PURPLE / FINISH / ...)
// - Tabelle der Fahrer:innen (Platz, Bib, Name, Zeit/Delta)
// - Settings-Dialog: URL + Polling-Intervall + Pause
// - Optional: “Activate Sync” (z.B. für PointsScoring Sync)
// - Optional: Button “create starters” für unbekannte Bibs aus Live-Daten
//
// Wichtige Regeln/UX:
// - Bei “PURPLE” werden Zeiten ausgeblendet (hideTimes), nur Positionen/Name
// - Sync ist nur erlaubt wenn Flag GREEN oder PURPLE (canSync)
// - Wenn sich das Live-Race ändert, wird Sync automatisch ausgeschaltet

import { useEffect, useMemo, useRef, useState } from "react";
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
  ToggleButton,
  Tooltip,
  Typography,
  IconButton,
} from "@mui/material";

import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import { useRaceStatus, type RaceStatusCompetitor } from "../providers/RaceStatusProvider";

/**
 * Parsed Zeitstring in Sekunden (number).
 * Unterstützt:
 * - "ss(.fff)"
 * - "m:ss(.fff)"
 * - "h:mm:ss(.fff)"
 * Außerdem:
 * - Komma als Dezimaltrenner wird akzeptiert (de-Style), z.B. "0:15,032"
 */
function parseTimeToSeconds(input: string): number | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  const parts = s.split(":");

  // Sekunden-Teil, erlaubt Dezimalpunkt oder Komma
  const parseSecondsPart = (p: string) => {
    const norm = p.replace(",", ".");
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  };

  // "ss(.fff)"
  if (parts.length === 1) {
    return parseSecondsPart(parts[0]);
  }

  // "m:ss(.fff)"
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = parseSecondsPart(parts[1]);
    if (!Number.isFinite(mm) || ss === null) return null;
    return mm * 60 + ss;
  }

  // "h:mm:ss(.fff)"
  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = parseSecondsPart(parts[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || ss === null) return null;
    return hh * 3600 + mm * 60 + ss;
  }

  return null;
}

/**
 * Formatiert Zeitdifferenz in Sekunden als String:
 * - Vorzeichen +/-
 * - mit 3 Nachkommastellen
 * - unter 60s: "+0,032"
 * - ab 60s: "+m:ss,fff"
 */
function formatDeltaSeconds(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "-" : "+";
  const d = Math.abs(deltaSeconds);

  // auf Millisekunden runden, um "wackelige" floats zu vermeiden
  const ms = Math.round(d * 1000);
  const totalSeconds = ms / 1000;

  // unter 1 Minute => nur Sekunden mit 3 Dezimalstellen
  if (totalSeconds < 60) {
    const s = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(totalSeconds);
    return `${sign}${s}`;
  }

  // ab 1 Minute => m:ss,fff
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds - minutes * 60;
  const restStr = new Intl.NumberFormat("de-DE", {
    minimumIntegerDigits: 2,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(rest);

  return `${sign}${minutes}:${restStr}`;
}

/**
 * Darstellung für Leader:
 * - wenn totalTime fehlt: zeigen wir "L<lapsComplete>" (Lap-Info statt Zeit)
 * - sonst: die Leader-Zeit unverändert
 */
function formatLeaderTime(totalTime: string, lapsComplete: number): string {
  const t = String(totalTime ?? "").trim();
  if (!t) return `L${lapsComplete}`;
  return t;
}

/**
 * Entfernt IOC-Suffixe aus Namen:
 * z.B. "Müller (GER)" -> "Müller"
 * (3 Buchstaben in Klammern)
 */
function stripIocSuffix(namePart: string): string {
  return namePart.replace(/\s*\([A-Z]{3}\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Kürzt Vornamen für kompakte Anzeige. */
function shortenFirstName(fn: string): string {
  const v = fn.trim();
  if (v.length <= 8) return v;
  return `${v.slice(0, 8)}...`;
}

/** Kürzt Nachnamen für kompakte Anzeige (längerer Grenzwert). */
function shortenLastName(ln: string): string {
  const v = ln.trim();
  if (v.length <= 30) return v;
  return `${v.slice(0, 30)}...`;
}

/**
 * Baut den Anzeigetext für eine:n Competitor:
 * - "Nachname, Vorname" (gekürzt)
 * - IOC Code wird entfernt
 */
function competitorName(c: RaceStatusCompetitor): string {
  const fn = shortenFirstName(String(c.firstName ?? ""));
  const ln = shortenLastName(stripIocSuffix(String(c.lastName ?? "")));

  if (ln && fn) return `${ln}, ${fn}`;
  return (ln || fn).trim();
}

export default function LiveRaceStatus({
  unknownLiveBibs,
  onCreateStarters,
  syncEnabled = false,
  onSyncEnabledChange,
}: {
  unknownLiveBibs?: Set<number>;
  onCreateStarters?: () => void;
  /** If enabled, the page can sync PointsScoring with Live status. */
  syncEnabled?: boolean;
  onSyncEnabledChange?: (next: boolean) => void;
}) {
  /**
   * RaceStatusProvider liefert:
   * - status/error/errorCount: Verbindungs-/Pollingstatus
   * - currentRace: Live-Daten (Race, Competitors, Flag, Laps, etc.)
   * - updatedAt: Timestamp letzter erfolgreicher Update
   * - url/pollInterval: Konfiguration
   * - paused: Polling pausiert?
   * - setUrl/setPollIntervalMs/setPaused: Settings ändern
   */
  const {
    status,
    error,
    errorCount,
    currentRace,
    updatedAt,
    url,
    pollIntervalMs,
    effectivePollIntervalMs,
    paused,
    setUrl,
    setPollIntervalMs,
    setPaused,
  } = useRaceStatus();

  // -----------------------
  // Settings Dialog State
  // -----------------------
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Draft States: solange Dialog offen ist, ändern wir erst “Entwurf” und übernehmen via Apply.
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftPollMs, setDraftPollMs] = useState<number>(pollIntervalMs);
  const [draftPaused, setDraftPaused] = useState<boolean>(paused);

  // Wenn Dialog geöffnet wird, Drafts auf aktuelle Werte syncen.
  useEffect(() => {
    if (!settingsOpen) return;
    setDraftUrl(url);
    setDraftPollMs(pollIntervalMs);
    setDraftPaused(paused);
  }, [settingsOpen, url, pollIntervalMs, paused]);

  // -----------------------
  // Connection State (derived)
  // -----------------------
  // Bei 1s Polling tolerieren wir etwas Jitter; >3s ohne Update gilt als “stale”.
  const isStale = !updatedAt || Date.now() - updatedAt > 3000;

  // Paused kann aus Provider kommen oder lokal gesetzt sein
  const isPaused = paused || status === "paused";

  // “connected” nur wenn:
  // - nicht paused
  // - status ok
  // - nicht stale
  // - kein error
  const isConnected = !isPaused && status === "ok" && !isStale && !error;

  const connectionLabel = isPaused ? "paused" : isConnected ? "connected" : "no response";
  const connectionColor = isPaused ? "text.secondary" : isConnected ? "success.main" : "error.main";

  // -----------------------
  // Race/Flag State (derived)
  // -----------------------
  const flag = String(currentRace?.flagStatus ?? "");
  const flagTrim = flag.trim();

  // “idle”: kein aktives Race oder Flag fehlt
  const isIdle = !currentRace || !flagTrim;

  // Wir normalisieren Flag in uppercase, um Vergleiche robust zu machen
  const flagKey = flagTrim.toUpperCase();

  // Sync ist nur erlaubt bei GREEN oder PURPLE (Business-Rule)
  const canSync = flagKey === "GREEN" || flagKey === "PURPLE";

  // -----------------------
  // Sync reset on race change
  // -----------------------
  // Wenn sich raceID ändert, muss Sync wieder aus (Anforderung).
  const raceId = (currentRace as any)?.raceID ?? null;
  const prevRaceIdRef = useRef<number | null>(raceId);

  useEffect(() => {
    if (prevRaceIdRef.current === raceId) return;
    prevRaceIdRef.current = raceId;

    onSyncEnabledChange?.(false);
  }, [raceId, onSyncEnabledChange]);

  // Wenn Flag nicht mehr GREEN/PURPLE, erzwinge Sync off.
  useEffect(() => {
    if (!onSyncEnabledChange) return;
    if (syncEnabled && !canSync) onSyncEnabledChange(false);
  }, [syncEnabled, canSync, onSyncEnabledChange]);

  // -----------------------
  // Flag Chip Styling
  // -----------------------
  // Bei “starken” Status (GREEN/PURPLE/FINISH) füllen wir den Chip farbig.
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

  // Wie viele Bibs fehlen in unserer Starterliste (vom Parent geliefert)?
  const unknownCount = unknownLiveBibs?.size ?? 0;

  /**
   * rows: Darstellung für die Tabelle.
   * - sortiert nach position
   * - leader wird bestimmt (erstes Element)
   * - timeText:
   *   - PURPLE => Zeiten verstecken
   *   - leader => Leader-Zeit (oder Lap-Info)
   *   - wenn weniger Laps als Leader => "+1 Lap / +N Laps"
   *   - sonst => Delta zum Leader (z.B. +0,032)
   */
  const rows = useMemo(() => {
    if (!currentRace) return [];

    const competitors = Array.isArray(currentRace.competitors) ? [...currentRace.competitors] : [];
    competitors.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));

    const leader = competitors[0];
    if (!leader) return [];

    // Business rule: im PURPLE-Flag keine Zeiten anzeigen
    const hideTimes = flagKey === "PURPLE";

    const leaderLaps = Number(leader.lapsComplete ?? 0);
    const leaderTimeSec = parseTimeToSeconds(leader.totalTime) ?? 0;

    return competitors.map((c) => {
      const laps = Number(c.lapsComplete ?? 0);
      const timeSec = parseTimeToSeconds(c.totalTime);

      let timeText = "";
      if (!hideTimes) {
        if (c === leader) {
          // Leader: echte Zeit oder “L<lap>”
          timeText = formatLeaderTime(c.totalTime, laps);
        } else if (laps < leaderLaps) {
          // Überrundete: Anzeige in Laps
          const diffLaps = leaderLaps - laps;
          timeText = diffLaps === 1 ? "+1 Lap" : `+${diffLaps} Laps`;
        } else if (timeSec !== null) {
          // Sonst: Delta in Zeit
          timeText = formatDeltaSeconds(timeSec - leaderTimeSec);
        } else {
          // Keine Zeitdaten
          timeText = "";
        }
      }

      return {
        key: `${c.number}-${c.position}`, // key muss in Liste stabil sein
        position: c.position,
        bib: c.number,
        name: competitorName(c),
        timeText,
      };
    });
  }, [currentRace, flagKey]);

  // -----------------------
  // Idle UI: kein aktives Race
  // -----------------------
  if (isIdle) {
    return (
      <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minWidth: 0 }}>
        {/* Header: "Live status" + connection + Pause/Resume + Flag Chip */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              Live status
            </Typography>

            {/* Connection label ist klickbar -> öffnet Settings */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
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

              {/* Pause/Resume Polling */}
              <Tooltip title={paused ? "Resume polling" : "Pause polling"} arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      // verhindert, dass evtl. parent click handlers feuern
                      e.stopPropagation();
                      setPaused(!paused);
                    }}
                    aria-label={paused ? "Resume live polling" : "Pause live polling"}
                    color={paused ? "success" : "inherit"}
                    sx={{ p: 0.25 }}
                  >
                    {paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Chip size="small" label={flagTrim || "—"} variant={flagChipVariant} sx={flagChipSx} />
          </Box>
        </Box>

        {/* Warnung, wenn nicht connected und nicht paused */}
        {!isConnected && !isPaused ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            Live status service not responding ({url}){error ? `: ${error}` : ""}
            {errorCount > 0 ? ` • fails in a row: ${errorCount}` : ""}
            {errorCount >= 10 ? ` • slowed polling: ${effectivePollIntervalMs}ms` : ""}
          </Alert>
        ) : null}

        {/* Settings Dialog (auch im Idle-State verfügbar) */}
        <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Race status connection</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
              <TextField label="URL" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} fullWidth size="small" />

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
                // Apply übernimmt Drafts in den Provider
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

        {/* Idle Body */}
        <Typography variant="body2" color="text.secondary">
          No active race.
        </Typography>
      </Box>
    );
  }
  // -----------------------
  // Active UI: Race läuft / Live Daten vorhanden
  // -----------------------
  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, minWidth: 0 }}>
      {/* Header: Titel + Connection-Label (klickbar für Settings) + Pause/Resume + Flag Chip */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            Live status
          </Typography>

          {/* Connection label (zeigt connected/paused/no response) und öffnet Settings beim Klick */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <Tooltip title={url} placement="top" arrow>
              <Typography
                variant="caption"
                noWrap
                role="button"
                tabIndex={0}
                onClick={() => setSettingsOpen(true)}
                onKeyDown={(e) => {
                  // Keyboard-accessible: Enter/Space öffnet ebenfalls den Dialog
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

            {/* Pause/Resume Polling Toggle */}
            <Tooltip title={paused ? "Resume polling" : "Pause polling"} arrow>
              <span>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    // verhindert z.B., dass ein Klick auf den Header “mitklickt”
                    e.stopPropagation();
                    setPaused(!paused);
                  }}
                  aria-label={paused ? "Resume live polling" : "Pause live polling"}
                  color={paused ? "success" : "inherit"}
                  sx={{ p: 0.25 }}
                >
                  {paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>

        {/* Rechts im Header: Flag-Status (farbiger Chip) */}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Chip size="small" label={flagTrim || "—"} variant={flagChipVariant} sx={flagChipSx} />
        </Box>
      </Box>

      {/* Warnung, wenn der Service “nicht reagiert” (aber wir nicht pausiert haben) */}
      {!isConnected && !isPaused ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Live status service not responding ({url}){error ? `: ${error}` : ""}
          {errorCount > 0 ? ` • fails in a row: ${errorCount}` : ""}
          {/* Bei vielen Fehlern kann der Provider das Polling drosseln -> Info anzeigen */}
          {errorCount >= 10 ? ` • slowed polling: ${effectivePollIntervalMs}ms` : ""}
        </Alert>
      ) : null}

      {/* Settings Dialog: gleiche Konfiguration wie im Idle-State.
          Hier bewusst “immer im Tree”, damit der Dialog beim Öffnen keinen UI-Sprung erzeugt. */}
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
              // Draft-Werte in den Provider übernehmen
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

      {/* Subheader Zeile: Race-Name links, Lap-Infos rechts */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          mb: 1,
          gap: 1,
          minWidth: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
          {/* Name des aktuellen Live-Races */}
          {currentRace?.raceName}
        </Typography>

        <Typography variant="caption" color="text.secondary" noWrap sx={{ textAlign: "right" }}>
          {/* Lap-Text wird inline berechnet:
              - wenn nichts vorhanden: ""
              - wenn beides: "Lap X (Y Laps to Go)"
              - sonst jeweils nur eines */}
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

      {/* Action-Leiste: Sync Toggle + (optional) “create starters” */}
      <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 1, gap: 1, flexWrap: "wrap" }}>
        {/* Sync Toggle:
            - nur aktivierbar, wenn canSync (GREEN/PURPLE) und onSyncEnabledChange existiert
            - wenn aktiv: grün umrandet (kein filled background) */}
        <Tooltip title="Synchronize Live status with PointsScoring" arrow>
          <span>
            <ToggleButton
              size="small"
              value="sync"
              selected={Boolean(syncEnabled)}
              onChange={() => {
                // Guard: falls aus irgendeinem Grund canSync false ist, ignorieren
                if (!canSync) return;
                onSyncEnabledChange?.(!syncEnabled);
              }}
              disabled={!onSyncEnabledChange || !canSync}
              aria-label="Activate Sync"
              sx={{
                ...(syncEnabled && {
                  borderColor: "success.main",
                  color: "success.main",
                  borderWidth: 2,

                  "&.Mui-selected": {
                    borderColor: "success.main",
                    color: "success.main",
                    backgroundColor: "transparent", // nicht “filled”
                  },
                  "&.Mui-selected:hover": {
                    backgroundColor: "action.hover",
                  },
                }),
              }}
            >
              Activate Sync
            </ToggleButton>
          </span>
        </Tooltip>

        {/* Wenn Live-Liste Bibs enthält, die wir nicht in unseren Startern kennen:
            zeige Action-Button, um diese Starter anzulegen (parent callback). */}
        {unknownCount > 0 ? (
          <Tooltip title={`Create ${unknownCount} missing starter(s) from live list`} arrow>
            <span>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={onCreateStarters}
                disabled={!onCreateStarters}
              >
                create starters ({unknownCount})
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </Box>

      {/* Tabelle der aktuellen Live-Positionen */}
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
              {/* Position aus Live-System */}
              <TableCell>{r.position}</TableCell>

              {/* Bib:
                  - Wenn in unknownLiveBibs enthalten => rot + fett (Hinweis: Starter fehlt lokal) */}
              {(() => {
                const bibNum = Number(r.bib);
                const isUnknown = bibNum != null && unknownLiveBibs?.has(bibNum);

                return <TableCell sx={isUnknown ? { color: "error.main", fontWeight: 700 } : undefined}>{r.bib}</TableCell>;
              })()}

              {/* Name: nowrap, um Zeilenhöhe stabil zu halten */}
              <TableCell sx={{ whiteSpace: "nowrap" }}>{r.name}</TableCell>

              {/* Zeittext:
                  - Leader: absolute Zeit (oder Laps)
                  - sonst: Delta oder "+1 Lap" etc.
                  - oder leer bei PURPLE/hideTimes */}
              <TableCell>{r.timeText}</TableCell>
            </TableRow>
          ))}

          {/* Empty state, falls currentRace existiert, aber keine competitors/rows */}
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