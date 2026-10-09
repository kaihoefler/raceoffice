// src/AppProviders.tsx
//
// The app-wide provider tree (theme, realtime connection state, visualization list).
// main.tsx wraps the router in it; component tests (src/test/renderApp.tsx) render the same
// tree, so pages under test see exactly the providers they see in production.

import type { ReactNode } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";

import { theme } from "./theme";
import { LiveTrackingVisualizationListProvider } from "./providers/LiveTrackingVisualizationListProvider";
import { RealtimeConnectionProvider } from "./realtime/RealtimeConnectionProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RealtimeConnectionProvider>
        <LiveTrackingVisualizationListProvider>{children}</LiveTrackingVisualizationListProvider>
      </RealtimeConnectionProvider>
    </ThemeProvider>
  );
}
