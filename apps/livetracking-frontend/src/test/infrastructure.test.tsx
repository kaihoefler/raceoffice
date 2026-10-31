// Proves the component test infrastructure for the LiveTracking app: real provider tree and
// routes under the /livetracking base, realtime documents from the fake server.

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderApp } from "./renderApp";

describe("component test infrastructure", () => {
  it("redirects the app root to the timing Control Center inside the layout", async () => {
    const { router } = renderApp({ route: "/" });

    expect(await screen.findByText("Zeitmessung")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/livetracking/timing/control");
  });
});
