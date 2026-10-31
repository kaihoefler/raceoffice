// Control Center card "Worker": start/stop the timing worker.
//
// Stopping asks whether a running measurement and the decoder simulator should end too.
// Otherwise their wish ("läuft") stays stored and both resume with the next worker start.
// Order matters: the measurement is stopped by the worker itself (stop command), so the stop is
// queued first and the worker is stopped once the measurement reports idle (or after a timeout).

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import {
  createLiveTrackingCommand,
  enqueueLiveTrackingCommand,
  makeLiveTrackingSessionDocId,
  TIMING_SIMULATOR_DOC_ID,
  type LiveTrackingSessionDocument,
  type TimingSimulatorDocument,
} from "@raceoffice/domain";

import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";
import { nowIso, postJson, type useWorkerState } from "../../timing/timingShared";

/** How long stopping waits for the measurement to report idle before stopping the worker anyway. */
export const MEASUREMENT_STOP_TIMEOUT_MS = 5000;

export function WorkerCard({ online, runtime }: { online: boolean; runtime: ReturnType<typeof useWorkerState>["runtime"] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stopMeasurement, setStopMeasurement] = useState(true);
  const [stopSimulator, setStopSimulator] = useState(true);

  const { data: session, update: updateSession } = useRealtimeDoc<LiveTrackingSessionDocument>(makeLiveTrackingSessionDocId());
  const { data: simulator, update: updateSimulator } = useRealtimeDoc<TimingSimulatorDocument>(TIMING_SIMULATOR_DOC_ID);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const measurementRunning = session?.state === "running";
  const simulatorRunning = simulator?.running === true;

  const post = async (action: "start" | "stop") => {
    try {
      await postJson(`/live-tracking/worker/${action}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    await post("start");
    setBusy(false);
  };

  const stop = async (withMeasurement: boolean, withSimulator: boolean) => {
    setBusy(true);
    setError(null);
    if (withSimulator) updateSimulator((prev) => ({ ...prev, running: false, updatedAt: nowIso() }));
    if (withMeasurement && sessionRef.current?.state === "running") {
      updateSession((prev) => {
        const t = nowIso();
        return enqueueLiveTrackingCommand(prev, createLiveTrackingCommand({ id: crypto.randomUUID(), intent: "stop", requestedAt: t }), t);
      });
      const deadline = Date.now() + MEASUREMENT_STOP_TIMEOUT_MS;
      while (sessionRef.current?.state === "running" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (sessionRef.current?.state === "running") {
        setError("Die Messung hat nicht rechtzeitig gestoppt – sie läuft beim nächsten Start des Workers weiter.");
      }
    }
    await post("stop");
    setBusy(false);
  };

  const onStopClick = () => {
    if (!measurementRunning && !simulatorRunning) {
      void stop(false, false);
      return;
    }
    setStopMeasurement(true);
    setStopSimulator(true);
    setDialogOpen(true);
  };

  return (
    <Card variant="outlined">
      <CardHeader
        title="Worker"
        subheader="Prozess, der die Decoder anbindet und die Passings speichert"
        action={<Chip label={online ? "läuft" : "aus"} color={online ? "success" : "default"} sx={{ mt: 1, mr: 1 }} />}
      />
      <Divider />
      <CardContent>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
          {online ? (
            <Button variant="outlined" color="warning" disabled={busy} onClick={onStopClick}>
              {busy ? "Stoppe …" : "Worker stoppen"}
            </Button>
          ) : (
            <Button variant="contained" disabled={busy} onClick={() => void start()}>
              Worker starten
            </Button>
          )}
          <Typography variant="body2" color="text.secondary">
            {online ? `PID ${runtime?.workerProcessId ?? "—"} auf ${runtime?.workerHost ?? "—"}` : "Ohne Worker werden keine Decoder verbunden."}
          </Typography>
        </Stack>
        {error ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </CardContent>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth aria-labelledby="worker-stop-title">
        <DialogTitle id="worker-stop-title">Worker stoppen</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            Was nicht beendet wird, läuft beim nächsten Start des Workers automatisch weiter.
          </DialogContentText>
          {measurementRunning ? (
            <FormControlLabel
              control={<Checkbox checked={stopMeasurement} onChange={(e) => setStopMeasurement(e.target.checked)} />}
              label="Laufende Messung stoppen"
            />
          ) : null}
          {simulatorRunning ? (
            <FormControlLabel
              control={<Checkbox checked={stopSimulator} onChange={(e) => setStopSimulator(e.target.checked)} />}
              label="Decoder-Simulation beenden"
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              setDialogOpen(false);
              void stop(measurementRunning && stopMeasurement, simulatorRunning && stopSimulator);
            }}
          >
            Worker stoppen
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
