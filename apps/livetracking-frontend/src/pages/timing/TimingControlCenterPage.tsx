// Zeitmessung – Control Center (doc/timing-architecture.md, section 7)
//
// - Worker: start/stop the timing worker process (stopping asks about measurement/simulator)
// - Aktives Setup: choose the setup (used by the measurement too) and connect its decoders
// - Hardware: one row per physical decoder of the register; connecting is explicit (decoders
//   accept only few connections), status incl. P3 device values and re-requested passings
// - Passings: newest passings of the store, filter by decoder, counts per decoder, deleting
//   (for the filtered decoder or all) with confirmation
// - Diagnose: worker warnings and the timing documents

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  setTimingDecoderConnected,
  type TimingDecoder,
  type TimingDecoderStatus,
  type TimingPassing,
} from "@raceoffice/domain";
import { Link as RouterLink } from "react-router-dom";

import { ConfirmDialog, JsonAccordion } from "../../components/common/Dialogs";
import { ActiveSetupCard } from "./ActiveSetupCard";
import { WorkerCard } from "./WorkerCard";
import {
  BACKEND_LABEL,
  decoderHealth,
  formatAgo,
  formatTime,
  HEALTH_COLOR,
  HEALTH_LABEL,
  nowIso,
  postJson,
  useNow,
  useTimingDocs,
  useWorkerState,
} from "../../timing/timingShared";

const PASSING_LOG_SIZE = 50;
const PASSING_POLL_MS = 2000;

export default function TimingControlCenterPage() {
  const now = useNow(1000);
  const timing = useTimingDocs();
  const { online, runtime } = useWorkerState(now);

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <WorkerCard online={online} runtime={runtime} />
      <ActiveSetupCard timing={timing} now={now} />
      <HardwareCard timing={timing} workerOnline={online} now={now} />
      <PassingsCard decoders={timing.decoders} />
      <Card variant="outlined">
        <CardHeader title="Diagnose" />
        <Divider />
        <CardContent>
          <Typography variant="subtitle2">Warnungen des Workers</Typography>
          {(runtime?.warnings ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ) : (
            (runtime?.warnings ?? []).slice(-15).reverse().map((w, i) => (
              <Typography key={i} variant="body2" sx={{ fontFamily: "monospace", fontSize: 12 }}>
                {w}
              </Typography>
            ))
          )}
          <JsonAccordion title="Decoder-Register" value={timing.decodersDoc} />
          <JsonAccordion title="Verbindungswunsch" value={timing.connectionDoc} />
          <JsonAccordion title="Decoder-Status" value={timing.statusDoc} />
        </CardContent>
      </Card>
    </Box>
  );
}

