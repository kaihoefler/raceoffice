import { useMemo } from "react";

import { Box, Card, CardContent, CardHeader, Divider, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import {
  makeLiveTrackingParticipantPoolDocId,
  makeLiveTrackingResultsDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  type LiveTrackingParticipantPoolDocument,
  type LiveTrackingResultsDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
} from "@raceoffice/domain";

import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}s`;
}

export default function LiveTrackingSimpleVisualizationPage() {
  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const resultsDocId = useMemo(() => makeLiveTrackingResultsDocId(), []);

  const { data: session } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);
  const { data: results } = useRealtimeDoc<LiveTrackingResultsDocument>(resultsDocId);

  const setupDocId = useMemo(() => {
    const setupId = String(session?.setupId ?? "").trim();
    return setupId ? makeLiveTrackingSetupDocId(setupId) : null;
  }, [session?.setupId]);
  const { data: setupDoc } = useRealtimeDoc<LiveTrackingSetupDocument>(setupDocId);

  const sessionParticipantPoolDocId = useMemo(() => {
    if (!session) return "";

    if (session.participantSource.kind === "event_participant_pool") {
      return session.participantSource.participantPoolDocId;
    }

    if (session.participantSource.kind === "setup_participant_pool") {
      return session.participantSource.participantPoolDocId;
    }

    return makeLiveTrackingParticipantPoolDocId(session.participantSource.eventId);
  }, [session]);

  const { data: participantPoolDoc } = useRealtimeDoc<LiveTrackingParticipantPoolDocument>(
    sessionParticipantPoolDocId.trim() || null,
  );

  const participantNameByAthleteId = useMemo(() => {
    const map = new Map<string, string>();
    for (const athlete of participantPoolDoc?.athletes ?? []) {
      const fullName = `${String(athlete.firstName ?? "").trim()} ${String(athlete.lastName ?? "").trim()}`.trim();
      if (!fullName) continue;
      map.set(athlete.id, fullName);
    }
    return map;
  }, [participantPoolDoc]);

  const participantNameByTransponderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const athlete of participantPoolDoc?.athletes ?? []) {
      const fullName = `${String(athlete.firstName ?? "").trim()} ${String(athlete.lastName ?? "").trim()}`.trim();
      if (!fullName) continue;

      for (const raw of athlete.transponderIds ?? []) {
        const transponderId = String(raw ?? "").trim();
        if (!transponderId) continue;
        if (!map.has(transponderId)) map.set(transponderId, fullName);
      }
    }
    return map;
  }, [participantPoolDoc]);

  const orderedSplitPoints = useMemo(() => {
    return normalizeTimingPoints(setupDoc?.track.timingPoints ?? []).filter((point) => point.role !== "start_finish");
  }, [setupDoc]);

  const sortedAthleteLiveStates = useMemo(() => {
    const rows = [...(results?.athleteLiveStates ?? [])];
    rows.sort((a, b) => {
      const ams = a.lastPassingAt ? Date.parse(a.lastPassingAt) : Number.NEGATIVE_INFINITY;
      const bms = b.lastPassingAt ? Date.parse(b.lastPassingAt) : Number.NEGATIVE_INFINITY;
      return bms - ams;
    });
    return rows;
  }, [results]);

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
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
                <TableCell align="right">Best lap</TableCell>
                <TableCell align="right">Last lap</TableCell>
                {orderedSplitPoints.map((point) => (
                  <TableCell key={point.id} align="right">
                    {String(point.name ?? "").trim() || point.id}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedAthleteLiveStates.map((row) => {
                const participantName = participantNameByAthleteId.get(row.athleteId) ?? null;
                const participantNameByChip = row.transponderId
                  ? participantNameByTransponderId.get(String(row.transponderId).trim()) ?? null
                  : null;
                const computedName = `${String(row.firstName ?? "").trim()} ${String(row.lastName ?? "").trim()}`.trim();
                const syntheticUnknownName = computedName === String(row.transponderId ?? "").trim();
                const displayName =
                  participantName ||
                  participantNameByChip ||
                  (!syntheticUnknownName ? computedName : "") ||
                  row.athleteId;

                const splitByTimingPointId = new Map(row.currentLapSplits.map((split) => [split.timingPointId, split.splitTimeMs]));

                return (
                  <TableRow key={row.athleteId}>
                    <TableCell>{displayName}</TableCell>
                    <TableCell>{row.activityStatus}</TableCell>
                    <TableCell align="right">{row.lapsCompleted}</TableCell>
                    <TableCell align="right">{formatMs(row.bestLapTimeMs)}</TableCell>
                    <TableCell align="right">{formatMs(row.lastLapTimeMs)}</TableCell>
                    {orderedSplitPoints.map((point) => (
                      <TableCell key={`${row.athleteId}:${point.id}`} align="right">
                        {formatMs(splitByTimingPointId.get(point.id) ?? null)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}

              {sortedAthleteLiveStates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5 + orderedSplitPoints.length}>
                    <Typography color="text.secondary">No live athletes yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
