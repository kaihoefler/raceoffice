// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { LiveTrackingVisualizationListProvider } from "./providers/LiveTrackingVisualizationListProvider";
import { RealtimeConnectionProvider } from "./realtime/RealtimeConnectionProvider";
import { theme } from "./theme";


type CryptoWithOptionalRandomUUID = Crypto & {
  randomUUID?: () => string;
};

/**
 * `crypto.randomUUID()` is not available in all HTTP/non-secure contexts.
 *
 * We install a lightweight RFC4122-v4 compatible fallback so existing UI code
 * can keep using `crypto.randomUUID()` without per-call guards.
 */
function installRandomUuidPolyfill() {
  const cryptoObj = globalThis.crypto as CryptoWithOptionalRandomUUID | undefined;
  if (!cryptoObj || typeof cryptoObj.randomUUID === "function") return;

  cryptoObj.randomUUID = () => {
    const bytes = new Uint8Array(16);

    if (typeof cryptoObj.getRandomValues === "function") {
      cryptoObj.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    // RFC4122 version + variant bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  };
}

installRandomUuidPolyfill();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RealtimeConnectionProvider>
        <LiveTrackingVisualizationListProvider>
          <RouterProvider router={router} />
        </LiveTrackingVisualizationListProvider>
      </RealtimeConnectionProvider>
    </ThemeProvider>
  </React.StrictMode>
);

