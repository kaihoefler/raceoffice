import { useEffect, useMemo, useRef, useState } from "react";

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
const WORKER_HEARTBEAT_STALE_MS = 30_000;
const WORKER_STATUS_CHECK_TIMEOUT_MS = 5_000;

export default function LiveTrackingLayout() {
  const location = useLocation();

  const sessionDocId = useMemo(() => makeLiveTrackingSessionDocId(), []);
  const runtimeDocId = useMemo(() => makeLiveTrackingRuntimeDocId(), []);

  const { data: session, status: sessionStatus } = useRealtimeDoc<LiveTrackingSessionDocument>(sessionDocId);
  const { data: runtime, update: updateRuntime } = useRealtimeDoc<LiveTrackingRuntimeDocument>(runtimeDocId);

  const [workerCheckPhase, setWorkerCheckPhase] = useState<"idle" | "waiting" | "acked" | "timeout">("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasSentInitialWorkerStatusCheckRef = useRef(false);
  const pendingWorkerStatusCheckRef = useRef<{ requestId: string; requestedAtMs: number } | null>(null);
  const workerStatusCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const heartbeatMs = Number.isFinite(Date.parse(String(runtime?.workerHeartbeatAt ?? "")))
    ? Date.parse(String(runtime?.workerHeartbeatAt ?? ""))
    : Number.NaN;
  const heartbeatFresh = Number.isFinite(heartbeatMs) && nowMs - heartbeatMs <= WORKER_HEARTBEAT_STALE_MS;

  const workerState: LiveTrackingRuntimeDocument["workerStatus"] = heartbeatFresh
    ? (runtime?.workerStatus ?? "offline")
    : "offline";
  const liveTrackingState = session?.state ?? "idle";
  const shouldPreventLeaving = workerState !== "offline" || liveTrackingState !== "idle";

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!runtime) return;
    if (hasSentInitialWorkerStatusCheckRef.current) return;

    hasSentInitialWorkerStatusCheckRef.current = true;

    const requestId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const requestedAtMs = Date.parse(requestedAt);

    pendingWorkerStatusCheckRef.current = { requestId, requestedAtMs };
    setWorkerCheckPhase("waiting");

    updateRuntime((prev) => ({
      ...prev,
      workerStatusCheck: {
        action: "checkStatus",
        requestId,
        requestedAt,
      },
      updatedAt: new Date().toISOString(),
    }));

    workerStatusCheckTimeoutRef.current = setTimeout(() => {
      if (pendingWorkerStatusCheckRef.current?.requestId !== requestId) return;
      pendingWorkerStatusCheckRef.current = null;
      setWorkerCheckPhase("timeout");
    }, WORKER_STATUS_CHECK_TIMEOUT_MS);
  }, [runtime, updateRuntime]);

  useEffect(() => {
    const pending = pendingWorkerStatusCheckRef.current;
    if (!pending || !runtime) return;

    const checkStillPending = runtime.workerStatusCheck?.requestId === pending.requestId;
    if (checkStillPending) return;

    const ackMs = Number.isFinite(Date.parse(String(runtime.lastCheckAckAt ?? "")))
      ? Date.parse(String(runtime.lastCheckAckAt ?? ""))
      : Number.NaN;
    const latestHeartbeatMs = Number.isFinite(Date.parse(String(runtime.workerHeartbeatAt ?? "")))
      ? Date.parse(String(runtime.workerHeartbeatAt ?? ""))
      : Number.NaN;

    const acknowledged =
      (Number.isFinite(ackMs) && ackMs >= pending.requestedAtMs) ||
      (Number.isFinite(latestHeartbeatMs) && latestHeartbeatMs >= pending.requestedAtMs);

    if (!acknowledged) return;

    pendingWorkerStatusCheckRef.current = null;
    if (workerStatusCheckTimeoutRef.current) {
      clearTimeout(workerStatusCheckTimeoutRef.current);
      workerStatusCheckTimeoutRef.current = null;
    }
    setWorkerCheckPhase("acked");
  }, [runtime]);

  useEffect(() => {
    return () => {
      if (!workerStatusCheckTimeoutRef.current) return;
      clearTimeout(workerStatusCheckTimeoutRef.current);
      workerStatusCheckTimeoutRef.current = null;
    };
  }, []);

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
            <Chip
              size="small"
              label={`Worker State: ${workerState}${workerCheckPhase === "waiting" ? " (check…)" : workerCheckPhase === "timeout" ? " (check timeout)" : ""}`}
              color={workerStatusColor(workerState)}
            />
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