function HardwareCard(props: { timing: ReturnType<typeof useTimingDocs>; workerOnline: boolean; now: number }) {
  const { decoders, connectedIds, statusById, updateConnection } = props.timing;
  const connected = new Set(connectedIds);
  const healthy = decoders.filter((d) => decoderHealth(statusById.get(d.id), props.now) === "connected").length;

  const setConnected = (ids: string[], value: boolean) =>
    updateConnection((prev) => ids.reduce((doc, id) => setTimingDecoderConnected(doc, id, value, nowIso()), prev));

  return (
    <Card variant="outlined">
      <CardHeader
        title="Hardware"
        subheader={`${healthy} von ${connected.size} gewünschten Decodern verbunden · ${decoders.length} im Register`}
        action={
          <Stack direction="row" spacing={1} sx={{ mt: 1, mr: 1 }}>
            <Button size="small" variant="outlined" disabled={decoders.length === 0} onClick={() => setConnected(decoders.map((d) => d.id), true)}>
              Alle verbinden
            </Button>
            <Button size="small" variant="outlined" disabled={connected.size === 0} onClick={() => setConnected([...connected], false)}>
              Alle trennen
            </Button>
          </Stack>
        }
      />
      <Divider />
      <CardContent>
        {!props.workerOnline && connected.size > 0 ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Der Worker läuft nicht. Die gewählten Decoder werden verbunden, sobald er gestartet ist.
          </Alert>
        ) : null}
        {decoders.length === 0 ? (
          <Typography color="text.secondary">
            Noch keine Decoder. Lege sie unter{" "}
            <Button component={RouterLink} to="/timing/decoders" size="small">
              Decoder
            </Button>{" "}
            an.
          </Typography>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="Hardware-Status">
              <TableHead>
                <TableRow>
                  <TableCell>Verbinden</TableCell>
                  <TableCell>Decoder</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Letzte Meldung</TableCell>
                  <TableCell>Passings</TableCell>
                  <TableCell>Gerät</TableCell>
                  <TableCell>Nachgefordert</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {decoders.map((d) => (
                  <DecoderRow
                    key={d.id}
                    decoder={d}
                    status={statusById.get(d.id)}
                    connected={connected.has(d.id)}
                    now={props.now}
                    onToggle={(value) => setConnected([d.id], value)}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function DecoderRow(props: { decoder: TimingDecoder; status: TimingDecoderStatus | undefined; connected: boolean; now: number; onToggle: (v: boolean) => void }) {
  const { decoder: d, status: st } = props;
  const health = props.connected ? decoderHealth(st, props.now) : "disconnected";
  const device = st?.device;
  const seq = st?.sequence;
  return (
    <TableRow>
      <TableCell>
        <Switch checked={props.connected} onChange={(e) => props.onToggle(e.target.checked)} slotProps={{ input: { "aria-label": `${d.name} verbinden` } }} />
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {d.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {BACKEND_LABEL[d.backend]} · {d.backend === "ammc" ? d.ip : `${d.ip}:${d.port}`}
          {d.backend === "ammc" && props.connected && st?.localPort ? ` · Konverter-Port ${st.localPort}` : ""}
          {st?.hardware ? ` · ID ${st.hardware.hardwareId}${st.hardware.firmwareVersion ? ` · FW ${st.hardware.firmwareVersion}` : ""}` : ""}
        </Typography>
      </TableCell>
      <TableCell>
        <Chip size="small" label={HEALTH_LABEL[health]} color={HEALTH_COLOR[health]} />
        {st?.lastError && health === "error" ? (
          <Typography variant="caption" color="error" sx={{ display: "block" }}>
            {st.lastError}
          </Typography>
        ) : null}
      </TableCell>
      <TableCell>{props.connected ? formatAgo(st?.lastMessageAt, props.now) : "—"}</TableCell>
      <TableCell>{props.connected ? (st?.passingCount ?? 0) : "—"}</TableCell>
      <TableCell>
        {device ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
            <Chip size="small" variant="outlined" color={device.gpsLocked === false ? "warning" : "default"} label={`GPS ${device.gpsLocked ? "✓" : "✗"}`} />
            {device.noise !== null ? <Chip size="small" variant="outlined" label={`Rauschen ${device.noise}`} /> : null}
            {device.temperatureC !== null ? <Chip size="small" variant="outlined" label={`${device.temperatureC} °C`} /> : null}
            {device.voltage !== null ? <Chip size="small" variant="outlined" label={`${device.voltage} V`} /> : null}
          </Stack>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        {seq && seq.requested > 0 ? (
          <Tooltip title="angefordert / wiederhergestellt / offen">
            <Chip size="small" color={seq.open > 0 ? "warning" : "default"} label={`${seq.requested} / ${seq.recovered} / ${seq.open}`} />
          </Tooltip>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

type Stats = { total: number; lastSeq: number; decoders: Array<{ decoderId: string; count: number; lastReceivedAt: string | null }> };

function PassingsCard({ decoders }: { decoders: TimingDecoder[] }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [passings, setPassings] = useState<TimingPassing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** Decoder filter of the list – also what "Passings löschen" deletes. */
  const [filter, setFilter] = useState<string>("__all__");
  const [message, setMessage] = useState<string | null>(null);
  const nameOf = useMemo(() => new Map(decoders.map((d) => [d.id, d.name])), [decoders]);

  const load = useCallback(async () => {
    try {
      const s = (await (await fetch("/timing/passings/stats")).json()) as Stats;
      setStats(s);
      const decoderParam = filter === "__all__" ? "" : `&decoderIds=${encodeURIComponent(filter)}`;
      const page = (await (await fetch(`/timing/passings?latest=${PASSING_LOG_SIZE}${decoderParam}`)).json()) as { passings: TimingPassing[] };
      setPassings(page.passings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), PASSING_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const remove = async () => {
    const deleteFilter = filter === "__all__" ? { all: true } : { decoderIds: [filter] };
    try {
      const res = await postJson<{ deleted: number }>("/timing/passings/delete", { confirm: true, filter: deleteFilter });
      setMessage(`${res.deleted} Passings gelöscht.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Decoders of the register plus ids that only occur in stored passings (e.g. deleted decoders).
  const filterOptions = [
    ...decoders.map((d) => ({ id: d.id, name: d.name })),
    ...(stats?.decoders ?? []).filter((d) => !nameOf.has(d.decoderId)).map((d) => ({ id: d.decoderId, name: d.decoderId })),
  ];
  const filteredCount = filter === "__all__" ? (stats?.total ?? 0) : (stats?.decoders.find((d) => d.decoderId === filter)?.count ?? 0);

  return (
    <Card variant="outlined">
      <CardHeader
        title="Passings"
        subheader={stats ? (filter === "__all__" ? `${stats.total} gespeichert` : `${filteredCount} von ${stats.total} gespeichert`) : "—"}
        action={
          <Stack direction="row" spacing={1} sx={{ mt: 1, mr: 1, alignItems: "center" }}>
            <TextField select size="small" label="Decoder" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="__all__">alle Decoder</MenuItem>
              {filterOptions.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name}
                </MenuItem>
              ))}
            </TextField>
            <Button color="error" variant="outlined" disabled={filteredCount === 0} onClick={() => setDeleteOpen(true)}>
              Passings löschen …
            </Button>
          </Stack>
        }
      />
      <Divider />
      <CardContent>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {message ? (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>
            {message}
          </Alert>
        ) : null}
        {stats && stats.decoders.length > 0 ? (
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
            {stats.decoders.map((d) => (
              <Chip
                key={d.decoderId}
                size="small"
                clickable
                variant={filter === d.decoderId ? "filled" : "outlined"}
                color={filter === d.decoderId ? "primary" : "default"}
                label={`${nameOf.get(d.decoderId) ?? d.decoderId}: ${d.count}`}
                onClick={() => setFilter(filter === d.decoderId ? "__all__" : d.decoderId)}
              />
            ))}
          </Stack>
        ) : null}
        {passings.length === 0 ? (
          <Typography color="text.secondary">{filter === "__all__" ? "Noch keine Passings." : "Keine Passings dieses Decoders."}</Typography>
        ) : (
          <Box sx={{ maxHeight: 360, overflow: "auto" }}>
            <Table size="small" stickyHeader aria-label="Neueste Passings">
              <TableHead>
                <TableRow>
                  <TableCell>Zeit (Decoder)</TableCell>
                  <TableCell>Decoder</TableCell>
                  <TableCell>Transponder</TableCell>
                  <TableCell align="right">Nr.</TableCell>
                  <TableCell align="right">Signal</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {passings.map((p) => (
                  <TableRow key={p.seq}>
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{formatTime(p.decoderTime)}</TableCell>
                    <TableCell>{nameOf.get(p.decoderId) ?? p.decoderId}</TableCell>
                    <TableCell>{p.signalKind ? `Signal (${p.signalKind})` : p.transponderId}</TableCell>
                    <TableCell align="right">{p.passingNumber ?? "—"}</TableCell>
                    <TableCell align="right">{p.signalStrength ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
      <ConfirmDialog
        open={deleteOpen}
        title="Passings löschen"
        danger
        confirmLabel="Endgültig löschen"
        text={
          <>
            {filter === "__all__" ? "Alle gespeicherten Passings" : `Alle Passings von „${nameOf.get(filter) ?? filter}“`} werden gelöscht. Messungen
            aller Abnehmer (z. B. Livetracking), die diese Passings nutzen, verlieren damit ihre Ergebnisse. Das lässt sich nicht rückgängig machen.
          </>
        }
        onConfirm={() => void remove()}
        onClose={() => setDeleteOpen(false)}
      />
    </Card>
  );
}
