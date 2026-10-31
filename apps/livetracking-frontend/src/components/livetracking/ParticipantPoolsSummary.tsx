// Participant pools linked to a setup (names from the LiveTracking list), active ones marked.
// The pools are managed on the "Teilnehmer" page, which works on the setup of the measurement.

import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { makeLiveTrackingListDocId, type LiveTrackingListDocument, type LiveTrackingSetupDocument } from "@raceoffice/domain";
import { Link as RouterLink } from "react-router-dom";

import { useRealtimeDoc } from "../../realtime/useRealtimeDoc";

export function ParticipantPoolsSummary(props: { setup: LiveTrackingSetupDocument; manageable: boolean }) {
  const { data: list } = useRealtimeDoc<LiveTrackingListDocument>(makeLiveTrackingListDocId());
  const linked = props.setup.participantPoolIds ?? [];
  const active = new Set(props.setup.activeParticipantPoolIds ?? []);
  const nameOf = (id: string) => list?.participantPools.find((p) => p.poolId === id)?.name ?? id;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle2">Teilnehmer-Pools</Typography>
        {props.manageable ? (
          <Button size="small" component={RouterLink} to="/live-tracking/participants">
            Teilnehmer verwalten →
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary">
            (verwaltet werden die Pools des Setups der Messung unter „Teilnehmer“)
          </Typography>
        )}
      </Stack>
      {linked.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Noch keine Pools verknüpft.
        </Typography>
      ) : (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} aria-label="Teilnehmer-Pools">
          {linked.map((id) => (
            <Chip key={id} size="small" label={`${nameOf(id)}${active.has(id) ? " (aktiv)" : ""}`} color={active.has(id) ? "primary" : "default"} variant={active.has(id) ? "filled" : "outlined"} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
