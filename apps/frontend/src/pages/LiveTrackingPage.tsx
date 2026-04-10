import { useEffect, useMemo, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  createLiveTrackingCommand,
  enqueueLiveTrackingCommand,
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  type LiveTrackingCommandIntent,
  type LiveTrackingMode,
  type LiveTrackingResultsDocument,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
} from "@raceoffice/domain";
import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

type SessionConfigDraft = {
  setupId: string;
  mode: LiveTrackingMode;
  eventId: string;
  participantPoolDocId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  const seconds = Math.floor(ms / 1000);
  const millis = ms % 1000;
  return `${seconds}.${String(millis).padStart(3, "0")}s`;
}

export default function LiveTrackingPage() {
  const [sessionIdInput, setSessionIdInput] = useState("default");
  const [activeSessionId, setActiveSessionId] = useState("default");

  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(activeSessionId), [activeSessionId]);
  const runtimeDocId = useMemo(() => makeLiveTrackingRuntimeDocId(activeSessionId), [activeSessionId]);
  const resultsDocId = useMemo(() => makeLiveTrackingResultsDocId(activeSessionId), [activeSessionId]);

  const {
    data: session,
    update: updateSession,
    status: sessionStatus,
    error: sessionError,
  } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);
  const { data: runtime, status: runtimeStatus } = useRealtimeDoc<LiveTrackingRuntimeDocument>(runtimeDocId);
  const { data: results, status: resultsStatus } = useRealtimeDoc<LiveTrackingResultsDocument>(resultsDocId);

  const [draft, setDraft] = useState<SessionConfigDraft>({
    setupId: "",
    mode: "training",
    eventId: "",
    participantPoolDocId: "",
  });

  useEffect(() => {
    if (!session) return;

    const source = session.participantSource;
    const eventId = source.kind === "event_participant_pool" ? source.eventId : source.eventId;
    const participantPoolDocId =
      source.kind === "event_participant_pool"
        ? source.participantPoolDocId
        : makeLiveTrackingParticipantPoolDocId(source.eventId);

    setDraft({
      setupId: session.setupId,
      mode: session.mode,
      eventId,
      participantPoolDocId,
    });
  }, [session]);

  function switchSession() {
    const next = sessionIdInput.trim();
    if (!next) return;
    setActiveSessionId(next);
  }

  function saveSessionConfig() {
    updateSession((prev) => {
      const setupId = draft.setupId.trim();
      const eventId = draft.eventId.trim();
      const participantPoolDocId = draft.participantPoolDocId.trim() || makeLiveTrackingParticipantPoolDocId(eventId);

      return {
        ...prev,
        setupId,
        mode: draft.mode,
        participantSource: {
          kind: "event_participant_pool",
          eventId,
          participantPoolDocId,
        },
        updatedAt: nowIso(),
      };
    });
  }

  function queueCommand(intent: LiveTrackingCommandIntent) {
    updateSession((prev) => {
      const requestedAt = nowIso();
      const command = createLiveTrackingCommand({
        id: crypto.randomUUID(),
        intent,
        requestedAt,
      });
      return enqueueLiveTrackingCommand(prev, command, requestedAt);
    });
  }

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader title="Live Tracking" subheader="Session Control + Live Board + Debug" />
        <Divider />
        <CardContent>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "stretch", md: "center" }}>
            <TextField
              label="Session ID"
              value={sessionIdInput}
              onChange={(e) => setSessionIdInput(e.target.value)}
              size="small"
            />
            <Button variant="outlined" onClick={switchSession}>
              Open Session
            </Button>
            <Chip size="small" label={`Session: ${sessionStatus}`} color={sessionStatus === "connected" ? "success" : "default"} />
            <Chip size="small" label={`Runtime: ${runtimeStatus}`} color={runtimeStatus === "connected" ? "success" : "default"} />
            <Chip size="small" label={`Results: ${resultsStatus}`} color={resultsStatus === "connected" ? "success" : "default"} />
          </Stack>
          {sessionError ? (
            <Alert sx={{ mt: 1.5 }} severity="error">
              {sessionError}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Session Control" />
        <Divider />
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
              <TextField
                label="Setup ID"
                value={draft.setupId}
                onChange={(e) => setDraft((prev) => ({ ...prev, setupId: e.target.value }))}
                size="small"
                fullWidth
              />
              <TextField
                label="Mode"
                value={draft.mode}
                onChange={(e) => setDraft((prev) => ({ ...prev, mode: e.target.value === "qualifying" ? "qualifying" : "training" }))}
                size="small"
                select
                SelectProps={{ native: true }}
                sx={{ minWidth: 180 }}
              >
                <option value="training">training</option>
                <option value="qualifying">qualifying</option>
              </TextField>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
              <TextField
                label="Event ID"
                value={draft.eventId}
                onChange={(e) => {
                  const eventId = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    eventId,
                    participantPoolDocId: makeLiveTrackingParticipantPoolDocId(eventId.trim()),
                  }));
                }}
                size="small"
                fullWidth
              />
              <TextField
                label="Participant Pool Doc ID"
                value={draft.participantPoolDocId}
                onChange={(e) => setDraft((prev) => ({ ...prev, participantPoolDocId: e.target.value }))}
                size="small"
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Button variant="outlined" onClick={saveSessionConfig}>
                Save Session Setup
              </Button>
              <Button variant="outlined" onClick={() => queueCommand("prepare")}>Prepare</Button>
              <Button variant="outlined" onClick={() => queueCommand("start")}>Start</Button>
              <Button variant="outlined" onClick={() => queueCommand("stop")}>Stop</Button>
              <Button variant="outlined" onClick={() => queueCommand("shutdown")}>Shutdown</Button>
              <Button variant="outlined" onClick={() => queueCommand("reset")}>Reset</Button>
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Current state: <strong>{session?.state ?? "—"}</strong> / desired: <strong>{session?.desiredState ?? "—"}</strong>
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader title="Live Board" />
        <Divider />
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Qualifying Ranking
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rank</TableCell>
                <TableCell>Athlete</TableCell>
                <TableCell align="right">Best Lap</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(results?.qualifyingRanking ?? []).map((row) => (
                <TableRow key={row.athleteId}>
                  <TableCell>{row.rank}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{row.athleteId}</TableCell>
                  <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                </TableRow>
              ))}
              {(results?.qualifyingRanking ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography color="text.secondary">No ranking data yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Athlete States
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Athlete</TableCell>
                <TableCell>Transponder</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Laps</TableCell>
                <TableCell align="right">Last Lap</TableCell>
                <TableCell align="right">Best Lap</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(results?.athleteLiveStates ?? []).map((row) => (
                <TableRow key={row.athleteId}>
                  <TableCell>
                    {row.lastName || row.firstName ? `${row.firstName} ${row.lastName}`.trim() : row.athleteId}
                  </TableCell>
                  <TableCell>{row.transponderId ?? "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={row.activityStatus} color={row.activityStatus === "active" ? "success" : "default"} />
                  </TableCell>
                  <TableCell align="right">{row.lapsCompleted}</TableCell>
                  <TableCell align="right">{formatMs(row.lastLapTimeMs)}</TableCell>
                  <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                </TableRow>
              ))}
              {(results?.athleteLiveStates ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No athletes yet.</Typography>
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
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Decoder Runtime
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Timing Point</TableCell>
                <TableCell>Decoder</TableCell>
                <TableCell>Process</TableCell>
                <TableCell>WebSocket</TableCell>
                <TableCell>Last Message</TableCell>
                <TableCell>Error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(runtime?.decoders ?? []).map((row) => (
                <TableRow key={`${row.timingPointId}:${row.decoderId}`}>
                  <TableCell>{row.timingPointId}</TableCell>
                  <TableCell>{row.decoderId}</TableCell>
                  <TableCell>{row.processStatus}</TableCell>
                  <TableCell>{row.websocketStatus}</TableCell>
                  <TableCell>{row.lastMessageAt ?? "—"}</TableCell>
                  <TableCell>{row.lastError ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(runtime?.decoders ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No decoder runtime data yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Recent Runtime Passings
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Transponder</TableCell>
                <TableCell>Timing Point</TableCell>
                <TableCell>Decoder</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(runtime?.recentPassings ?? []).slice(-30).reverse().map((p) => (
                <TableRow key={p.id}>
                  <TableCell sx={{ fontFamily: "monospace" }}>{p.timestamp}</TableCell>
                  <TableCell>{p.transponderId}</TableCell>
                  <TableCell>{p.timingPointId}</TableCell>
                  <TableCell>{p.decoderId}</TableCell>
                </TableRow>
              ))}
              {(runtime?.recentPassings ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary">No passings yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Results Invalid Events / Unknown Transponders
          </Typography>
          <Stack spacing={0.5}>
            <Typography variant="body2">Unknown transponders: {(results?.unknownTransponders ?? []).join(", ") || "—"}</Typography>
            <Typography variant="body2">Invalid events: {(results?.invalidEvents ?? []).length}</Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
