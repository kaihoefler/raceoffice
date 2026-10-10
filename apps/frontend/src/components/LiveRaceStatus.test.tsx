// LiveRaceStatus: the live sync toggle on the scoring page.

import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildRace, startField } from "@raceoffice/race-status-mock";
import type { RaceStatusRace } from "@raceoffice/domain";
import { feedStep, TEST_RACE_STATUS_URL } from "@raceoffice/test-utils";

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

  it("warns while the timing system fails, keeps the last state and sync, and recovers", async () => {
    const { feed, user } = renderScoring();

    await feedStep(feed, buildRace({ flag: "GREEN", lapsComplete: 4, lapsToGo: 26, competitors: startField(bibs, { laps: 4 }) }));
    await user.click(await screen.findByRole("button", { name: "Activate Sync" }));
    await waitFor(() => expect(syncToggle()).toHaveAttribute("aria-pressed", "true"));

    feed.setResponse({ kind: "httpError", status: 500 });
    await feed.waitUntilServed();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Live status service not responding");
    expect(alert).toHaveTextContent("HTTP 500");
    expect(screen.getByRole("button", { name: TEST_RACE_STATUS_URL })).toHaveTextContent("no response");
    expect(screen.getByText("Lap 4 (26 Laps to Go)")).toBeInTheDocument();
    expect(syncToggle()).toHaveAttribute("aria-pressed", "true");

    await feedStep(feed, buildRace({ flag: "GREEN", lapsComplete: 5, lapsToGo: 25, competitors: startField(bibs, { laps: 5 }) }));
    expect(await screen.findByText("Lap 5 (25 Laps to Go)")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: TEST_RACE_STATUS_URL })).toHaveTextContent("connected");
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

// The header differs with and without an active race; both carry the connection settings.
describe.each<[string, RaceStatusRace | null]>([
  ["no active race", null],
  ["running race", buildRace({ flag: "GREEN", lapsComplete: 3, competitors: startField(bibs, { laps: 3 }) })],
])("connection settings (%s)", (_, liveState) => {
  it("changes the feed URL and pauses polling via the settings dialog", async () => {
    const { feed, user } = renderScoring();
    await feedStep(feed, liveState);
    expect(await screen.findByText("connected")).toBeInTheDocument();

    // The connection label opens the dialog; its tooltip (and accessible name) is the URL.
    await user.click(screen.getByRole("button", { name: TEST_RACE_STATUS_URL }));
    const dialog = within(await screen.findByRole("dialog", { name: "Race status connection" }));

    const rate = dialog.getByRole("spinbutton", { name: "Refresh rate (ms)" });
    expect(rate).toHaveAttribute("min", "250");
    expect(rate).toHaveAttribute("max", "60000");
    expect(rate).toHaveAttribute("step", "250");

    const nextUrl = `${TEST_RACE_STATUS_URL}&source=backup`;
    const url = dialog.getByRole("textbox", { name: "URL" });
    expect(url).toHaveValue(TEST_RACE_STATUS_URL);
    await user.clear(url);
    await user.type(url, nextUrl);
    await user.click(dialog.getByRole("switch", { name: "Paused" }));
    await user.click(dialog.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: nextUrl })).toHaveTextContent("paused");
    expect(screen.getByRole("button", { name: "Resume live polling" })).toBeInTheDocument();

    // Resumed, the feed is polled again (now under the new URL).
    await user.click(screen.getByRole("button", { name: "Resume live polling" }));
    await feedStep(feed, liveState);
    expect(await screen.findByText("connected")).toBeInTheDocument();
  });
});
