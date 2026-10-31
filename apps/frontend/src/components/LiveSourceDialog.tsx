// LiveSourceDialog
// ----------------
// Settings of the live race status feed ("Race status connection"):
// - Source: automatic (leaderboard service if available, otherwise the classic URL),
//   leaderboard service, Java leaderboard (emergency), custom URL
// - Leaderboard service: status, start/stop (managed mode), Orbits connection, links
// - Advanced: refresh rate, pause
// Source/URL/refresh/pause are applied with "Apply"; service actions take effect immediately.

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Link,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import { useRaceStatus, type LiveSource } from "../providers/RaceStatusProvider";
import {
  LEADERBOARD_CONTROL_URL,
  LEADERBOARD_UI_URL,
  leaderboardServiceClient,
} from "../services/leaderboardServiceClient";

type Props = { open: boolean; onClose: () => void };

export default function LiveSourceDialog({ open, onClose }: Props) {
  const rs = useRaceStatus();
  const [source, setSource] = useState<LiveSource>(rs.source);
  const [url, setUrl] = useState(rs.url);
  const [javaUrl, setJavaUrl] = useState(rs.javaUrl);
  const [pollMs, setPollMs] = useState<number>(rs.pollIntervalMs);
  const [paused, setPaused] = useState<boolean>(rs.paused);

  // Sync drafts with the current settings whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSource(rs.source);
    setUrl(rs.url);
    setJavaUrl(rs.javaUrl);
    setPollMs(rs.pollIntervalMs);
    setPaused(rs.paused);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const apply = () => {
    rs.setJavaUrl(javaUrl);
    if (source === "custom") rs.setUrl(url);
    else rs.setSource(source);
    rs.setPollIntervalMs(pollMs);
    rs.setPaused(paused);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Race status connection</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Source
            </Typography>
            <RadioGroup value={source} onChange={(e) => setSource(e.target.value as LiveSource)}>
              <FormControlLabel
                value="auto"
                control={<Radio size="small" />}
                label="Automatic – leaderboard service if available, otherwise Java leaderboard URL"
              />
              <FormControlLabel value="service" control={<Radio size="small" />} label="Leaderboard service (RaceOffice)" />
              <FormControlLabel value="java" control={<Radio size="small" />} label="Java leaderboard (emergency)" />
              <FormControlLabel value="custom" control={<Radio size="small" />} label="Custom URL" />
            </RadioGroup>
          </Box>

          {source === "java" || source === "auto" ? (
            <TextField
              label="Java leaderboard URL"
              value={javaUrl}
              onChange={(e) => setJavaUrl(e.target.value)}
              fullWidth
              size="small"
              helperText="RMonitorLeaderboard, polled directly by this browser"
            />
          ) : null}

          {source === "custom" ? (
            <TextField label="URL" value={url} onChange={(e) => setUrl(e.target.value)} fullWidth size="small" />
          ) : null}

          <Divider />
          <ServiceSection />
          <Divider />

          <TextField
            label="Refresh rate (ms)"
            type="number"
            value={pollMs}
            onChange={(e) => setPollMs(Number(e.target.value))}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { min: 250, max: 60000, step: 250 } }}
            helperText="Polling only (min 250 ms, max 60000 ms). The leaderboard service pushes updates."
          />

          <FormControlLabel control={<Switch checked={paused} onChange={(e) => setPaused(e.target.checked)} />} label="Paused" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={apply}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Status and control of the leaderboard service behind the RaceOffice server. */
function ServiceSection() {
  const { leaderboard, refreshLeaderboard } = useRaceStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = leaderboard?.service?.client;
  const [host, setHost] = useState(client?.host ?? "");
  const [port, setPort] = useState(String(client?.port ?? 50000));

  useEffect(() => {
    if (client && !host) {
      setHost(client.host);
      setPort(String(client.port));
    }
  }, [client, host]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refreshLeaderboard();
    }
  };

  if (!leaderboard) {
    return (
      <Typography variant="body2" color="text.secondary">
        Leaderboard service: no information from the RaceOffice server (not reachable, or not selected as source).
      </Typography>
    );
  }

  const service = leaderboard.service;
  const managed = leaderboard.mode === "managed";
  const processState = leaderboard.process.state;
  const running = managed ? processState === "running" : leaderboard.available;
  const orbitsState = service?.client.state ?? "unknown";
  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;

  return (
    <Stack spacing={1.5}>
      <Typography variant="overline" color="text.secondary">
        Leaderboard service
      </Typography>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Chip size="small" label={`mode: ${leaderboard.mode}`} />
        <Chip
          size="small"
          color={running ? "success" : processState === "crashed" ? "error" : "default"}
          label={managed ? `service: ${processState}` : leaderboard.available ? "service: reachable" : "service: unreachable"}
        />
        {service ? (
          <>
            <Chip
              size="small"
              color={orbitsState === "connected" ? "success" : orbitsState === "stopped" ? "default" : "warning"}
              label={`Orbits: ${orbitsState}`}
            />
            <Chip
              size="small"
              color={service.source === "player" ? "warning" : "default"}
              label={service.source === "player" ? "REPLAY" : `source: ${service.source}`}
            />
            <Chip size="small" color={service.recorder.active ? "error" : "default"} label={service.recorder.active ? "● REC" : "not recording"} />
          </>
        ) : null}
      </Box>

      {leaderboard.mode === "external" ? (
        <Typography variant="body2" color="text.secondary">
          The RaceOffice server forwards to {leaderboard.externalUrl ?? "—"} (e.g. the Java leaderboard). Control is only
          available in managed mode.
        </Typography>
      ) : null}

      {managed ? (
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button size="small" variant="outlined" disabled={busy || running} onClick={() => run(leaderboardServiceClient.startService)}>
            Start service
          </Button>
          <Button size="small" variant="outlined" disabled={busy || !running} onClick={() => run(leaderboardServiceClient.stopService)}>
            Stop service
          </Button>
        </Box>
      ) : null}

      {managed && running && service ? (
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
          <TextField label="Orbits host" size="small" value={host} onChange={(e) => setHost(e.target.value)} sx={{ flex: 2, minWidth: 160 }} />
          <TextField
            label="Port"
            size="small"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            error={!portValid}
            sx={{ flex: 1, minWidth: 90 }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={busy || !portValid || !host.trim()}
            onClick={() => run(() => leaderboardServiceClient.connectOrbits({ host: host.trim(), port: portNumber }))}
            sx={{ mt: 0.5 }}
          >
            Connect
          </Button>
          <Button
            size="small"
            disabled={busy || orbitsState === "stopped"}
            onClick={() => run(leaderboardServiceClient.disconnectOrbits)}
            sx={{ mt: 0.5 }}
          >
            Disconnect
          </Button>
        </Box>
      ) : null}

      {service?.client.lastError && orbitsState !== "connected" ? (
        <Typography variant="caption" color="warning.main">
          Orbits: {service.client.lastError}
        </Typography>
      ) : null}
      {leaderboard.process.lastError && managed && !running ? (
        <Typography variant="caption" color="error.main">
          {leaderboard.process.lastError}
        </Typography>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      {running ? (
        <Box sx={{ display: "flex", gap: 2 }}>
          <Link href={LEADERBOARD_UI_URL} target="_blank" rel="noopener">
            Open leaderboard
          </Link>
          <Link href={LEADERBOARD_CONTROL_URL} target="_blank" rel="noopener">
            Control center
          </Link>
        </Box>
      ) : null}
    </Stack>
  );
}
