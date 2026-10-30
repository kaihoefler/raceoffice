// Control Center (doc/leaderboard-integration/06-frontend.md, section 4)
//
// One page with four cards instead of the four Swing windows:
// Orbits connection · Service · Recorder · Player.
// Status comes live via /ws/status; actions give immediate feedback. Live and replay exclude each
// other: starting a replay disconnects Orbits (the service enforces it, the UI says so).

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import UploadIcon from "@mui/icons-material/Upload";
import type { LeaderboardServiceStatus } from "@raceoffice/domain";
import { absoluteUrl, api, ApiError, setToken, type PersistedConfig, type RecordingInfo } from "../api";
import { orbitsLabel } from "../components/AppHeader";
import { useNow } from "../hooks/useLeaderboardStream";
import { useServiceStatus } from "../hooks/useServiceStatus";

const ENCODINGS = ["windows-1252", "utf-8", "iso-8859-1"];
const SPEEDS = [1, 2, 5, 10, 50];

type Run = (action: () => Promise<unknown>) => Promise<void>;

export function ControlCenterPage() {
  const { status, connected } = useServiceStatus();
  const [error, setError] = useState<string | null>(null);
  const [tokenDialog, setTokenDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [config, setConfig] = useState<PersistedConfig | null>(null);

  const refresh = async () => {
    try {
      const [recs, cfg] = await Promise.all([api.recordings(), api.config()]);
      setRecordings(recs);
      setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Refresh the recording list when a recording stops or a file changes.
  const recorderActive = status?.recorder.active ?? false;
  useEffect(() => {
    void refresh();
  }, [recorderActive]);

  const run: Run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setTokenDialog(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      {!connected ? <Alert severity="error" sx={{ mb: 2 }}>Keine Verbindung zum Leaderboard-Service.</Alert> : null}
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {status?.source === "player" ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          REPLAY aktiv – angezeigt wird eine Aufnahme, keine Live-Daten.
        </Alert>
      ) : null}
      {busy ? <LinearProgress sx={{ mb: 1 }} /> : null}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <OrbitsCard status={status} config={config} run={run} onConfig={setConfig} />
        <ServiceCard status={status} run={run} />
        <RecorderCard status={status} config={config} recordings={recordings} run={run} onChanged={refresh} onConfig={setConfig} />
        <PlayerCard status={status} recordings={recordings} run={run} onChanged={refresh} />
      </Box>

      <TokenDialog open={tokenDialog} onClose={() => setTokenDialog(false)} />
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------

function OrbitsCard(props: {
  status: LeaderboardServiceStatus | null;
  config: PersistedConfig | null;
  run: Run;
  onConfig: (c: PersistedConfig) => void;
}) {
  const { status, config, run, onConfig } = props;
  const client = status?.client;
  const now = useNow(1000);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [encoding, setEncoding] = useState("windows-1252");
  const [history, setHistory] = useState<Array<{ at: number; text: string }>>([]);
  const lastState = useRef<string | null>(null);

  // Initialize the form once from the service.
  useEffect(() => {
    if (client && host === "" && port === "") {
      setHost(client.host);
      setPort(String(client.port));
      setEncoding(client.encoding);
    }
  }, [client, host, port]);

  // Connection history (last 20 state changes) for troubleshooting on race day.
  useEffect(() => {
    if (!client || client.state === lastState.current) return;
    lastState.current = client.state;
    const text = client.state === "retrying" ? `neuer Versuch ${client.retry.attempt}` : orbitsLabel(client.state);
    setHistory((h) => [{ at: Date.now(), text: client.lastError && client.state !== "connected" ? `${text} (${client.lastError})` : text }, ...h].slice(0, 20));
  }, [client]);

  const portNumber = Number(port);
  const valid = host.trim() !== "" && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const live = status?.source === "rmonitor";

  return (
    <Card variant="outlined">
      <CardHeader title="Orbits (live)" subheader="RMonitor-Verbindung zur Zeitnahme" />
      <CardContent>
        <Stack spacing={2}>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <TextField label="Host" size="small" value={host} onChange={(e) => setHost(e.target.value)} sx={{ flex: 2, minWidth: 160 }} error={host.trim() === ""} />
            <TextField
              label="Port"
              size="small"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              sx={{ width: 100 }}
              error={!(Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535)}
            />
            <TextField select label="Encoding" size="small" value={encoding} onChange={(e) => setEncoding(e.target.value)} sx={{ width: 160 }}>
              {ENCODINGS.map((e) => (
                <MenuItem key={e} value={e}>
                  {e}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              variant="contained"
              disabled={!valid}
              onClick={() => run(() => api.connect({ host: host.trim(), port: portNumber, encoding }))}
            >
              {live ? "Übernehmen" : "Verbinden"}
            </Button>
            <Button disabled={!live} onClick={() => run(api.disconnect)}>
              Trennen
            </Button>
            <FormControlLabel
              control={
                <Switch
                  checked={config?.client.autoConnect ?? false}
                  onChange={(e) => run(async () => onConfig(await api.updateConfig({ client: { autoConnect: e.target.checked } })))}
                />
              }
              label="Beim Start verbinden"
            />
          </Box>
          {status?.source === "player" ? (
            <Typography variant="body2" color="warning.main">
              Verbinden beendet das laufende Replay.
            </Typography>
          ) : null}
          {client ? (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Chip
                size="small"
                color={client.state === "connected" ? "success" : client.state === "stopped" ? "default" : client.state === "error" ? "error" : "warning"}
                label={orbitsLabel(client.state)}
              />
              <Typography variant="body2">{client.messagesPerMinute} Nachr./min</Typography>
              {client.lastMessageAt ? (
                <Typography variant="body2" color="text.secondary">
                  letzte vor {formatAgo(now - client.lastMessageAt)}
                </Typography>
              ) : null}
              {client.state === "retrying" && client.retry.nextAttemptAt ? (
                <Typography variant="body2" color="text.secondary">
                  nächster Versuch in {Math.max(0, Math.ceil((client.retry.nextAttemptAt - now) / 1000))} s
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {client?.lastError && client.state !== "connected" ? <Alert severity="warning">{client.lastError}</Alert> : null}
          {history.length ? (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Verlauf
              </Typography>
              <List dense disablePadding sx={{ maxHeight: 140, overflow: "auto" }}>
                {history.map((h, i) => (
                  <ListItem key={i} disableGutters sx={{ py: 0 }}>
                    <ListItemText slotProps={{ primary: { variant: "caption" } }} primary={`${new Date(h.at).toLocaleTimeString("de-DE")} · ${h.text}`} />
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function ServiceCard({ status, run }: { status: LeaderboardServiceStatus | null; run: Run }) {
  const [confirm, setConfirm] = useState(false);
  const endpoints = [
    { label: "REST", url: absoluteUrl("races?filter=current") },
    { label: "WebSocket", url: absoluteUrl("ws/race/current", true) },
  ];
  return (
    <Card variant="outlined">
      <CardHeader
        title="Service"
        subheader={status ? `Version ${status.version} · ${status.mode} · Port ${status.server.port}` : "—"}
      />
      <CardContent>
        <Stack spacing={1.5}>
          {endpoints.map((e) => (
            <Box key={e.label} sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ width: 90, color: "text.secondary" }}>
                {e.label}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                {e.url}
              </Typography>
              <Tooltip title="Kopieren">
                <IconButton size="small" aria-label={`${e.label}-URL kopieren`} onClick={() => void navigator.clipboard?.writeText(e.url)}>
                  <ContentCopyIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
          {status ? (
            <>
              <Typography variant="body2">
                {status.server.wsClients} WebSocket-Clients · {status.server.restRequestsPerMinute} REST-Abfragen/min
              </Typography>
              <Typography variant="body2">
                Aktuelles Rennen:{" "}
                {status.race.currentId !== null ? `#${status.race.currentId} ${status.race.currentName ?? ""} (${status.race.flag ?? "—"})` : "keines"}
              </Typography>
            </>
          ) : null}
          <Box>
            <Button color="warning" variant="outlined" onClick={() => setConfirm(true)}>
              Rennzustand zurücksetzen
            </Button>
          </Box>
        </Stack>
      </CardContent>
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>Rennzustand zurücksetzen?</DialogTitle>
        <DialogContent>Alle gehaltenen Rennen werden verworfen. Orbits sendet laufende Daten danach neu.</DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Abbrechen</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              setConfirm(false);
              void run(api.resetState);
            }}
          >
            Zurücksetzen
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function RecorderCard(props: {
  status: LeaderboardServiceStatus | null;
  config: PersistedConfig | null;
  recordings: RecordingInfo[];
  run: Run;
  onChanged: () => Promise<void>;
  onConfig: (c: PersistedConfig) => void;
}) {
  const { status, config, recordings, run, onChanged, onConfig } = props;
  const now = useNow(1000);
  const [name, setName] = useState("");
  const rec = status?.recorder;
  const playingFile = status?.player.state !== "idle" ? status?.player.file : null;

  return (
    <Card variant="outlined">
      <CardHeader title="Recorder" subheader="Zeichnet die Live-Daten von Orbits auf (Format wie die Java-App)" />
      <CardContent>
        <Stack spacing={2}>
          {rec?.active ? (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Chip color="error" size="small" label={`● REC ${formatDuration(rec.startedAt ? now - rec.startedAt : 0)}`} />
              <Typography variant="body2">
                {rec.lines.toLocaleString("de-DE")} Zeilen · {rec.file}
              </Typography>
              <Button onClick={() => run(async () => {
                await api.stopRecorder();
                await onChanged();
              })}>
                Stop
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. elim-u17" />
              <Button variant="contained" color="error" onClick={() => run(() => api.startRecorder(name.trim() || undefined))}>
                Aufnahme starten
              </Button>
            </Box>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={config?.recorder.autoStart ?? false}
                onChange={(e) => run(async () => onConfig(await api.updateConfig({ recorder: { autoStart: e.target.checked } })))}
              />
            }
            label="Beim Start automatisch aufzeichnen"
          />
          <Box>
            <Typography variant="caption" color="text.secondary">
              Aufnahmen
            </Typography>
            {recordings.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Noch keine Aufnahmen.
              </Typography>
            ) : (
              <List dense disablePadding sx={{ maxHeight: 260, overflow: "auto" }}>
                {recordings.map((r) => (
                  <ListItem
                    key={r.file}
                    disableGutters
                    secondaryAction={
                      <Box>
                        <Tooltip title="Herunterladen">
                          <IconButton size="small" component="a" href={api.recordingUrl(r.file)} download={r.file} aria-label={`${r.file} herunterladen`}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Löschen">
                          <span>
                            <IconButton
                              size="small"
                              disabled={r.file === rec?.file || r.file === playingFile}
                              aria-label={`${r.file} löschen`}
                              onClick={() =>
                                run(async () => {
                                  if (!window.confirm(`${r.file} löschen?`)) return;
                                  await api.deleteRecording(r.file);
                                  await onChanged();
                                })
                              }
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={r.file}
                      secondary={`${formatDuration(r.durationMs)} · ${r.lines.toLocaleString("de-DE")} Zeilen · ${formatSize(r.size)}`}
                      slotProps={{ primary: { variant: "body2", sx: { overflow: "hidden", textOverflow: "ellipsis", pr: 8 } } }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function PlayerCard(props: { status: LeaderboardServiceStatus | null; recordings: RecordingInfo[]; run: Run; onChanged: () => Promise<void> }) {
  const { status, recordings, run, onChanged } = props;
  const player = status?.player;
  const [file, setFile] = useState("");
  const [speed, setSpeed] = useState(1);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file && recordings[0]) setFile(player?.file ?? recordings[0].file);
  }, [recordings, file, player?.file]);

  const state = player?.state ?? "idle";
  const loadedHere = player?.file === file;
  const duration = loadedHere ? (player?.durationMs ?? 0) : (recordings.find((r) => r.file === file)?.durationMs ?? 0);
  const position = loadedHere ? (player?.positionMs ?? 0) : 0;
  const live = status?.source === "rmonitor" && status.client.state !== "stopped";

  const upload = (f: File) =>
    run(async () => {
      const saved = await api.uploadRecording(f.name, f);
      await onChanged();
      setFile(saved.file);
    });

  return (
    <Card variant="outlined">
      <CardHeader title="Player" subheader="Spielt eine Aufnahme ab (Test, Schulung, Nachbereitung)" />
      <CardContent>
        <Stack spacing={2}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <TextField select label="Aufnahme" size="small" value={file} onChange={(e) => setFile(e.target.value)} sx={{ flex: 1, minWidth: 0 }}>
              {recordings.map((r) => (
                <MenuItem key={r.file} value={r.file}>
                  {r.file}
                </MenuItem>
              ))}
            </TextField>
            <input
              ref={uploadRef}
              type="file"
              accept=".txt,text/plain"
              hidden
              aria-label="Aufnahme hochladen"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <Tooltip title="Aufnahme hochladen (auch Java-Recordings)">
              <IconButton onClick={() => uploadRef.current?.click()} aria-label="Hochladen">
                <UploadIcon />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2">Tempo</Typography>
            <ButtonGroup size="small">
              {SPEEDS.map((s) => (
                <Button
                  key={s}
                  variant={(state !== "idle" && loadedHere ? player?.speedup : speed) === s ? "contained" : "outlined"}
                  onClick={() => {
                    setSpeed(s);
                    if (state !== "idle" && loadedHere) void run(() => api.setPlayerSpeed(s));
                  }}
                >
                  {s}×
                </Button>
              ))}
            </ButtonGroup>
          </Box>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {state === "playing" && loadedHere ? (
              <IconButton aria-label="Pause" onClick={() => run(api.pausePlayer)}>
                <PauseIcon />
              </IconButton>
            ) : (
              <IconButton
                aria-label="Abspielen"
                disabled={!file}
                onClick={() => run(() => (state === "paused" && loadedHere ? api.resumePlayer() : api.startPlayer(file, speed)))}
              >
                <PlayArrowIcon />
              </IconButton>
            )}
            <IconButton aria-label="Stop" disabled={state === "idle"} onClick={() => run(api.stopPlayer)}>
              <StopIcon />
            </IconButton>
            <Slider
              size="small"
              min={0}
              max={Math.max(1, duration)}
              value={seekValue ?? position}
              disabled={!loadedHere}
              onChange={(_, v) => setSeekValue(v as number)}
              onChangeCommitted={(_, v) => {
                setSeekValue(null);
                void run(() => api.seekPlayer(v as number));
              }}
              aria-label="Position"
              sx={{ mx: 1 }}
            />
            <Typography variant="body2" sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {formatDuration(seekValue ?? position)} / {formatDuration(duration)}
            </Typography>
          </Box>
          {player?.encoding && loadedHere ? (
            <Typography variant="caption" color="text.secondary">
              Datei-Encoding: {player.encoding}
            </Typography>
          ) : null}
          {live ? (
            <Alert severity="info">Hinweis: Die Live-Verbindung zu Orbits wird während des Replays getrennt.</Alert>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function TokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Steuer-Token</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Der Service verlangt für Steuerbefehle ein Token (LEADERBOARD_CONTROL_TOKEN). Es wird nur für diese Sitzung gespeichert.
        </Typography>
        <TextField autoFocus fullWidth size="small" type="password" label="Token" value={value} onChange={(e) => setValue(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button
          variant="contained"
          disabled={!value}
          onClick={() => {
            setToken(value);
            onClose();
          }}
        >
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function formatAgo(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s` : `${Math.round(ms / 1000)} s`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

