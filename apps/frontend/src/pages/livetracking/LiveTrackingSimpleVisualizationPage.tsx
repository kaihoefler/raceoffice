import { useMemo } from "react";

import { Box, Card, CardContent, CardHeader, Divider } from "@mui/material";
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

import LiveTrackingLiveBoard from "../../components/livetracking/LiveTrackingLiveBoard";
import { resolveLiveTrackingDisplayName } from "../../components/livetracking/liveTrackingDisplayName";
import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";

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


  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Card variant="outlined">
        <CardHeader title="Live Board" />
        <Divider />
        <CardContent>
          <LiveTrackingLiveBoard
            athleteLiveStates={results?.athleteLiveStates ?? []}
            resolveDisplayName={(row) =>
              resolveLiveTrackingDisplayName({
                row,
                participantNameByAthleteId,
                participantNameByTransponderId,
              })
            }
            variant="split-columns"
            splitPoints={orderedSplitPoints}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
