// src/AppProviders.tsx
//
// The app-wide provider tree (theme, realtime list documents, live race status).
// main.tsx wraps the router in it; component tests (src/test/renderApp.tsx) render the same
// tree, so pages under test see exactly the providers they see in production.

import type { ReactNode } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";

import { theme } from "./theme";
import { EventListProvider } from "./providers/EventListProvider";
import { VisualizationListProvider } from "./providers/VisualizationListProvider";
import { RaceStatusProvider } from "./providers/RaceStatusProvider";

type Props = {
  children: ReactNode;
  /** Live race status feed: tests point it at a mocked timing system with a short interval. */
  raceStatus?: { url?: string; pollIntervalMs?: number };
};

export function AppProviders({ children, raceStatus }: Props) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <EventListProvider>
        <VisualizationListProvider>
          <RaceStatusProvider {...(raceStatus ?? {})}>{children}</RaceStatusProvider>
        </VisualizationListProvider>
      </EventListProvider>
    </ThemeProvider>
  );
}
