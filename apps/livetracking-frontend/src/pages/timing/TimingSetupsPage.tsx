// Zeitmessung – Setups: logical track descriptions (doc/timing-architecture.md, 2.2).
//
// A setup describes the track (name, length, minimum lap time) and its timing points (order,
// role, distance, enabled). Each timing point is assigned a physical decoder from the register –
// connection data and clock offsets live there, so several setups can use the same decoders
// and the same stored passings.

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  createFilterOptions,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import TuneIcon from "@mui/icons-material/Tune";
import {
  makeLiveTrackingListDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  resolveTimingPointDecoderId,
  validateLiveTrackingTrack,
  type LiveTrackingListDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type LiveTrackingSetupEntry,
  type LiveTrackingTimingPoint,
} from "@raceoffice/domain";

import { ManageListDialog, NewEntryDialog } from "../../components/common/Dialogs";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";
import { BACKEND_LABEL, nowIso, useTimingDocs } from "../../timing/timingShared";

type Draft = { name: string; trackId: string; trackName: string; lengthM: number; minLapTimeSecs: number; points: LiveTrackingTimingPoint[] };

type SetupOption = LiveTrackingSetupEntry & { inputValue?: string };
const filterSetupOptions = createFilterOptions<SetupOption>({ stringify: (o) => `${o.name} ${o.setupId}` });

function toDraft(doc: LiveTrackingSetupDocument): Draft {
  return {
    name: doc.name,
    trackId: String(doc.track.id ?? "").trim() || `track-${crypto.randomUUID().slice(0, 8)}`,
    trackName: doc.track.name,
    lengthM: doc.track.lengthM,
    minLapTimeSecs: doc.minLapTimeSecs ?? 8,
    // Assigned decoder ids made explicit (old setups only had addresses).
    points: normalizeTimingPoints(doc.track.timingPoints).map((p) => ({ ...p, decoderId: resolveTimingPointDecoderId(p, doc.decoderBackend) })),
  };
}

