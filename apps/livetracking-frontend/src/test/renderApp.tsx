// src/test/renderApp.tsx
//
// Renders the real LiveTracking app (provider tree + routes) for component tests, at a route
// relative to the /livetracking base (e.g. "/live-tracking/setup"):
// - realtime documents come from an in-memory FakeRealtimeServer (seed them via `docs`)
// - REST calls (worker control, P3 discovery) go to `fetch`; by default every call fails
//   loudly, so a test states which endpoints it expects

import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { installFakeRealtime } from "@raceoffice/test-utils";

import { AppProviders } from "../AppProviders";
import { ROUTER_BASENAME, routes } from "../router";

export type RenderAppOptions = {
  /** Route below the app base, e.g. "/live-tracking/setup". Default "/" (redirects to setup). */
  route?: string;
  /** Realtime documents by id. Unseeded ids get the server's bootstrap defaults. */
  docs?: Record<string, unknown>;
  /** Handles REST calls of the page. */
  fetch?: typeof fetch;
};

export function renderApp({ route = "/", docs = {}, fetch }: RenderAppOptions = {}) {
  const server = installFakeRealtime();
  for (const [docId, data] of Object.entries(docs)) server.seed(docId, data);

  vi.stubGlobal(
    "fetch",
    fetch ?? ((input: RequestInfo | URL) => Promise.reject(new Error(`Unexpected fetch in test: ${String(input)}`))),
  );

  const router = createMemoryRouter(routes, { basename: ROUTER_BASENAME, initialEntries: [`${ROUTER_BASENAME}${route}`] });
  const user = userEvent.setup();

  const view = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return { ...view, server, router, user };
}
