// App shell: theme (light/dark), routes, slim app bar (hidden in kiosk mode).
//
// Routes (HashRouter, works behind the /leaderboard proxy without rewrites):
//   #/          Leaderboard
//   #/control   Control Center

import { useMemo } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Box, CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { AppHeader } from "./components/AppHeader";
import { useStoredState } from "./hooks/useStoredState";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { ControlCenterPage } from "./pages/ControlCenterPage";

export type UiSettings = {
  dark: boolean;
  /** Font scale of the leaderboard, 0.8 … 2.5 */
  scale: number;
  density: "compact" | "normal" | "large";
};

export const DEFAULT_UI: UiSettings = { dark: false, scale: 1, density: "normal" };

/** Query parameters can come before the hash (/ui/?kiosk=1#/) or inside it (#/?kiosk=1). */
export function useQueryParam(name: string): string | null {
  const location = useLocation();
  return new URLSearchParams(location.search).get(name) ?? new URLSearchParams(globalThis.location?.search ?? "").get(name);
}

export function App() {
  const [ui, setUi] = useStoredState<UiSettings>("leaderboard.ui", DEFAULT_UI);
  const kiosk = useQueryParam("kiosk") === "1";
  const scaleParam = Number(useQueryParam("scale"));
  const effectiveUi: UiSettings = Number.isFinite(scaleParam) && scaleParam > 0 ? { ...ui, scale: scaleParam } : ui;

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: ui.dark ? "dark" : "light",
          primary: { main: ui.dark ? "#90caf9" : "#1565c0" },
          background: ui.dark ? { default: "#0b0f14", paper: "#121821" } : { default: "#f6f7f9" },
        },
        typography: { fontFamily: "Roboto, system-ui, sans-serif" },
      }),
    [ui.dark],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", cursor: kiosk ? "none" : undefined }}>
        {kiosk ? null : <AppHeader ui={ui} onUiChange={setUi} />}
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          <Routes>
            <Route path="/" element={<LeaderboardPage ui={effectiveUi} kiosk={kiosk} />} />
            <Route path="/control" element={<ControlCenterPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
