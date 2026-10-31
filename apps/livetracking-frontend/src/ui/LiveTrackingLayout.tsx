// App bar with the two areas (Zeitmessung, Livetracking) and three plain status chips:
// worker, hardware (connected decoders) and measurement.

import { useEffect, useMemo, useRef } from "react";

import FlagIcon from "@mui/icons-material/Flag";
import { AppBar, Box, Button, Chip, Container, Divider, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import {
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
} from "@raceoffice/domain";
import { Link, Outlet, useBlocker, useLocation } from "react-router-dom";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";
import { decoderHealth, useNow, useTimingDocs, useWorkerState } from "../timing/timingShared";

const ACTIVE_WARNING = "Es läuft noch eine Messung oder Decoder sind verbunden. Bitte erst stoppen bzw. trennen.";

const NAV: Array<{ group: string; items: Array<{ to: string; label: string; match: string[] }> }> = [
  {
    group: "Zeitmessung",
    items: [
      { to: "/timing/control", label: "Control Center", match: ["/timing/control"] },
      { to: "/timing/decoders", label: "Decoder", match: ["/timing/decoders"] },
      { to: "/timing/setups", label: "Setups", match: ["/timing/setups"] },
    ],
  },
  {
    group: "Livetracking",
    items: [
      { to: "/live-tracking/measurement", label: "Messung", match: ["/live-tracking/measurement"] },
      { to: "/live-tracking/participants", label: "Teilnehmer", match: ["/live-tracking/participants"] },
      { to: "/live-tracking/board", label: "Board", match: ["/live-tracking/board"] },
      { to: "/live-tracking/visualization", label: "Visualisierung", match: ["/live-tracking/visualization"] },
    ],
  },
];

export default function LiveTrackingLayout() {
  const location = useLocation();
  const now = useNow(5000);
  const { data: session } = useRealtimeDoc<LiveTrackingSessionDocument>(useMemo(() => makeLiveTrackingSessionDocId(), []));
  const { update: updateRuntime, data: runtimeData } = useRealtimeDoc<LiveTrackingRuntimeDocument>(useMemo(() => makeLiveTrackingRuntimeDocId(), []));
  const { online } = useWorkerState(now);
  const timing = useTimingDocs();

  const wanted = timing.connectedIds.length;
  const connected = timing.connectedIds.filter((id) => decoderHealth(timing.statusById.get(id), now) === "connected").length;
  const measurementState = session?.state ?? "idle";
  const shouldPreventLeaving = measurementState === "running" || wanted > 0;

  // Ask the worker for an immediate heartbeat once, so the worker chip is right on page load.
  const checkSent = useRef(false);
  useEffect(() => {
    if (!runtimeData || checkSent.current) return;
    checkSent.current = true;
    updateRuntime((prev) => ({
      ...prev,
      workerStatusCheck: { action: "checkStatus", requestId: crypto.randomUUID(), requestedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    }));
  }, [runtimeData, updateRuntime]);

  const blocker = useBlocker(({ nextLocation }) => {
    if (!shouldPreventLeaving) return false;
    return !nextLocation.pathname.startsWith("/live-tracking") && !nextLocation.pathname.startsWith("/timing");
  });
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    window.alert(ACTIVE_WARNING);
    blocker.reset();
  }, [blocker.state, blocker.reset]);

  useEffect(() => {
    if (!shouldPreventLeaving) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ACTIVE_WARNING;
      return ACTIVE_WARNING;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [shouldPreventLeaving]);

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
          {NAV.map((group, gi) => (
            <Box key={group.group} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {gi > 0 ? <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: "rgba(255,255,255,0.4)" }} /> : null}
              <Typography variant="subtitle2" sx={{ opacity: 0.8, mr: 0.5 }}>
                {group.group}
              </Typography>
              {group.items.map((item) => (
                <Button
                  key={item.to}
                  color="inherit"
                  size="small"
                  component={Link}
                  to={item.to}
                  variant={item.match.some((m) => location.pathname.startsWith(m)) ? "outlined" : "text"}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          ))}

          <Box sx={{ flexGrow: 1 }} />

          <Box sx={{ display: "flex", gap: 1, mr: 1 }}>
            <Chip size="small" label={`Worker: ${online ? "läuft" : "aus"}`} color={online ? "success" : "default"} />
            <Chip
              size="small"
              label={wanted === 0 ? "Hardware: getrennt" : `Hardware: ${connected}/${wanted} verbunden`}
              color={wanted === 0 ? "default" : connected === wanted ? "success" : "warning"}
            />
            <Chip
              size="small"
              label={`Messung: ${measurementState === "running" ? "läuft" : measurementState === "error" ? "Fehler" : "bereit"}`}
              color={measurementState === "running" ? "success" : measurementState === "error" ? "error" : "default"}
            />
          </Box>

          <Tooltip title="Zurück zu RaceOffice" arrow>
            <IconButton color="inherit" component={Link} to="/" aria-label="Zurück zu RaceOffice">
              <FlagIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container sx={{ py: 4, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
