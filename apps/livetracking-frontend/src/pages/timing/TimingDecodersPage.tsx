// Zeitmessung – Decoder: the register of physical decoders (doc/timing-architecture.md, 2.2).
//
// A decoder has a stable id: the hardware id it reports (P3, taken over from the network scan)
// or one derived from its address. Passings are stored per decoder id; setups only reference it.
// Connection data and clock offset live here, not in the setups. The second tab controls the
// decoder simulator (a simulated MyLaps decoder, connected through a decoder at 127.0.0.1).

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  makeTimingDecoderAddressId,
  P3_DEFAULT_PORT,
  type TimingDecoder,
  type TimingDecoderBackend,
} from "@raceoffice/domain";

import { ConfirmDialog } from "../../components/common/Dialogs";
import { SimulatorPanel } from "./SimulatorPanel";
import { BACKEND_LABEL, nowIso, useTimingDocs } from "../../timing/timingShared";

type DiscoveredDecoder = { ip: string; port: number; decoderId: string | null; decoderType: string | null; firmwareVersion: string | null };

type Draft = {
  /** Existing id when editing; null for a new decoder. */
  id: string | null;
  name: string;
  backend: TimingDecoderBackend;
  ip: string;
  port: string;
  clockOffsetSecs: string;
  hardwareId: string | null;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  backend: "p3",
  ip: "",
  port: String(P3_DEFAULT_PORT),
  clockOffsetSecs: "0",
  hardwareId: null,
});

function toDraft(d: TimingDecoder): Draft {
  return {
    id: d.id,
    name: d.name,
    backend: d.backend,
    ip: d.ip,
    port: String(d.port),
    clockOffsetSecs: String(d.clockOffsetSecs),
    hardwareId: d.hardwareId,
  };
}

const parseNumber = (v: string) => Number(String(v).trim().replace(",", "."));

function draftProblems(draft: Draft): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push("Name fehlt");
  if (!draft.ip.trim()) problems.push("IP-Adresse fehlt");
  const port = parseNumber(draft.port);
  // AMMC: the converter reaches the decoder on 5403; its local port is assigned by the worker.
  if (draft.backend === "p3" && (!Number.isInteger(port) || port < 1 || port > 65535)) problems.push("Port muss zwischen 1 und 65535 liegen");
  if (!Number.isFinite(parseNumber(draft.clockOffsetSecs))) problems.push("Uhr-Offset ist keine Zahl");
  return problems;
}

function fromDraft(draft: Draft): TimingDecoder {
  const port = draft.backend === "ammc" ? P3_DEFAULT_PORT : parseNumber(draft.port);
  return {
    id: draft.id ?? draft.hardwareId ?? makeTimingDecoderAddressId(draft.backend, draft.ip.trim(), port),
    name: draft.name.trim(),
    backend: draft.backend,
    ip: draft.ip.trim(),
    port,
    clockOffsetSecs: parseNumber(draft.clockOffsetSecs) || 0,
    hardwareId: draft.hardwareId,
    updatedAt: nowIso(),
  };
}

export default function TimingDecodersPage() {
  const [tab, setTab] = useState<"decoders" | "simulation">("decoders");
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Tabs value={tab} onChange={(_, v: "decoders" | "simulation") => setTab(v)} aria-label="Decoder-Bereiche">
        <Tab value="decoders" label="Decoder" />
        <Tab value="simulation" label="Simulation" />
      </Tabs>
      {tab === "decoders" ? <DecoderRegister /> : <SimulatorPanel />}
    </Box>
  );
}

