// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { RouterProvider } from "react-router-dom";
import { theme } from "./theme";
import { router } from "./router";
// src/main.tsx
import { EventListProvider } from "./providers/EventListProvider";
import { RaceStatusProvider } from "./providers/RaceStatusProvider";
import { RaceStatusTimeProvider } from "./providers/RaceStatusTimeProvider";
import { RaceStatusBibProvider } from "./providers/RaceStatusBibProvider";
import { RaceStatusMetaProvider } from "./providers/RaceStatusMetaProvider";
import { RaceStatusCompetitorsProvider } from "./providers/RaceStatusCompetitorsProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <EventListProvider>
        <RaceStatusProvider>
          <RaceStatusTimeProvider>
            <RaceStatusMetaProvider>
              <RaceStatusCompetitorsProvider>
                <RaceStatusBibProvider>
                  <RouterProvider router={router} />
                </RaceStatusBibProvider>
              </RaceStatusCompetitorsProvider>
            </RaceStatusMetaProvider>
          </RaceStatusTimeProvider>
        </RaceStatusProvider>
      </EventListProvider>
    </ThemeProvider>
  </React.StrictMode>
);
