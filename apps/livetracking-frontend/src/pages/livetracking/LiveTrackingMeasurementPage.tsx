// Livetracking – Messung (doc/timing-architecture.md, sections 4 and 7)
//
// LiveTracking is a consumer of the timing layer: a measurement is a window on the stored
// passings of the setup's decoders.
// - Start / Stop: Start after Stop continues the measurement (the pause does not count)
// - "Messung zurücksetzen": discards the results of this measurement only; passings stay
// - Decoders are connected in the timing Control Center; this page shows whether the setup's
//   decoders are connected and offers to connect them

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  canIssueLiveTrackingCommand,
  createLiveTrackingCommand,
  enqueueLiveTrackingCommand,
  getSetupDecoderIds,
  makeLiveTrackingListDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  setTimingDecoderConnected,
  type LiveTrackingCommandIntent,
  type LiveTrackingListDocument,
  type LiveTrackingMode,
  type LiveTrackingResultsDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
} from "@raceoffice/domain";
import { Link as RouterLink } from "react-router-dom";

import { ConfirmDialog } from "../../components/common/Dialogs";
import LiveTrackingLiveBoard from "../../components/livetracking/LiveTrackingLiveBoard";
import { ParticipantPoolsSummary } from "../../components/livetracking/ParticipantPoolsSummary";
import { liveStateDisplayName } from "../../components/livetracking/liveTrackingDisplayName";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";
import { decoderHealth, formatAgo, HEALTH_COLOR, HEALTH_LABEL, nowIso, useNow, useTimingDocs, useWorkerState } from "../../timing/timingShared";

const STATE_LABEL: Record<LiveTrackingSessionDocument["state"], string> = { idle: "bereit", running: "läuft", error: "Fehler" };
const STATE_COLOR: Record<LiveTrackingSessionDocument["state"], "default" | "success" | "error"> = { idle: "default", running: "success", error: "error" };

