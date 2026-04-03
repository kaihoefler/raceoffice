// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { RouterProvider } from "react-router-dom";
import { theme } from "./theme";
import { router } from "./router";
// src/main.tsx
import { EventListProvider } from "./providers/EventListProvider";
import { VisualizationListProvider } from "./providers/VisualizationListProvider";
import { RaceStatusProvider } from "./providers/RaceStatusProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <EventListProvider>
        <VisualizationListProvider>
          <RaceStatusProvider>
            <RouterProvider router={router} />
          </RaceStatusProvider>
        </VisualizationListProvider>
      </EventListProvider>
    </ThemeProvider>
  </React.StrictMode>
);
