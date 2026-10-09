// src/test/renderApp.tsx
//
// Renders the real app (provider tree + routes) for component tests, at a given route:
// - realtime documents come from an in-memory FakeRealtimeServer (seed them via `docs`)
// - the live race status feed is a mocked timing system (RaceStatusFeed), polled every
//   TEST_POLL_INTERVAL_MS; move the race on with feedStep(feed, nextState)
//
// Example:
//   const { feed, user } = renderApp({ route: "/races/r1/scoring", docs: eventDocs({ race }) });
//   await feedStep(feed, buildRace({ lapsComplete: 5, ... }));
//   expect(await screen.findByText("Lap 5 (25 Laps to Go)")).toBeInTheDocument();

import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RaceStatusFeed } from "@raceoffice/race-status-mock";
import {
  installFakeRealtime,
  installRaceStatusFeed,
  TEST_POLL_INTERVAL_MS,
  TEST_RACE_STATUS_URL,
} from "@raceoffice/test-utils";

import { AppProviders } from "../AppProviders";
import { routes } from "../router";

export type RenderAppOptions = {
  /** Initial URL, e.g. "/races/r1/scoring". Default "/". */
  route?: string;
  /** Realtime documents by id, e.g. eventDocs(...) from ./fixtures. */
  docs?: Record<string, unknown>;
  /** Mocked timing system; starts with "no active race". */
  feed?: RaceStatusFeed;
};

export function renderApp({ route = "/", docs = {}, feed = new RaceStatusFeed() }: RenderAppOptions = {}) {
  const server = installFakeRealtime();
  for (const [docId, data] of Object.entries(docs)) server.seed(docId, data);

  installRaceStatusFeed(feed);

  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const user = userEvent.setup();

  const view = render(
    <AppProviders raceStatus={{ url: TEST_RACE_STATUS_URL, pollIntervalMs: TEST_POLL_INTERVAL_MS }}>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return { ...view, server, feed, router, user };
}
