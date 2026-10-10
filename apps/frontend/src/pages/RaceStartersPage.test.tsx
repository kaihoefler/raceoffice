// RaceStartersPage: adding and editing starters of a race inline in the table.

import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FullEvent } from "@raceoffice/domain";

import { eventDocs, race, TEST_EVENT_ID } from "../test/fixtures";
import { renderApp } from "../test/renderApp";

function renderPage() {
  const view = renderApp({ route: "/races/r1/starters", docs: eventDocs({ races: [race({ starterBibs: [11] })] }) });
  const starters = () => (view.server.doc(`Event-${TEST_EVENT_ID}`).data as FullEvent).races[0]!.raceStarters;
  return { ...view, starters };
}

describe("RaceStartersPage", () => {
  it("adds a starter from the empty row; the nation is upper-cased and limited to the IOC code", async () => {
    const { user, starters } = renderPage();
    await screen.findByText("Starter Import (CSV)");

    await user.type(screen.getByPlaceholderText("bib"), "21");
    await user.type(screen.getByPlaceholderText("First name"), "Gina");
    await user.type(screen.getByPlaceholderText("Last name"), "Gamma");
    await user.type(screen.getByPlaceholderText("IOC"), "gerx");
    expect(screen.getByPlaceholderText("IOC")).toHaveValue("GER");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(starters().map((a) => a.bib)).toEqual([11, 21]));
    expect(starters().find((a) => a.bib === 21)).toMatchObject({ firstName: "Gina", lastName: "Gamma", nation: "GER" });
  });

  it("edits the nation of an existing starter", async () => {
    const { user, starters } = renderPage();
    // The race has one starter (bib 11), so there is one edit button.
    const editButton = await screen.findByRole("button", { name: "Edit starter" });
    const row = editButton.closest("tr")!;

    await user.click(editButton);
    // While editing, the row has a nation field (the only one limited to 3 characters).
    const nation = within(row).getAllByRole("textbox").find((el) => el.getAttribute("maxlength") === "3")!;
    await user.type(nation, "frax");
    expect(nation).toHaveValue("FRA");
    await user.click(within(row).getByRole("button", { name: "Save starter" }));

    await waitFor(() => expect(starters().find((a) => a.bib === 11)?.nation).toBe("FRA"));
  });
});
