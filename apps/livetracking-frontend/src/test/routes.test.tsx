// Route smoke test: every route of the LiveTracking app renders its page with the server's
// bootstrap documents, without React/MUI errors. Cheap first alarm after a dependency upgrade.

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { renderApp } from "./renderApp";

/** Route (below /livetracking), something only that page shows, and where the router ends up. */
const ROUTES: Array<[route: string, marker: () => Promise<HTMLElement>, pathname?: string]> = [
  ["/", () => screen.findByText("Tracking Control"), "/livetracking/live-tracking/setup"],
  ["/live-tracking", () => screen.findByText("Tracking Control"), "/livetracking/live-tracking/setup"],
  ["/live-tracking/setup", () => screen.findByText("Tracking Control")],
  ["/live-tracking/participants", () => screen.findByText("Setup Participant Pools")],
  ["/live-tracking/visualization", () => screen.findByText("Live Tracking Visualizations")],
  ["/live-tracking/board", () => screen.findByText("Live Board")],
  ["/live-tracking/visualizer", () => screen.findByText("No active Live Tracking visualization selected.")],
  ["/live-tracking/visualizer/v1", () => screen.findByText("No live athletes yet.")],
];

describe("route smoke test", () => {
  let consoleError: MockInstance;
  let consoleWarn: MockInstance;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error");
    consoleWarn = vi.spyOn(console, "warn");
  });
  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it.each(ROUTES)("%s renders its page", async (route, marker, pathname = `/livetracking${route}`) => {
    const { router } = renderApp({ route });

    expect(await marker()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(pathname);
    // Rendering errors (route error boundary) and React warnings go to console.error, MUI usage
    // warnings (e.g. a deprecated or misused prop) to console.error or console.warn.
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument();
    expect(consoleError.mock.calls.map((c) => String(c[0]).slice(0, 300))).toEqual([]);
    expect(consoleWarn.mock.calls.map((c) => String(c[0]).slice(0, 300))).toEqual([]);
  });
});
