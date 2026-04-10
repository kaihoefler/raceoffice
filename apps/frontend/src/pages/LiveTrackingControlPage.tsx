import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  Divider,
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
import {
  canIssueLiveTrackingCommand,
  createLiveTrackingCommand,
  enqueueLiveTrackingCommand,
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  validateLiveTrackingTrack,
  type LiveTrackingCommandIntent,
  type LiveTrackingMode,
  type LiveTrackingResultsDocument,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type LiveTrackingTimingPoint,
} from "@raceoffice/domain";
import { useEventList } from "../providers/EventListProvider";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

type TrackingConfigDraft = {
  setupId: string;
  mode: LiveTrackingMode;
  eventId: string;
  participantPoolDocId: string;
};

type SetupDraft = {
  name: string;
  trackId: string;
  trackName: string;
  lengthM: number;
  timingPoints: LiveTrackingTimingPoint[];
};


function nowIso(): string {
  return new Date().toISOString();
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}s`;
}

function workerStatusColor(status: LiveTrackingRuntimeDocument["workerStatus"] | undefined) {
  if (status === "running") return "success" as const;
  if (status === "ready") return "info" as const;
  if (status === "starting" || status === "stopping") return "warning" as const;
  if (status === "error") return "error" as const;
  return "default" as const;
}

function liveTrackingStateColor(state: LiveTrackingSessionDocument["state"] | undefined) {
  if (state === "running") return "success" as const;
  if (state === "ready") return "info" as const;
  if (state === "preparing" || state === "stopping") return "warning" as const;
  if (state === "error") return "error" as const;
  if (state === "idle") return "default" as const;
  return "default" as const;
}

function toSetupDraft(doc: LiveTrackingSetupDocument): SetupDraft {
  return {
    name: doc.name,
    // Track id is a technical identifier. Keep it internal and auto-generate if missing.
    trackId: String(doc.track.id ?? "").trim() || `track-${crypto.randomUUID().slice(0, 8)}`,
    trackName: doc.track.name,
    lengthM: doc.track.lengthM,
    timingPoints: normalizeTimingPoints(doc.track.timingPoints),
  };
}

export default function LiveTrackingControlPage() {
  const { eventList } = useEventList();

  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const runtimeDocId = useMemo(() => makeLiveTrackingRuntimeDocId(), []);
  const resultsDocId = useMemo(() => makeLiveTrackingResultsDocId(), []);

  const { data: session, update: updateSession, status: sessionStatus } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);
  const { data: runtime, update: updateRuntime } = useRealtimeDoc<LiveTrackingRuntimeDocument>(runtimeDocId);
  const { data: results } = useRealtimeDoc<LiveTrackingResultsDocument>(resultsDocId);

  const sessionForDebug = useMemo(
    () => (session ? { ...session, commandQueue: (session.commandQueue ?? []).slice(-2) } : null),
    [session],
  );
  const sessionJson = useMemo(() => (sessionForDebug ? JSON.stringify(sessionForDebug, null, 2) : "—"), [sessionForDebug]);
  const runtimeJson = useMemo(() => (runtime ? JSON.stringify(runtime, null, 2) : "—"), [runtime]);
  const invalidReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of results?.invalidEvents ?? []) {
      counts.set(event.reason, (counts.get(event.reason) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [results]);

  const [trackingDraft, setTrackingDraft] = useState<TrackingConfigDraft>({
    setupId: "",
    mode: "training",
    eventId: "",
    participantPoolDocId: "",
  });

  const setupDocId = trackingDraft.setupId.trim() ? makeLiveTrackingSetupDocId(trackingDraft.setupId.trim()) : null;
  const { data: setupDoc, update: updateSetup } = useRealtimeDoc<LiveTrackingSetupDocument>(setupDocId);
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);

  useEffect(() => {
    if (!session) return;
    const eventId = session.participantSource.eventId;
    const participantPoolDocId =
      session.participantSource.kind === "event_participant_pool"
        ? session.participantSource.participantPoolDocId
        : makeLiveTrackingParticipantPoolDocId(eventId);

    setTrackingDraft({
      setupId: session.setupId,
      mode: session.mode,
      eventId,
      participantPoolDocId,
    });
  }, [session]);

  useEffect(() => {
    if (!setupDoc) {
      setSetupDraft(null);
      return;
    }
    setSetupDraft(toSetupDraft(setupDoc));
  }, [setupDoc]);

  const setupIssues = useMemo(() => {
    if (!setupDraft) return [];
    return validateLiveTrackingTrack({
      id: setupDraft.trackId,
      name: setupDraft.trackName,
      lengthM: setupDraft.lengthM,
      timingPoints: normalizeTimingPoints(setupDraft.timingPoints),
    });
  }, [setupDraft]);

  function saveSessionConfig() {
    updateSession((prev) => ({
      ...prev,
      setupId: trackingDraft.setupId.trim(),
      mode: trackingDraft.mode,
      participantSource: {
        kind: "event_participant_pool",
        eventId: trackingDraft.eventId.trim(),
        participantPoolDocId:
          trackingDraft.participantPoolDocId.trim() || makeLiveTrackingParticipantPoolDocId(trackingDraft.eventId.trim()),
      },
      updatedAt: nowIso(),
    }));
  }

  function queue(intent: LiveTrackingCommandIntent) {
    updateSession((prev) => {
      const requestedAt = nowIso();
      return enqueueLiveTrackingCommand(
        prev,
        createLiveTrackingCommand({ id: crypto.randomUUID(), intent, requestedAt }),
        requestedAt,
      );
    });
  }

  function canQueue(intent: LiveTrackingCommandIntent): boolean {
    if (!session) return false;
    return canIssueLiveTrackingCommand(session.state, intent);
  }

  function clearRuntimeBuffers() {
    updateRuntime((prev) => ({
      ...prev,
      recentPassings: [],
      recentRawPayloads: [],
      warnings: [],
      updatedAt: nowIso(),
    }));
  }

  function patchPoint(index: number, patch: Partial<LiveTrackingTimingPoint>) {
    setSetupDraft((prev) => {
      if (!prev) return prev;
      const points = prev.timingPoints.map((p, i) => (i === index ? { ...p, ...patch } : p));
      return { ...prev, timingPoints: normalizeTimingPoints(points) };
    });
  }

  function addPoint() {
    setSetupDraft((prev) => {
      if (!prev) return prev;
      const order = prev.timingPoints.length + 1;
      return {
        ...prev,
        timingPoints: [
          ...prev.timingPoints,
          {
            id: `tp-${crypto.randomUUID().slice(0, 8)}`,
            name: `TP ${order}`,
            decoderId: "",
            decoderIp: "127.0.0.1",
            websocketPortAMM: 0,
            order,
            distanceFromPreviousM: order === 1 ? 0 : 100,
            absolutePositionM: 0,
            role: order === 1 ? "start_finish" : "split",
            enabled: true,
          },
        ],
      };
    });
  }

  function removePoint(index: number) {
    setSetupDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, timingPoints: normalizeTimingPoints(prev.timingPoints.filter((_, i) => i !== index)) };
    });
  }

  function saveSetup() {
    if (!setupDraft) return;
    const stableTrackId = setupDraft.trackId.trim() || `track-${crypto.randomUUID().slice(0, 8)}`;
    updateSetup((prev) => ({
      ...prev,
      setupId: trackingDraft.setupId.trim(),
      eventId: trackingDraft.eventId.trim() || null,
      name: setupDraft.name,
      track: {
        id: stableTrackId,
        name: setupDraft.trackName,
        lengthM: Number(setupDraft.lengthM),
        timingPoints: normalizeTimingPoints(setupDraft.timingPoints),
      },
      updatedAt: nowIso(),
    }));
    setSetupDraft((prev) => (prev ? { ...prev, trackId: stableTrackId } : prev));
  }

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader title="Live Tracking" subheader="Control + Setup Editor + Debug" />
        <Divider />
        <CardContent>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <Chip size="small" label={`Control Link: ${sessionStatus}`} color={sessionStatus === "connected" ? "success" : "default"} />
            <Chip size="small" label={`LiveTracking State: ${session?.state ?? "unknown"}`} color={liveTrackingStateColor(session?.state)} />
            <Chip size="small" label={`Worker State: ${runtime?.workerStatus ?? "offline"}`} color={workerStatusColor(runtime?.workerStatus)} />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Tracking Control" />
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField size="small" label="Setup ID" value={trackingDraft.setupId} onChange={(e) => setTrackingDraft((p) => ({ ...p, setupId: e.target.value }))} fullWidth />
              <TextField size="small" label="Mode" select value={trackingDraft.mode} onChange={(e) => setTrackingDraft((p) => ({ ...p, mode: e.target.value as LiveTrackingMode }))}>
                <MenuItem value="training">training</MenuItem>
                <MenuItem value="qualifying">qualifying</MenuItem>
              </TextField>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField
                size="small"
                label="Event"
                select
                value={trackingDraft.eventId}
                onChange={(e) => {
                  const eventId = e.target.value;
                  setTrackingDraft((p) => ({ ...p, eventId, participantPoolDocId: makeLiveTrackingParticipantPoolDocId(eventId) }));
                }}
                fullWidth
              >
                <MenuItem value="">(none)</MenuItem>
                {(eventList?.events ?? []).map((event) => (
                  <MenuItem key={event.id} value={event.id}>{event.name || event.id}</MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Participant Pool Doc ID"
                value={trackingDraft.participantPoolDocId}
                onChange={(e) => setTrackingDraft((p) => ({ ...p, participantPoolDocId: e.target.value }))}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Button variant="outlined" onClick={saveSessionConfig}>Save Tracking Setup</Button>
              <Button variant="outlined" onClick={() => queue("prepare")} disabled={!canQueue("prepare")}>Prepare</Button>
              <Button variant="outlined" onClick={() => queue("start")} disabled={!canQueue("start")}>Start</Button>
              <Button variant="outlined" onClick={() => queue("stop")} disabled={!canQueue("stop")}>Stop</Button>
              <Button variant="outlined" onClick={() => queue("shutdown")} disabled={!canQueue("shutdown")}>Shutdown</Button>
              <Button variant="outlined" onClick={() => queue("reset")} disabled={!canQueue("reset")}>Reset</Button>
              <Button color="warning" variant="outlined" onClick={clearRuntimeBuffers}>Clear Passings/Runtime Buffers</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Setup Editor" subheader={setupDocId ?? "Set Setup ID to edit track configuration"} />
        <Divider />
        <CardContent>
          {!setupDraft ? (
            <Typography color="text.secondary">No setup loaded yet.</Typography>
          ) : (
            <Stack spacing={1}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField size="small" label="Setup Name" value={setupDraft.name} onChange={(e) => setSetupDraft((p) => (p ? { ...p, name: e.target.value } : p))} fullWidth />
                <TextField size="small" label="Track Name" value={setupDraft.trackName} onChange={(e) => setSetupDraft((p) => (p ? { ...p, trackName: e.target.value } : p))} fullWidth />
                <TextField size="small" type="number" label="Track Length (m)" value={setupDraft.lengthM} onChange={(e) => setSetupDraft((p) => (p ? { ...p, lengthM: Number(e.target.value) } : p))} sx={{ maxWidth: 180 }} />
              </Stack>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell><TableCell>Name</TableCell><TableCell>Role</TableCell><TableCell>Decoder</TableCell><TableCell>IP</TableCell><TableCell>WS</TableCell><TableCell>Dist (m)</TableCell><TableCell>Enabled</TableCell><TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {setupDraft.timingPoints.map((point, index) => (
                    <TableRow key={point.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell><TextField size="small" value={point.name} onChange={(e) => patchPoint(index, { name: e.target.value })} /></TableCell>
                      <TableCell>
                        <TextField size="small" select value={point.role} onChange={(e) => patchPoint(index, { role: e.target.value as LiveTrackingTimingPoint["role"] })}>
                          <MenuItem value="start_finish">start_finish</MenuItem>
                          <MenuItem value="split">split</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell><TextField size="small" value={point.decoderId} onChange={(e) => patchPoint(index, { decoderId: e.target.value })} /></TableCell>
                      <TableCell><TextField size="small" value={point.decoderIp} onChange={(e) => patchPoint(index, { decoderIp: e.target.value })} /></TableCell>
                      <TableCell><TextField size="small" type="number" value={point.websocketPortAMM} onChange={(e) => patchPoint(index, { websocketPortAMM: Number(e.target.value) })} /></TableCell>
                      <TableCell><TextField size="small" type="number" value={point.distanceFromPreviousM} onChange={(e) => patchPoint(index, { distanceFromPreviousM: Number(e.target.value) })} /></TableCell>
                      <TableCell><Checkbox checked={point.enabled} onChange={(e) => patchPoint(index, { enabled: e.target.checked })} /></TableCell>
                      <TableCell><Button size="small" color="error" onClick={() => removePoint(index)}>Delete</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {setupIssues.length > 0 ? (
                <Box sx={{ p: 1, border: "1px solid", borderColor: "warning.light", borderRadius: 1 }}>
                  {setupIssues.map((issue, i) => (
                    <Typography key={`${issue.code}:${i}`} variant="body2" color="warning.main">
                      • {issue.message}
                    </Typography>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="success.main">
                  Setup validation looks good.
                </Typography>
              )}

              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <Button variant="outlined" onClick={addPoint}>
                  Add Timing Point
                </Button>
                <Button variant="outlined" onClick={saveSetup}>
                  Save Setup Document
                </Button>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Live Board" />
        <Divider />
        <CardContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Athlete</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Laps</TableCell>
                <TableCell align="right">Best Lap</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(results?.athleteLiveStates ?? []).map((row) => (
                <TableRow key={row.athleteId}>
                  <TableCell>{row.lastName || row.athleteId}</TableCell>
                  <TableCell>{row.activityStatus}</TableCell>
                  <TableCell align="right">{row.lapsCompleted}</TableCell>
                  <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                </TableRow>
              ))}
              {(results?.athleteLiveStates ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No live athletes yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Debug View" />
        <Divider />
        <CardContent>
          <Typography variant="body2">Worker: {runtime?.workerStatus ?? "—"}</Typography>
          <Typography variant="body2">Worker PID: {runtime?.workerProcessId ?? "—"}</Typography>
          <Typography variant="body2">Worker Host: {runtime?.workerHost ?? "—"}</Typography>
          <Typography variant="body2">Heartbeat: {runtime?.workerHeartbeatAt ?? "—"}</Typography>
          <Typography variant="body2">Invalid events: {(results?.invalidEvents ?? []).length}</Typography>
          <Typography variant="body2">Unknown transponders: {(results?.unknownTransponders ?? []).join(", ") || "—"}</Typography>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Invalid event reasons
          </Typography>
          {invalidReasonCounts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">—</Typography>
          ) : (
            <Stack spacing={0.5}>
              {invalidReasonCounts.map(([reason, count]) => (
                <Typography key={reason} variant="body2">
                  {reason}: {count}
                </Typography>
              ))}
            </Stack>
          )}

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Session Document
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              borderRadius: 1,
              bgcolor: "grey.100",
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {sessionJson}
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Runtime Document
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              borderRadius: 1,
              bgcolor: "grey.100",
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {runtimeJson}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

