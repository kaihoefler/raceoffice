// Route smoke test: every route of the app renders its page with realtime documents and an
// idle live feed, without React/MUI errors. Cheap first alarm after a dependency upgrade.

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { eventDocs, race } from "./fixtures";
import { renderApp } from "./renderApp";

/** Route and something only that page shows once its data has arrived. */
const ROUTES: Array<[route: string, marker: () => Promise<HTMLElement>]> = [
  ["/", () => screen.findByText("Active Event: Test Event")],
  ["/events", () => screen.findByText("test-event")],
  ["/visualizations", () => screen.findByText("No visualizations yet.")],
  ["/about", () => screen.findByRole("heading", { name: "About" })],
  ["/races/r1/starters", () => screen.findByText("Starter Import (CSV)")],
  ["/races/r1/scoring", () => screen.findByText("Scoring • Cadet Men 6000 Elim-Final B")],
  ["/visualizer", () => screen.findByText("No active visualization selected.")],
  ["/visualizer/v1", () => screen.findByText("No active race")],
];

describe("route smoke test", () => {
  let consoleError: MockInstance;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error");
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it.each(ROUTES)("%s renders its page", async (route, marker) => {
    renderApp({ route, docs: eventDocs({ races: [race({ starterBibs: [11, 12] })] }) });

    expect(await marker()).toBeInTheDocument();
    // Rendering errors (route error boundary) and React/MUI warnings both go to console.error.
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument();
    expect(consoleError.mock.calls.map((c) => String(c[0]).slice(0, 300))).toEqual([]);
  });
});
