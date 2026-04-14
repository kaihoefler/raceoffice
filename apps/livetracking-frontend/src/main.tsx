import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import App from "./App";
import { theme } from "./theme";
import { RealtimeConnectionProvider } from "./realtime/RealtimeConnectionProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RealtimeConnectionProvider>
        <App />
      </RealtimeConnectionProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
