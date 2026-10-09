// Proves the component test infrastructure end to end: real provider tree and routes,
// realtime documents from the fake server, live race status from the mocked timing system.
// Scenario tests (Phase 4) build on exactly these mechanics.

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildRace, startField } from "@raceoffice/race-status-mock";
import { feedStep } from "@raceoffice/test-utils";

import { eventDocs, race } from "./fixtures";
import { renderApp } from "./renderApp";

describe("component test infrastructure", () => {
  it("renders the app shell with realtime documents from the fake server", async () => {
    renderApp({ route: "/", docs: eventDocs() });

    expect(await screen.findByText("Race Result Management")).toBeInTheDocument();
  });

  it("shows the race from the realtime documents and follows the live feed state by state", async () => {
    const bibs = [11, 12, 13];
    const { feed } = renderApp({ route: "/races/r1/scoring", docs: eventDocs({ races: [race({ starterBibs: bibs })] }) });

    expect(await screen.findByText("Scoring • Cadet Men 6000 Elim-Final B")).toBeInTheDocument();

    await feedStep(feed, buildRace({ lapsComplete: 5, lapsToGo: 25, competitors: startField(bibs, { laps: 5 }) }));
    expect(await screen.findByText("Lap 5 (25 Laps to Go)")).toBeInTheDocument();

    await feedStep(feed, buildRace({ lapsComplete: 6, lapsToGo: 24, competitors: startField(bibs, { laps: 6 }) }));
    expect(await screen.findByText("Lap 6 (24 Laps to Go)")).toBeInTheDocument();
  });

  it("pushes server-side document changes into the page", async () => {
    const { server } = renderApp({ route: "/races/r1/scoring", docs: eventDocs() });
    expect(await screen.findByText("Scoring • Cadet Men 6000 Elim-Final B")).toBeInTheDocument();

    server.update("Event-e1", (event) => ({ ...event, races: [{ ...event.races[0], name: "Renamed Race" }] }));

    expect(await screen.findByText("Scoring • Renamed Race")).toBeInTheDocument();
  });
});