export default function TimingSetupsPage() {
  const { data: list, update: updateList } = useRealtimeDoc<LiveTrackingListDocument>(makeLiveTrackingListDocId());
  const { data: session } = useRealtimeDoc<LiveTrackingSessionDocument>(makeLiveTrackingSessionDocId());
  const { decoders } = useTimingDocs();
  const entries = (list?.setups ?? []) as SetupOption[];

  const [setupId, setSetupId] = useState("");
  useEffect(() => {
    if (!setupId && session?.setupId) setSetupId(session.setupId);
  }, [session?.setupId, setupId]);

  const { data: setupDoc, update: updateSetup } = useRealtimeDoc<LiveTrackingSetupDocument>(setupId ? makeLiveTrackingSetupDocId(setupId) : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => setDraft(setupDoc ? toDraft(setupDoc) : null), [setupDoc]);
  const [newOpen, setNewOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const issues = useMemo(() => {
    if (!draft) return [];
    const trackIssues = validateLiveTrackingTrack({ id: draft.trackId, name: draft.trackName, lengthM: draft.lengthM, timingPoints: normalizeTimingPoints(draft.points) }).map((i) => i.message);
    const known = new Set(decoders.map((d) => d.id));
    const decoderIssues = draft.points
      .filter((p) => p.enabled && !known.has(String(p.decoderId ?? "")))
      .map((p) => `Timing-Point „${p.name}“: kein Decoder aus dem Register zugeordnet`);
    return [...trackIssues, ...decoderIssues];
  }, [draft, decoders]);

  const dirty = useMemo(() => !!setupDoc && !!draft && JSON.stringify(toDraft(setupDoc)) !== JSON.stringify(draft), [setupDoc, draft]);
  const running = session?.state === "running" && session.setupId === setupId;

  const patchPoint = (index: number, patch: Partial<LiveTrackingTimingPoint>) =>
    setDraft((prev) => (prev ? { ...prev, points: normalizeTimingPoints(prev.points.map((p, i) => (i === index ? { ...p, ...patch } : p))) } : prev));

  const addPoint = () =>
    setDraft((prev) => {
      if (!prev) return prev;
      const order = prev.points.length + 1;
      const point: LiveTrackingTimingPoint = {
        id: `tp-${crypto.randomUUID().slice(0, 8)}`,
        name: `TP ${order}`,
        decoderId: "",
        // Address fields of the old model; the decoder register is the source now.
        decoderIp: "",
        websocketPortAMM: 0,
        decoderType: "amb",
        decoderTimestampOffsetSecs: 0,
        order,
        distanceFromPreviousM: order === 1 ? 0 : 100,
        absolutePositionM: 0,
        role: order === 1 ? "start_finish" : "split",
        enabled: true,
      };
      return { ...prev, points: normalizeTimingPoints([...prev.points, point]) };
    });

  const save = () => {
    if (!draft) return;
    updateSetup((prev) => ({
      ...prev,
      setupId,
      name: draft.name,
      minLapTimeSecs: draft.minLapTimeSecs,
      track: { id: draft.trackId, name: draft.trackName, lengthM: Number(draft.lengthM), timingPoints: normalizeTimingPoints(draft.points) },
      updatedAt: nowIso(),
    }));
    updateList((prev) => ({ ...prev, setups: prev.setups.map((e) => (e.setupId === setupId ? { ...e, name: draft.name, updatedAt: nowIso() } : e)) }));
  };

  const createSetup = (name: string) => {
    const id = crypto.randomUUID();
    updateList((prev) => ({ ...prev, setups: [...(prev.setups ?? []), { setupId: id, name, updatedAt: nowIso() }] }));
    setSetupId(id);
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader title="Setups" subheader="Strecke und Timing-Points; jedem Timing-Point wird ein Decoder zugeordnet" />
        <Divider />
        <CardContent>
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start", maxWidth: 560 }}>
            <Autocomplete<SetupOption, false, false, false>
              size="small"
              fullWidth
              options={entries}
              value={entries.find((e) => e.setupId === setupId) ?? null}
              onChange={(_, option) => {
                if (!option) setSetupId("");
                else if (option.inputValue) createSetup(option.inputValue);
                else setSetupId(option.setupId);
              }}
              filterOptions={(options, params) => {
                const filtered = filterSetupOptions(options, params);
                const trimmed = params.inputValue.trim();
                if (trimmed && !options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
                  filtered.push({ setupId: "__new__", name: `„${trimmed}“ anlegen`, updatedAt: null, inputValue: trimmed });
                }
                return filtered;
              }}
              getOptionLabel={(o) => (o.inputValue ? o.inputValue : o.name || o.setupId)}
              isOptionEqualToValue={(o, v) => o.setupId === v.setupId}
              renderOption={(props, option) => {
                const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: React.Key };
                return (
                  <li key={key} {...rest}>
                    {option.inputValue ? <em>„{option.inputValue}“ anlegen</em> : option.name}
                  </li>
                );
              }}
              renderInput={(params) => <TextField {...params} label="Setup" size="small" />}
            />
            <IconButton size="small" sx={{ mt: "4px" }} onClick={() => setNewOpen(true)} aria-label="Neues Setup">
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" sx={{ mt: "4px" }} onClick={() => setManageOpen(true)} aria-label="Setups verwalten">
              <TuneIcon fontSize="small" />
            </IconButton>
          </Box>
        </CardContent>
      </Card>

      {draft ? (
        <Card variant="outlined">
          <CardHeader title={draft.name || "Setup"} />
          <Divider />
          <CardContent>
            <Stack spacing={2}>
              {running ? <Alert severity="info">Für dieses Setup läuft eine Messung. Änderungen wirken sofort auf die Auswertung.</Alert> : null}
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField size="small" label="Name des Setups" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} fullWidth />
                <TextField size="small" label="Strecke" value={draft.trackName} onChange={(e) => setDraft({ ...draft, trackName: e.target.value })} fullWidth />
                <TextField size="small" type="number" label="Länge (m)" value={draft.lengthM} onChange={(e) => setDraft({ ...draft, lengthM: Number(e.target.value) })} sx={{ maxWidth: 160 }} />
                <TextField
                  size="small"
                  type="number"
                  label="Min. Rundenzeit (s)"
                  value={draft.minLapTimeSecs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) setDraft({ ...draft, minLapTimeSecs: v });
                  }}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  sx={{ maxWidth: 180 }}
                />
              </Stack>

              <Table size="small" aria-label="Timing-Points">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Rolle</TableCell>
                    <TableCell>Abstand (m)</TableCell>
                    <TableCell>Decoder</TableCell>
                    <TableCell>Aktiv</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {draft.points.map((p, index) => (
                    <TableRow key={p.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <TextField size="small" value={p.name} onChange={(e) => patchPoint(index, { name: e.target.value })} slotProps={{ htmlInput: { "aria-label": `Name Timing-Point ${index + 1}` } }} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" select value={p.role} onChange={(e) => patchPoint(index, { role: e.target.value as LiveTrackingTimingPoint["role"] })}>
                          <MenuItem value="start_finish">Start/Ziel</MenuItem>
                          <MenuItem value="split">Zwischenzeit</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField size="small" type="number" value={p.distanceFromPreviousM} onChange={(e) => patchPoint(index, { distanceFromPreviousM: Number(e.target.value) })} sx={{ maxWidth: 110 }} />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          select
                          value={decoders.some((d) => d.id === p.decoderId) ? p.decoderId : ""}
                          onChange={(e) => patchPoint(index, { decoderId: e.target.value })}
                          sx={{ minWidth: 200 }}
                          slotProps={{ htmlInput: { "aria-label": `Decoder Timing-Point ${index + 1}` } }}
                        >
                          <MenuItem value="">
                            <em>— kein Decoder —</em>
                          </MenuItem>
                          {decoders.map((d) => (
                            <MenuItem key={d.id} value={d.id}>
                              {d.name} ({BACKEND_LABEL[d.backend]})
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <Checkbox checked={p.enabled} onChange={(e) => patchPoint(index, { enabled: e.target.checked })} />
                      </TableCell>
                      <TableCell>
                        <Button size="small" color="error" onClick={() => setDraft({ ...draft, points: normalizeTimingPoints(draft.points.filter((_, i) => i !== index)) })}>
                          Entfernen
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {issues.length > 0 ? (
                <Alert severity="warning">
                  {issues.map((m, i) => (
                    <div key={i}>{m}</div>
                  ))}
                </Alert>
              ) : (
                <Typography variant="body2" color="success.main">
                  Setup ist vollständig.
                </Typography>
              )}

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" onClick={addPoint}>
                  Timing-Point hinzufügen
                </Button>
                <Button variant={dirty ? "contained" : "outlined"} disabled={!dirty} onClick={save}>
                  Setup speichern
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Typography color="text.secondary">Wähle oder lege ein Setup an.</Typography>
      )}

      <NewEntryDialog open={newOpen} title="Neues Setup" onConfirm={createSetup} onClose={() => setNewOpen(false)} />
      <ManageListDialog
        open={manageOpen}
        title="Setups verwalten"
        entries={entries.map((e) => ({ id: e.setupId, name: e.name }))}
        onRename={(id, name) => updateList((prev) => ({ ...prev, setups: prev.setups.map((e) => (e.setupId === id ? { ...e, name, updatedAt: nowIso() } : e)) }))}
        onDelete={(id) => {
          updateList((prev) => ({ ...prev, setups: prev.setups.filter((e) => e.setupId !== id) }));
          if (id === setupId) setSetupId("");
        }}
        onClose={() => setManageOpen(false)}
      />
    </Box>
  );
}
