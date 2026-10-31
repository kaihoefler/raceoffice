// Lap Counter (doc/leaderboard-integration/06-frontend.md, section 6)
//
// One large number, white on black, with the flag colour as a stripe at the bottom.
// - "Laps to go" (default) or "laps complete" (?mode=up)
// - Update delay (default 5 s, ?delay=5): the number switches only a few seconds after the leader
//   crossed the line, so riders see the new value when they look up, like the Java Swing app
// - 1 lap to go: "LAST LAP" with a swinging bell
// - FINISH: plain black with "FINISH" and a small chequered bar below it (like the start signal;
//   a full chequered background is too restless)
// For the lap board at the line: /ui/?kiosk=1#/lap-counter?delay=5

import { Box, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Typography, keyframes } from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import { useQueryParam } from "../App";
import { checkeredSx } from "../components/Checkered";
import { flagStyle } from "../components/FlagBanner";
import { useDelayedValue } from "../hooks/useDelayedValue";
import { STALE_AFTER_MS, useLeaderboardStream, useNow } from "../hooks/useLeaderboardStream";
import { useStoredState } from "../hooks/useStoredState";

const swing = keyframes`
  0%, 100% { transform: rotate(0deg); }
  20% { transform: rotate(18deg); }
  40% { transform: rotate(-14deg); }
  60% { transform: rotate(8deg); }
  80% { transform: rotate(-4deg); }
`;

export type LapCounterSettings = { mode: "down" | "up"; delaySeconds: number };
export const DEFAULT_LAP_COUNTER: LapCounterSettings = { mode: "down", delaySeconds: 5 };
const DELAYS = [0, 3, 5, 8, 10];

export function LapCounterPage({ kiosk }: { kiosk: boolean }) {
  const [settings, setSettings] = useStoredState<LapCounterSettings>("leaderboard.lapCounter", DEFAULT_LAP_COUNTER);
  const modeParam = useQueryParam("mode");
  const delayParam = useQueryParam("delay");
  // URL parameters (kiosk setups) win over the settings stored on the device.
  const mode = modeParam === "up" || modeParam === "down" ? modeParam : settings.mode;
  const delayFromUrl = delayParam !== null && Number(delayParam) >= 0 ? Number(delayParam) : null;
  const delaySeconds = delayFromUrl ?? settings.delaySeconds;

  const { race, connected, lastUpdateAt } = useLeaderboardStream("current");
  const now = useNow(1000);
  const stale = !connected || lastUpdateAt === null || now - lastUpdateAt > STALE_AFTER_MS;
  const hasRace = race !== null && race.raceID !== -1;
  const flag = hasRace ? String(race.flagStatus ?? "NONE").toUpperCase() : "NONE";

  const raw = hasRace ? { toGo: race.lapsToGo, done: race.lapsComplete, finish: flag === "FINISH" } : null;
  // Delay the whole lap state, so number, LAST LAP and FINISH switch together.
  const shown = useDelayedValue(raw ? `${raw.toGo}|${raw.done}|${raw.finish ? 1 : 0}` : null, delaySeconds * 1000, race?.raceID ?? null);
  const [toGo = 0, done = 0, finishFlag = 0] = shown ? shown.split("|").map(Number) : [];
  const finish = finishFlag === 1;
  const lastLap = !finish && toGo === 1;
  const value = mode === "down" ? toGo : done;
  const digits = String(value).length;

  return (
    <Box
      role="region"
      aria-label="Rundenzähler"
      sx={{ flex: 1, minHeight: "60vh", position: "relative", display: "flex", flexDirection: "column", bgcolor: "#000", color: "#fff" }}
    >
      {kiosk ? null : (
        <Box sx={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 1, alignItems: "center", zIndex: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            disabled={modeParam === "up" || modeParam === "down"}
            onChange={(_, v: LapCounterSettings["mode"] | null) => v && setSettings({ ...settings, mode: v })}
            sx={{ bgcolor: "rgba(255,255,255,0.9)" }}
          >
            <ToggleButton value="down">Noch</ToggleButton>
            <ToggleButton value="up">Gefahren</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            label="Verzögerung"
            value={delaySeconds}
            disabled={delayFromUrl !== null}
            onChange={(e) => setSettings({ ...settings, delaySeconds: Number(e.target.value) })}
            sx={{ bgcolor: "rgba(255,255,255,0.9)", borderRadius: 1, minWidth: 120 }}
          >
            {[...new Set([...DELAYS, delaySeconds])].map((d) => (
              <MenuItem key={d} value={d}>
                {d === 0 ? "keine" : `${d} s`}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!hasRace ? (
          <Typography sx={{ fontSize: "6vmin", opacity: 0.7 }}>Kein aktives Rennen</Typography>
        ) : finish ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4vmin" }}>
            <Typography sx={{ fontSize: "16vmin", fontWeight: 900, lineHeight: 1 }}>FINISH</Typography>
            {/* Two rows of large squares: recognisable as the chequered flag without flickering. */}
            <Box aria-hidden sx={{ ...checkeredSx(64), width: "min(60vw, 768px)", height: 64, borderRadius: 1 }} />
          </Box>
        ) : (
          <>
            <Typography
              aria-label={mode === "down" ? "Runden noch" : "Runden gefahren"}
              sx={{
                fontSize: digits >= 3 ? "min(55vh, 30vw)" : "min(70vh, 48vw)",
                fontWeight: 900,
                lineHeight: 0.9,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </Typography>
            {lastLap ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2, color: "#ffeb3b" }}>
                <NotificationsActiveIcon sx={{ fontSize: "10vmin", animation: `${swing} 1.2s ease-in-out infinite`, transformOrigin: "50% 10%" }} />
                <Typography sx={{ fontSize: "10vmin", fontWeight: 900, letterSpacing: 4 }}>LAST LAP</Typography>
              </Box>
            ) : (
              <Typography sx={{ fontSize: "5vmin", opacity: 0.6, letterSpacing: 4, textTransform: "uppercase" }}>
                {mode === "down" ? "Runden noch" : "Runden gefahren"}
              </Typography>
            )}
          </>
        )}
      </Box>

      <Box aria-label={`Flagge ${flagStyle(flag).label}`} sx={{ height: "6vh", minHeight: 24, bgcolor: flagStyle(flag).bg }} />
      {stale ? (
        <Typography variant="caption" sx={{ position: "absolute", left: 12, bottom: "calc(6vh + 8px)", opacity: 0.7 }}>
          keine aktuellen Daten
        </Typography>
      ) : null}
    </Box>
  );
}
