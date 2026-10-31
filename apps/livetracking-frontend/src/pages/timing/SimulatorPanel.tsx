// Decoder simulation (tab on the decoder page).
//
// ammc-sim simulates a MyLaps decoder on the machine running the timing worker: it listens on
// the MyLaps port 5403, so only one simulator can run at a time. It replaces hardware – a P3 or
// AMMC decoder in the register with address 127.0.0.1 connects to it like to a real decoder.

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  makeTimingDecoderAddressId,
  normalizeSimulatorDecoderId,
  P3_DEFAULT_PORT,
  simulatorPassingDelayForLap,
  TIMING_SIMULATOR_DOC_ID,
  type TimingDecoder,
  type TimingSimulatorDocument,
} from "@raceoffice/domain";

import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";
import { BACKEND_LABEL, nowIso, useNow, useTimingDocs, useWorkerState } from "../../timing/timingShared";

type Draft = { decoderId: string; transponders: string; passingDelay: string; startupDelaySecs: string; announceIp: string };

const STATE_LABEL = { stopped: "gestoppt", starting: "startet …", running: "läuft", error: "Fehler" } as const;
const STATE_COLOR = { stopped: "default", starting: "info", running: "success", error: "error" } as const;

export function SimulatorPanel() {
  const now = useNow(5000);
  const { online } = useWorkerState(now);
  const { data: doc, update } = useRealtimeDoc<TimingSimulatorDocument>(TIMING_SIMULATOR_DOC_ID);
  const { decoders, updateDecoders, statusDoc } = useTimingDocs();
  const status = statusDoc?.simulator ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lap, setLap] = useState({ lengthM: "200", speedKmh: "30" });

  useEffect(() => {
    if (!doc) return;
    setDraft({
      decoderId: doc.config.decoderId,
      transponders: doc.config.transponderIds.join(", "),
      passingDelay: doc.config.passingDelay,
      startupDelaySecs: String(doc.config.startupDelaySecs),
      announceIp: doc.config.announceIp ?? "",
    });
  }, [doc]);

  if (!doc || !draft) return <Typography color="text.secondary">Lade …</Typography>;

  const transponderIds = draft.transponders.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const config = {
    decoderId: normalizeSimulatorDecoderId(draft.decoderId),
    transponderIds,
    passingDelay: draft.passingDelay.trim(),
    startupDelaySecs: Math.max(0, Number(draft.startupDelaySecs) || 0),
    announceIp: draft.announceIp.trim() || null,
  };
  const dirty = JSON.stringify(config) !== JSON.stringify(doc.config);
  const delayValid = /^\d+(\s*-\s*\d+)?$/.test(config.passingDelay);
  const state = doc.running ? (status?.state ?? "starting") : "stopped";

  const save = (running = doc.running) => update((prev) => ({ ...prev, running, config, updatedAt: nowIso() }));
  const simulatorDecoders = decoders.filter((d) => d.ip === "127.0.0.1");

  const addDecoder = (backend: TimingDecoder["backend"]) => {
    const port = P3_DEFAULT_PORT;
    const decoder: TimingDecoder = {
      id: makeTimingDecoderAddressId(backend, "127.0.0.1", port),
      name: `Simulator (${BACKEND_LABEL[backend]})`,
      backend,
      ip: "127.0.0.1",
      port,
      clockOffsetSecs: 0,
      hardwareId: null,
      updatedAt: nowIso(),
    };
    updateDecoders((prev) => (prev.decoders.some((d) => d.id === decoder.id) ? prev : { ...prev, decoders: [...prev.decoders, decoder], updatedAt: nowIso() }));
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title="Decoder-Simulation"
          subheader="Simulierter MyLaps-Decoder auf dem Rechner des Workers (Port 5403, nur einer gleichzeitig)"
          action={<Chip label={STATE_LABEL[state]} color={STATE_COLOR[state]} sx={{ mt: 1, mr: 1 }} />}
        />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {doc.running ? (
                <Button variant="outlined" color="warning" onClick={() => save(false)}>
                  Simulator stoppen
                </Button>
              ) : (
                <Button variant="contained" disabled={transponderIds.length === 0 || !delayValid} onClick={() => save(true)}>
                  Simulator starten
                </Button>
              )}
              <Button variant="outlined" disabled={!dirty || !delayValid} onClick={() => save()}>
                {doc.running ? "Übernehmen (startet neu)" : "Einstellungen speichern"}
              </Button>
            </Stack>
            {!online && doc.running ? <Alert severity="info">Der Worker läuft nicht. Der Simulator startet, sobald der Worker gestartet ist.</Alert> : null}
            {status?.lastError && doc.running ? <Alert severity="error">{status.lastError}</Alert> : null}
            {status?.lastLine && doc.running ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                {status.lastLine}
              </Typography>
            ) : null}

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                size="small"
                label="Decoder-ID (6 Hex-Zeichen)"
                value={draft.decoderId}
                onChange={(e) => setDraft({ ...draft, decoderId: e.target.value })}
                helperText={config.decoderId !== draft.decoderId ? `wird gesendet als ${config.decoderId}` : " "}
              />
              <TextField
                size="small"
                label="Startverzögerung (s)"
                value={draft.startupDelaySecs}
                onChange={(e) => setDraft({ ...draft, startupDelaySecs: e.target.value })}
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                helperText=" "
              />
              <TextField
                size="small"
                label="Im Netzwerk-Scan sichtbar unter IP"
                value={draft.announceIp}
                onChange={(e) => setDraft({ ...draft, announceIp: e.target.value })}
                helperText="leer = nicht sichtbar"
              />
            </Stack>
            <TextField
              size="small"
              label="Transponder (kommagetrennt)"
              value={draft.transponders}
              onChange={(e) => setDraft({ ...draft, transponders: e.target.value })}
              helperText={`${transponderIds.length} Transponder`}
              fullWidth
            />
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "flex-start" } }}>
              <TextField
                size="small"
                label="Abstand der Passings (ms, von-bis)"
                value={draft.passingDelay}
                error={!delayValid}
                onChange={(e) => setDraft({ ...draft, passingDelay: e.target.value })}
                helperText={delayValid ? "Zeit zwischen zwei Durchfahrten, z. B. 24000-25000" : "Zahl oder Bereich „von-bis“"}
              />
              <Typography variant="body2" sx={{ pt: 1 }}>
                oder aus
              </Typography>
              <TextField size="small" label="Rundenlänge (m)" value={lap.lengthM} onChange={(e) => setLap({ ...lap, lengthM: e.target.value })} sx={{ width: 140 }} />
              <TextField size="small" label="Tempo (km/h)" value={lap.speedKmh} onChange={(e) => setLap({ ...lap, speedKmh: e.target.value })} sx={{ width: 120 }} />
              <Button size="small" sx={{ mt: 0.5 }} onClick={() => setDraft({ ...draft, passingDelay: simulatorPassingDelayForLap(Number(lap.lengthM) || 0, Number(lap.speedKmh) || 30) })}>
                berechnen
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Decoder für den Simulator" subheader="Der Simulator wird wie echte Hardware über einen Decoder mit Adresse 127.0.0.1 verbunden" />
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            {simulatorDecoders.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Noch kein Decoder mit Adresse 127.0.0.1.
              </Typography>
            ) : (
              simulatorDecoders.map((d) => (
                <Typography key={d.id} variant="body2">
                  {d.name} · {BACKEND_LABEL[d.backend]} · 127.0.0.1{d.backend === "p3" ? `:${d.port}` : ""}
                </Typography>
              ))
            )}
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" onClick={() => addDecoder("p3")}>
                P3-Decoder anlegen
              </Button>
              <Button size="small" variant="outlined" onClick={() => addDecoder("ammc")}>
                AMMC-Decoder anlegen
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Verbunden wird er wie jeder Decoder im Control Center.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
