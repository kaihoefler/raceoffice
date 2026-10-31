// Start Signal (doc/leaderboard-integration/06-frontend.md, section 5)
//
// Full screen in the flag colour: race name at the top, race clock at the bottom.
// - PURPLE: start numbers of the entered riders as a grid (start line-up)
// - GREEN:  a large "GO" for the first seconds, then just the running clock
// - YELLOW/RED: the flag name; FINISH: chequered background
// For a monitor at the start line: /ui/?kiosk=1#/start-signal (optionally &scale=…)

import { Box, Typography } from "@mui/material";
import { parseTimeToSeconds } from "@raceoffice/domain";
import type { UiSettings } from "../App";
import { checkeredSx } from "../components/Checkered";
import { flagStyle } from "../components/FlagBanner";
import { STALE_AFTER_MS, useLeaderboardStream, useNow } from "../hooks/useLeaderboardStream";

/** "GO" stays this long after the start, then the clock is enough. */
export const GO_SECONDS = 5;

export function StartSignalPage({ ui }: { ui: UiSettings }) {
  const { race, connected, lastUpdateAt } = useLeaderboardStream("current");
  const now = useNow(1000);
  const stale = !connected || lastUpdateAt === null || now - lastUpdateAt > STALE_AFTER_MS;
  const hasRace = race !== null && race.raceID !== -1;
  const flag = hasRace ? String(race.flagStatus ?? "NONE").toUpperCase() : "NONE";
  const style = flagStyle(flag);
  const finish = flag === "FINISH";
  const elapsed = parseTimeToSeconds(race?.elapsedTime ?? "") ?? 0;
  const bibs = hasRace
    ? [...race.competitors].map((c) => c.number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  const s = ui.scale;
  // Text on the chequered flag needs its own dark plate to stay readable.
  const plate = finish ? { bgcolor: "rgba(0,0,0,0.8)", px: 3, borderRadius: 2 } : {};

  let center: React.ReactNode = null;
  if (!hasRace) center = <Big s={s}>Kein aktives Rennen</Big>;
  else if (flag === "PURPLE") {
    center = (
      <Box
        aria-label="Startaufstellung"
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${7 * s}rem, 1fr))`,
          gap: 2,
          width: "100%",
          maxWidth: 1600,
        }}
      >
        {bibs.map((bib) => (
          <Box
            key={bib}
            sx={{ bgcolor: "rgba(255,255,255,0.15)", borderRadius: 2, textAlign: "center", py: 1 }}
          >
            <Typography sx={{ fontSize: `${3.5 * s}rem`, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
              {bib}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  } else if (flag === "GREEN" && elapsed < GO_SECONDS) center = <Big s={s * 2.5}>GO</Big>;
  else if (flag === "YELLOW" || flag === "RED" || finish) center = <Big s={s * 1.6} sx={plate}>{style.label}</Big>;

  return (
    <Box
      role="region"
      aria-label={`Startsignal ${style.label}`}
      sx={{
        flex: 1,
        minHeight: "60vh",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 3,
        p: 3,
        color: style.fg,
        bgcolor: style.bg,
        ...(finish ? checkeredSx(96) : {}),
        transition: "background-color 0.3s",
      }}
    >
      <Typography component="h1" sx={{ fontSize: `${2.4 * s}rem`, fontWeight: 700, textAlign: "center", ...plate }}>
        {hasRace ? race.raceName : " "}
      </Typography>
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>{center}</Box>
      <Typography
        aria-label="Rennzeit"
        sx={{ fontSize: `${6 * s}rem`, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", ...plate }}
      >
        {hasRace ? race.elapsedTime : ""}
      </Typography>
      {stale ? (
        <Typography variant="caption" sx={{ position: "absolute", right: 12, bottom: 8, opacity: 0.8, ...plate }}>
          keine aktuellen Daten
        </Typography>
      ) : null}
    </Box>
  );
}

function Big({ s, children, sx }: { s: number; children: React.ReactNode; sx?: object }) {
  return (
    <Typography sx={{ fontSize: `${6 * s}rem`, fontWeight: 900, lineHeight: 1, textAlign: "center", letterSpacing: 2, ...sx }}>
      {children}
    </Typography>
  );
}
