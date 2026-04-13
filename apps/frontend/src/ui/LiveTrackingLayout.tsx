import { useEffect, useMemo } from "react";

import FlagIcon from "@mui/icons-material/Flag";
import { AppBar, Box, Button, Chip, Container, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import {
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  type LiveTrackingRuntimeDocument,
  type LiveTrackingSessionDocument,
} from "@raceoffice/domain";
import { Link, Outlet, useBlocker, useLocation } from "react-router-dom";

import { useRealtimeDoc } from "../realtime/useRealtimeDoc";

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
  return "default" as const;
}

const ACTIVE_WARNING = "Live Tracking is still activated. Please stop Live Tracking bevore closing this page.";

export default function LiveTrackingLayout() {
  const location = useLocation();

  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const runtimeDocId = useMemo(() => makeLiveTrackingRuntimeDocId(), []);

  const { data: session, status: sessionStatus } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);
  const { data: runtime } = useRealtimeDoc<LiveTrackingRuntimeDocument>(runtimeDocId);

  const workerState = runtime?.workerStatus ?? "offline";
  const liveTrackingState = session?.state ?? "idle";
  const shouldPreventLeaving = workerState !== "offline" || liveTrackingState !== "idle";

  const blocker = useBlocker(({ nextLocation }) => {
    if (!shouldPreventLeaving) return false;
    return !nextLocation.pathname.startsWith("/live-tracking");
  });

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    window.alert(ACTIVE_WARNING);
    blocker.reset();
  }, [blocker.state, blocker.reset]);

  const isSetup =
    location.pathname === "/live-tracking" ||
    location.pathname.startsWith("/live-tracking/setup") ||
    location.pathname.startsWith("/live-tracking/participants");
  const isVisualization = location.pathname.startsWith("/live-tracking/visualization");
  const isBoard = location.pathname.startsWith("/live-tracking/board");

  useEffect(() => {
    if (!shouldPreventLeaving) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ACTIVE_WARNING;
      return ACTIVE_WARNING;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shouldPreventLeaving]);

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">Live Tracking</Typography>

          <Box sx={{ display: "flex", gap: 1, ml: 2 }}>
            <Button color="inherit" component={Link} to="/live-tracking/setup" variant={isSetup ? "outlined" : "text"}>
              Setup
            </Button>
            <Button
              color="inherit"
              component={Link}
              to="/live-tracking/visualization"
              variant={isVisualization ? "outlined" : "text"}
            >
              Visualizations
            </Button>
            <Button color="inherit" component={Link} to="/live-tracking/board" variant={isBoard ? "outlined" : "text"}>
              Board
            </Button>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Box sx={{ display: "flex", gap: 1, mr: 1 }}>
            <Chip size="small" label={`Control Link: ${sessionStatus}`} color={sessionStatus === "connected" ? "success" : "default"} />
            <Chip size="small" label={`Worker State: ${workerState}`} color={workerStatusColor(runtime?.workerStatus)} />
            <Chip size="small" label={`LiveTracking State: ${liveTrackingState}`} color={liveTrackingStateColor(session?.state)} />
          </Box>

          <Tooltip title="Back to Race Result Management" arrow>
            <IconButton color="inherit" component={Link} to="/" aria-label="Back to Race Result Management">
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
