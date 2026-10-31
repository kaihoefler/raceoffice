// Control Center card "Aktives Setup": choose the setup, see its decoders, connect them.
// The LiveTracking measurement uses this setup (one place to choose).

import { Alert, Button, Card, CardContent, CardHeader, Chip, Divider, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { connectTimingDecoders } from "@raceoffice/domain";
import { Link as RouterLink } from "react-router-dom";

import { decoderHealth, HEALTH_COLOR, HEALTH_LABEL, nowIso, type useTimingDocs } from "../../timing/timingShared";
import { useActiveSetup } from "../../timing/useActiveSetup";

export function ActiveSetupCard({ timing, now }: { timing: ReturnType<typeof useTimingDocs>; now: number }) {
  const active = useActiveSetup();
  const connected = new Set(timing.connectedIds);
  const rows = active.decoderIds.map((id) => ({ id, decoder: timing.decoders.find((d) => d.id === id) ?? null }));
  const registered = rows.filter((r) => r.decoder).map((r) => r.id);
  const missing = rows.filter((r) => !r.decoder);
  const allConnected = registered.length > 0 && registered.every((id) => connected.has(id));
  const onlySetup = allConnected && timing.connectedIds.every((id) => registered.includes(id));

  return (
    <Card variant="outlined">
      <CardHeader title="Aktives Setup" subheader="Strecke, deren Decoder verbunden werden; die Messung im Livetracking verwendet dieses Setup" />
      <Divider />
      <CardContent>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
            <TextField
              select
              size="small"
              label="Setup"
              value={active.setups.some((s) => s.setupId === active.activeSetupId) ? active.activeSetupId : ""}
              disabled={active.measurementRunning}
              onChange={(e) => active.activate(e.target.value)}
              sx={{ minWidth: 280 }}
              helperText={active.measurementRunning ? "Während einer Messung nicht änderbar" : undefined}
            >
              {active.setups.map((s) => (
                <MenuItem key={s.setupId} value={s.setupId}>
                  {s.name || s.setupId}
                </MenuItem>
              ))}
            </TextField>
            <Button size="small" component={RouterLink} to="/timing/setups">
              Setups bearbeiten
            </Button>
          </Stack>

          {active.setup ? (
            <>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }} aria-label="Decoder des aktiven Setups">
                {rows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Das Setup hat keine aktiven Timing-Points.
                  </Typography>
                ) : (
                  rows.map(({ id, decoder }) => {
                    const health = connected.has(id) ? decoderHealth(timing.statusById.get(id), now) : "disconnected";
                    return (
                      <Chip
                        key={id}
                        variant="outlined"
                        color={decoder ? HEALTH_COLOR[health] : "error"}
                        label={`${decoder?.name ?? id}: ${decoder ? HEALTH_LABEL[health] : "nicht im Register"}`}
                      />
                    );
                  })
                )}
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={registered.length === 0 || allConnected}
                  onClick={() => timing.updateConnection((prev) => connectTimingDecoders(prev, registered, "add", nowIso()))}
                >
                  Decoder des Setups verbinden
                </Button>
                <Button
                  variant="outlined"
                  disabled={registered.length === 0 || onlySetup}
                  onClick={() => timing.updateConnection((prev) => connectTimingDecoders(prev, registered, "only", nowIso()))}
                >
                  Nur diese verbinden
                </Button>
              </Stack>
              {missing.length > 0 ? (
                <Alert severity="warning">
                  {missing.length} Timing-Point(s) ohne Decoder aus dem Register – unter „Setups“ zuordnen.
                </Alert>
              ) : null}
            </>
          ) : (
            <Typography color="text.secondary">Noch kein Setup aktiviert.</Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