export default function LiveTrackingMeasurementPage() {
  const now = useNow(1000);
  const { data: session, update: updateSession } = useRealtimeDoc<LiveTrackingSessionDocument>(makeLiveTrackingSessionDocId());
  const { data: list } = useRealtimeDoc<LiveTrackingListDocument>(makeLiveTrackingListDocId());
  const { data: results } = useRealtimeDoc<LiveTrackingResultsDocument>(makeLiveTrackingResultsDocId());
  const setupId = String(session?.setupId ?? "").trim();
  const { data: setup } = useRealtimeDoc<LiveTrackingSetupDocument>(setupId ? makeLiveTrackingSetupDocId(setupId) : null);
  const timing = useTimingDocs();
  const { online } = useWorkerState(now);
  const [resetOpen, setResetOpen] = useState(false);

  const state = session?.state ?? "idle";
  const running = state === "running";
  const busy = (session?.commandQueue ?? []).some((c) => c.status === "queued" || c.status === "running");
  const segments = session?.measurement?.segments ?? [];
  const openSegment = segments.find((s) => s.toSeq === null);

  const setupDecoders = useMemo(() => {
    if (!setup) return [];
    return getSetupDecoderIds(setup).map((id) => ({
      id,
      decoder: timing.decoders.find((d) => d.id === id) ?? null,
      wanted: timing.connectedIds.includes(id),
      status: timing.statusById.get(id),
    }));
  }, [setup, timing.decoders, timing.connectedIds, timing.statusById]);
  const notConnected = setupDecoders.filter((d) => !d.wanted || decoderHealth(d.status, now) !== "connected");

  const timingPointLabelById = useMemo(() => new Map(normalizeTimingPoints(setup?.track.timingPoints ?? []).map((p) => [p.id, p.name || p.id])), [setup]);

  const queue = (intent: LiveTrackingCommandIntent) =>
    updateSession((prev) => {
      const t = nowIso();
      return enqueueLiveTrackingCommand(prev, createLiveTrackingCommand({ id: crypto.randomUUID(), intent, requestedAt: t }), t);
    });

  const connectSetupDecoders = () =>
    timing.updateConnection((prev) => setupDecoders.reduce((doc, d) => (d.decoder ? setTimingDecoderConnected(doc, d.id, true, nowIso()) : doc), prev));

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader title="Messung" action={<Chip label={STATE_LABEL[state]} color={STATE_COLOR[state]} sx={{ mt: 1, mr: 1 }} />} />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ alignItems: { md: "flex-start" } }}>
              {/* The setup is activated in the timing Control Center – one place to choose. */}
              <TextField
                size="small"
                label="Setup"
                value={(list?.setups ?? []).find((s) => s.setupId === setupId)?.name || setup?.name || (setupId ? setupId : "— kein Setup aktiv —")}
                slotProps={{ input: { readOnly: true } }}
                sx={{ minWidth: 260 }}
                helperText="Wird im Control Center aktiviert"
              />
              <Button size="small" component={RouterLink} to="/timing/control" sx={{ mt: 0.5 }}>
                Setup wählen
              </Button>
              <TextField
                select
                size="small"
                label="Modus"
                value={session?.mode ?? "training"}
                disabled={running || busy}
                onChange={(e) => updateSession((prev) => ({ ...prev, mode: e.target.value as LiveTrackingMode, updatedAt: nowIso() }))}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="training">Training</MenuItem>
                <MenuItem value="qualifying">Qualifying</MenuItem>
              </TextField>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              {running ? (
                <Button variant="contained" color="warning" disabled={busy || !session} onClick={() => queue("stop")}>
                  Messung stoppen
                </Button>
              ) : (
                <Button variant="contained" disabled={busy || !session || !setupId || !canIssueLiveTrackingCommand(state, "start")} onClick={() => queue("start")}>
                  {segments.length > 0 ? "Messung fortsetzen" : "Messung starten"}
                </Button>
              )}
              <Button color="error" variant="outlined" disabled={busy || !session || (segments.length === 0 && state !== "error")} onClick={() => setResetOpen(true)}>
                Messung zurücksetzen …
              </Button>
              <Typography variant="body2" color="text.secondary">
                {openSegment ? `läuft seit ${formatAgo(openSegment.startedAt, now).replace("vor ", "")}` : segments.length > 0 ? `${segments.length} Abschnitt(e), gestoppt` : "noch nicht gestartet"}
              </Typography>
            </Stack>

            {!online ? <Alert severity="warning">Der Worker läuft nicht – ohne ihn werden keine Ergebnisse berechnet. Starte ihn im Control Center.</Alert> : null}
            {session?.lastError ? <Alert severity="error">{session.lastError}</Alert> : null}

            {setup && setupDecoders.length > 0 ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Decoder des Setups
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                  {setupDecoders.map((d) => {
                    const health = d.wanted ? decoderHealth(d.status, now) : "disconnected";
                    return <Chip key={d.id} label={`${d.decoder?.name ?? d.id}: ${d.decoder ? HEALTH_LABEL[health] : "nicht im Register"}`} color={d.decoder ? HEALTH_COLOR[health] : "error"} variant="outlined" />;
                  })}
                  {notConnected.some((d) => d.decoder && !d.wanted) ? (
                    <Button size="small" onClick={connectSetupDecoders}>
                      Decoder des Setups verbinden
                    </Button>
                  ) : null}
                  <Button size="small" component={RouterLink} to="/timing/control">
                    Control Center
                  </Button>
                </Stack>
                {running && notConnected.length > 0 ? (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Die Messung läuft, aber nicht alle Decoder des Setups sind verbunden – deren Durchfahrten fehlen.
                  </Alert>
                ) : null}
              </Box>
            ) : null}

            {setup ? <ParticipantPoolsSummary setup={setup} manageable /> : null}

            <Stack direction="row" spacing={3}>
              <Typography variant="body2">Fahrer:innen mit Durchfahrt: {(results?.athleteLiveStates ?? []).length}</Typography>
              <Typography variant="body2">Unbekannte Transponder: {(results?.unknownTransponders ?? []).join(", ") || "—"}</Typography>
              <Typography variant="body2">Verworfene Durchfahrten: {(results?.invalidEvents ?? []).length}</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Live Board" />
        <Divider />
        <CardContent>
          <LiveTrackingLiveBoard
            athleteLiveStates={results?.athleteLiveStates ?? []}
            resolveDisplayName={liveStateDisplayName}
            variant="split-inline"
            timingPointLabelById={timingPointLabelById}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        title="Messung zurücksetzen"
        danger
        confirmLabel="Zurücksetzen"
        text={
          running
            ? "Die Ergebnisse dieser Messung werden verworfen, die Messung beginnt sofort neu. Gespeicherte Passings bleiben erhalten."
            : "Die Ergebnisse dieser Messung werden verworfen. Gespeicherte Passings bleiben erhalten."
        }
        onConfirm={() => queue("reset")}
        onClose={() => setResetOpen(false)}
      />
    </Box>
  );
}