function DecoderRegister() {
  const { decoders, updateDecoders, connectedIds, writeError } = useTimingDocs();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<TimingDecoder | null>(null);
  const [scan, setScan] = useState<{ loading: boolean; error: string | null; found: DiscoveredDecoder[] | null }>({ loading: false, error: null, found: null });

  const save = (d: Draft) => {
    const decoder = fromDraft(d);
    updateDecoders((prev) => {
      const others = prev.decoders.filter((x) => x.id !== decoder.id);
      const index = prev.decoders.findIndex((x) => x.id === decoder.id);
      const list = [...others];
      list.splice(index >= 0 ? index : list.length, 0, decoder);
      return { ...prev, decoders: list, updatedAt: nowIso() };
    });
    setDraft(null);
  };

  const runScan = async () => {
    setScan({ loading: true, error: null, found: null });
    try {
      const json = (await (await fetch("/live-tracking/p3-discovery/scan?timeoutMs=3000")).json()) as { ok: boolean; decoders?: DiscoveredDecoder[]; message?: string };
      setScan({ loading: false, error: json.ok ? null : (json.message ?? "Scan fehlgeschlagen"), found: json.decoders ?? [] });
    } catch (err) {
      setScan({ loading: false, error: err instanceof Error ? err.message : String(err), found: null });
    }
  };

  const known = new Set(decoders.flatMap((d) => [d.id, d.hardwareId ?? ""]));

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title="Decoder"
          subheader="Physische Decoder, unabhängig von Setups. Passings werden je Decoder gespeichert."
          action={
            <Button variant="contained" sx={{ mt: 1, mr: 1 }} onClick={() => setDraft(emptyDraft())}>
              Decoder anlegen
            </Button>
          }
        />
        <Divider />
        <CardContent>
          {writeError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              Änderung wurde vom Server nicht übernommen: {writeError}
            </Alert>
          ) : null}
          {decoders.length === 0 ? (
            <Typography color="text.secondary">Noch keine Decoder angelegt.</Typography>
          ) : (
            <Table size="small" aria-label="Decoder-Register">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Typ</TableCell>
                  <TableCell>Adresse</TableCell>
                  <TableCell>Uhr-Offset</TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {decoders.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>{BACKEND_LABEL[d.backend]}</TableCell>
                    <TableCell>
                      {d.backend === "ammc" ? d.ip : `${d.ip}:${d.port}`}
                    </TableCell>
                    <TableCell>{d.clockOffsetSecs ? `${d.clockOffsetSecs} s` : "—"}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{d.id}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" aria-label={`${d.name} bearbeiten`} onClick={() => setDraft(toDraft(d))}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label={`${d.name} löschen`} disabled={connectedIds.includes(d.id)} onClick={() => setDeleting(d)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="P3-Decoder im Netzwerk suchen"
          action={
            <Button variant="outlined" sx={{ mt: 1, mr: 1 }} disabled={scan.loading} onClick={() => void runScan()}>
              {scan.loading ? "Suche …" : "Suchen"}
            </Button>
          }
        />
        <Divider />
        <CardContent>
          {scan.error ? <Alert severity="error">{scan.error}</Alert> : null}
          {scan.found && scan.found.length === 0 ? <Typography color="text.secondary">Keine P3-Decoder gefunden.</Typography> : null}
          {scan.found && scan.found.length > 0 ? (
            <Table size="small" aria-label="Gefundene P3-Decoder">
              <TableHead>
                <TableRow>
                  <TableCell>IP</TableCell>
                  <TableCell>Hardware-ID</TableCell>
                  <TableCell>Typ</TableCell>
                  <TableCell>Firmware</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {scan.found.map((f) => {
                  const already = known.has(f.decoderId ?? "") || known.has(makeTimingDecoderAddressId("p3", f.ip, P3_DEFAULT_PORT));
                  return (
                    <TableRow key={f.ip}>
                      <TableCell>{f.ip}</TableCell>
                      <TableCell>{f.decoderId ?? "—"}</TableCell>
                      <TableCell>{f.decoderType ?? "—"}</TableCell>
                      <TableCell>{f.firmwareVersion ?? "—"}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          disabled={already}
                          onClick={() =>
                            setDraft({ ...emptyDraft(), name: f.decoderType ? `${f.decoderType} ${f.ip}` : f.ip, ip: f.ip, port: String(f.port || P3_DEFAULT_PORT), hardwareId: f.decoderId })
                          }
                        >
                          {already ? "bekannt" : "Übernehmen"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {draft ? <DecoderDialog draft={draft} onCancel={() => setDraft(null)} onSave={save} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        title="Decoder löschen"
        danger
        confirmLabel="Löschen"
        text={`„${deleting?.name}“ wird aus dem Register entfernt. Gespeicherte Passings bleiben erhalten; Setups, die ihn verwenden, müssen neu zugeordnet werden.`}
        onConfirm={() => deleting && updateDecoders((prev) => ({ ...prev, decoders: prev.decoders.filter((d) => d.id !== deleting.id), updatedAt: nowIso() }))}
        onClose={() => setDeleting(null)}
      />
    </Box>
  );
}

function DecoderDialog(props: { draft: Draft; onCancel: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState(props.draft);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const problems = draftProblems(d);
  return (
    <Dialog open onClose={props.onCancel} maxWidth="sm" fullWidth aria-labelledby="decoder-dialog-title">
      <DialogTitle id="decoder-dialog-title">{d.id ? "Decoder bearbeiten" : "Decoder anlegen"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField size="small" label="Name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
          <TextField
            size="small"
            select
            label="Typ"
            value={d.backend}
            disabled={d.id !== null}
            onChange={(e) => {
              const backend = e.target.value as TimingDecoderBackend;
              set({ backend, port: String(P3_DEFAULT_PORT) });
            }}
            helperText={d.id ? "Der Typ gehört zur Decoder-ID und lässt sich nicht ändern." : undefined}
          >
            <MenuItem value="p3">P3 (direkt, TCP)</MenuItem>
            <MenuItem value="ammc">AMMC (Konverter-Prozess)</MenuItem>
          </TextField>
          <Stack direction="row" spacing={2}>
            <TextField size="small" label="IP-Adresse" value={d.ip} onChange={(e) => set({ ip: e.target.value })} sx={{ flex: 1 }} />
            {d.backend === "p3" ? (
              <TextField
                size="small"
                label="Port"
                value={d.port}
                onChange={(e) => set({ port: e.target.value })}
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                sx={{ width: 140 }}
              />
            ) : null}
          </Stack>
          {d.backend === "ammc" ? (
            <Typography variant="caption" color="text.secondary">
              Der AMMC-Konverter verbindet sich mit dem Decoder auf Port 5403. Seinen lokalen WebSocket-Port vergibt der Worker automatisch.
            </Typography>
          ) : null}
          <TextField
            size="small"
            label="Uhr-Offset (s)"
            value={d.clockOffsetSecs}
            onChange={(e) => set({ clockOffsetSecs: e.target.value })}
            helperText="Korrektur der Decoder-Uhr; wird beim Auswerten angewendet, gespeicherte Passings bleiben unverändert."
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
          />
          {d.hardwareId ? (
            <Typography variant="caption" color="text.secondary">
              Hardware-ID {d.hardwareId} (aus dem Netzwerk-Scan)
            </Typography>
          ) : null}
          {problems.length > 0 ? <Alert severity="warning">{problems.join(" · ")}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel}>Abbrechen</Button>
        <Button variant="contained" disabled={problems.length > 0} onClick={() => props.onSave(d)}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  );
}
