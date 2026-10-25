import { useMemo } from "react";

import { Box, Card, CardContent, CardHeader, Divider } from "@mui/material";
import {
  makeLiveTrackingResultsDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeTimingPoints,
  type LiveTrackingResultsDocument,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
} from "@raceoffice/domain";

import LiveTrackingLiveBoard from "../../components/livetracking/LiveTrackingLiveBoard";
import { liveStateDisplayName } from "../../components/livetracking/liveTrackingDisplayName";
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
            // Names come from the results rows (resolved by the worker from the active pools).
            resolveDisplayName={liveStateDisplayName}
            variant="split-columns"
            splitPoints={orderedSplitPoints}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
