// src/ui/AppLayout.tsx
import { AppBar, Box, Container, Toolbar, Typography, Button, Chip, Tooltip } from "@mui/material";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useEventList } from "../providers/EventListProvider";


export default function AppLayout() {
  const { status, error } = useEventList();
  const location = useLocation();

  const isScoringPage = /^\/races\/[^/]+\/scoring(\/|$)/.test(location.pathname);
  const isStartersPage = /^\/races\/[^/]+\/starters(\/|$)/.test(location.pathname);

  // Mark "Active Event" as active also while working inside race sub-pages (starters/scoring)
  const isActiveEvent = location.pathname === "/" || isStartersPage || isScoringPage;
  const isEvents = location.pathname.startsWith("/events");
  const isVisualizations = location.pathname.startsWith("/visualizations");
  const isAbout = location.pathname.startsWith("/about");




  const label =
    status === "connected"
      ? "Realtime: OK"
      : status === "connecting"
        ? "Realtime: Connecting…"
        : status === "disconnected"
          ? "Realtime: Disconnected"
          : "Realtime: Error";

  const color =
    status === "connected"
      ? "success"
      : status === "connecting"
        ? "warning"
        : status === "disconnected"
          ? "default"
          : "error";

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">Race Result Management</Typography>

          {/* left-aligned buttons */}
          <Box sx={{ display: "flex", gap: 1, ml: 2 }}>
            <Button color="inherit" component={Link} to="/" variant={isActiveEvent ? "outlined" : "text"}>
              Active Event
            </Button>
            <Button color="inherit" component={Link} to="/events" variant={isEvents ? "outlined" : "text"}>
              Events
            </Button>
            <Button
              color="inherit"
              component={Link}
              to="/visualizations"
              variant={isVisualizations ? "outlined" : "text"}
            >
              Visualizations
            </Button>

          </Box>


          {/* spacer */}
          <Box sx={{ flexGrow: 1 }} />

          {/* global status indicator */}
          <Tooltip title={error ?? ""} arrow disableHoverListener={!error}>
            <Chip size="small" variant="outlined" label={label} color={color} sx={{ mr: 2 }} />
          </Tooltip>

          {/* right-aligned button */}
          <Button color="inherit" component={Link} to="/about" variant={isAbout ? "outlined" : "text"}>
            About
          </Button>

        </Toolbar>
      </AppBar>

      {isScoringPage ? (
        <Box sx={{ py: 4, flex: 1, width: "100%", px: { xs: 1, sm: 2 } }}>
          <Outlet />
        </Box>
      ) : (
        <Container sx={{ py: 4, flex: 1 }}>
          <Outlet />
        </Container>
      )}

    </Box>
  );
}