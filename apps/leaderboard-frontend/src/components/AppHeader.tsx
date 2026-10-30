// Slim app bar: navigation, service/Orbits status, REPLAY hint, display settings.

import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import type { UiSettings } from "../App";
import { useServiceStatus } from "../hooks/useServiceStatus";
import { toggleFullscreen } from "./fullscreen";

type Props = { ui: UiSettings; onUiChange: (ui: UiSettings) => void };

export function AppHeader({ ui, onUiChange }: Props) {
  const { status, connected } = useServiceStatus();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const orbits = status?.client.state ?? null;
  const replay = status?.source === "player";

  const navSx = {
    color: "inherit",
    "&.active": { fontWeight: 700, borderBottom: "2px solid currentColor", borderRadius: 0 },
  } as const;

  return (
    <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant="dense" sx={{ gap: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mr: 1 }}>
          Leaderboard
        </Typography>
        <Button component={NavLink} to="/" end size="small" sx={navSx}>
          Rangliste
        </Button>
        <Button component={NavLink} to="/control" size="small" sx={navSx}>
          Control Center
        </Button>
        <Box sx={{ flex: 1 }} />
        {replay ? <Chip size="small" color="warning" label="REPLAY" sx={{ fontWeight: 700 }} /> : null}
        {status?.recorder.active ? <Chip size="small" color="error" variant="outlined" label="● REC" /> : null}
        <Chip
          size="small"
          variant="outlined"
          color={!connected ? "error" : replay ? "warning" : orbits === "connected" ? "success" : orbits === "stopped" ? "default" : "warning"}
          label={!connected ? "Service getrennt" : replay ? "Replay" : `Orbits: ${orbitsLabel(orbits)}`}
        />
        <Tooltip title="Anzeige">
          <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Anzeige-Einstellungen">
            <TextFieldsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={ui.dark ? "Hell" : "Dunkel"}>
          <IconButton size="small" onClick={() => onUiChange({ ...ui, dark: !ui.dark })} aria-label="Hell/Dunkel">
            {ui.dark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Vollbild (Taste F)">
          <IconButton size="small" onClick={toggleFullscreen} aria-label="Vollbild">
            <FullscreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
          <MenuItem disableRipple sx={{ display: "block", width: 260 }}>
            <Typography variant="caption">Schriftgröße ({Math.round(ui.scale * 100)} %)</Typography>
            <Slider
              size="small"
              min={0.8}
              max={2.5}
              step={0.1}
              value={ui.scale}
              onChange={(_, v) => onUiChange({ ...ui, scale: v as number })}
              aria-label="Schriftgröße"
            />
          </MenuItem>
          <MenuItem disableRipple sx={{ display: "block" }}>
            <Typography variant="caption" sx={{ display: "block", mb: 0.5 }}>
              Zeilenhöhe
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={ui.density}
              onChange={(_, v: UiSettings["density"] | null) => v && onUiChange({ ...ui, density: v })}
            >
              <ToggleButton value="compact">kompakt</ToggleButton>
              <ToggleButton value="normal">normal</ToggleButton>
              <ToggleButton value="large">groß</ToggleButton>
            </ToggleButtonGroup>
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}

export function orbitsLabel(state: string | null): string {
  switch (state) {
    case "connected":
      return "verbunden";
    case "connecting":
      return "verbinde…";
    case "retrying":
      return "neuer Versuch";
    case "error":
      return "Fehler";
    case "stopped":
      return "getrennt";
    default:
      return "—";
  }
}
