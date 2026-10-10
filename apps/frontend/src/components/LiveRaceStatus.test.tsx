// LiveRaceStatus: the live sync toggle on the scoring page.

import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildRace, startField } from "@raceoffice/race-status-mock";
import { feedStep } from "@raceoffice/test-utils";

import { theme } from "../theme";
import { eventDocs, race } from "../test/fixtures";
import { renderApp } from "../test/renderApp";

const bibs = [11, 12, 13];
const syncToggle = () => screen.getByRole("button", { name: "Activate Sync" });
const errorColor = theme.palette.error.main;

function renderScoring() {
  return renderApp({ route: "/races/r1/scoring", docs: eventDocs({ races: [race({ starterBibs: bibs })] }) });
}

describe("live sync toggle", () => {
  it("is outlined red while the race is running (GREEN) without sync, until sync is activated", async () => {
    const { feed, user } = renderScoring();

    await feedStep(feed, buildRace({ flag: "PURPLE", competitors: startField(bibs) }));
    await waitFor(() => expect(syncToggle()).toBeEnabled());
    expect(syncToggle()).not.toHaveStyle({ borderColor: errorColor });

    await feedStep(feed, buildRace({ flag: "GREEN", lapsComplete: 1, competitors: startField(bibs, { laps: 1 }) }));
    await waitFor(() => expect(syncToggle()).toHaveStyle({ borderColor: errorColor }));

    await user.click(syncToggle());
    await waitFor(() => expect(syncToggle()).toHaveAttribute("aria-pressed", "true"));
    expect(syncToggle()).not.toHaveStyle({ borderColor: errorColor });
  });

  it("stays on at FINISH and can still be switched off by hand", async () => {
    const { feed, user } = renderScoring();

    await feedStep(feed, buildRace({ flag: "GREEN", competitors: startField(bibs) }));
    await user.click(await screen.findByRole("button", { name: "Activate Sync" }));
    await waitFor(() => expect(syncToggle()).toHaveAttribute("aria-pressed", "true"));

    await feedStep(feed, buildRace({ flag: "FINISH", lapsComplete: 30, competitors: startField(bibs, { laps: 30 }) }));
    expect(await screen.findByText("FINISH")).toBeInTheDocument();
    expect(syncToggle()).toHaveAttribute("aria-pressed", "true");

    await user.click(syncToggle());
    await waitFor(() => expect(syncToggle()).toHaveAttribute("aria-pressed", "false"));
    expect(syncToggle()).toBeDisabled();
  });

  it("goes off when the timing system moves on to another race", async () => {
    const { feed, user } = renderScoring();

    await feedStep(feed, buildRace({ raceID: 91, flag: "GREEN", competitors: startField(bibs) }));
    await user.click(await screen.findByRole("button", { name: "Activate Sync" }));
    await waitFor(() => expect(syncToggle()).toHaveAttribute("aria-pressed", "true"));

    await feedStep(feed, buildRace({ raceID: 92, raceName: "Next Race", flag: "PURPLE", competitors: startField(bibs) }));
    expect(await screen.findByText("Next Race")).toBeInTheDocument();
    await waitFor(() => expect(syncToggle()).toHaveAttribute("aria-pressed", "false"));
  });
});
