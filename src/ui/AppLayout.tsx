// src/ui/AppLayout.tsx
import { AppBar, Box, Container, Toolbar, Typography, Button, Chip, Tooltip } from "@mui/material";
import { Link, Outlet } from "react-router-dom";
import { useEventList } from "../providers/EventListProvider";

export default function AppLayout() {
  const { status, error } = useEventList();

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
            <Button color="inherit" component={Link} to="/">
              Active Event
            </Button>
            <Button color="inherit" component={Link} to="/events">
              Events
            </Button>
          </Box>

          {/* spacer */}
          <Box sx={{ flexGrow: 1 }} />

          {/* global status indicator */}
          <Tooltip title={error ?? ""} arrow disableHoverListener={!error}>
            <Chip size="small" variant="outlined" label={label} color={color} sx={{ mr: 2 }} />
          </Tooltip>

          {/* right-aligned button */}
          <Button color="inherit" component={Link} to="/about">
            About
          </Button>
        </Toolbar>
      </AppBar>

      <Container sx={{ py: 4, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}