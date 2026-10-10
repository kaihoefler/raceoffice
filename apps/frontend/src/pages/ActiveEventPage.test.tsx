// ActiveEventPage: the race list of the active event (MUI Select filters, race editor, actions).

import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FullEvent } from "@raceoffice/domain";

import { eventDocs, race, TEST_EVENT_ID } from "../test/fixtures";
import { renderApp } from "../test/renderApp";

const races = [
  race({ id: "elim", name: "Cadet Men 6000 Elim-Final B", stage: "final", stage_value: "B", starterBibs: [11, 12] }),
  race({
    id: "points",
    name: "Cadet Men 6000 Points-Final A",
    racemode: { isPointsRace: true, isEliminationRace: false },
    stage: "final",
    stage_value: "A",
  }),
  race({ id: "heat", name: "Cadet Men 500 Heat 1", racemode: { isPointsRace: false, isEliminationRace: false }, stage: "heat", stage_value: "1" }),
];

function renderPage() {
  const view = renderApp({ route: "/", docs: eventDocs({ races }) });
  const storedEvent = () => view.server.doc(`Event-${TEST_EVENT_ID}`).data as FullEvent;
  return { ...view, storedEvent };
}

/** Race names in table order. */
const raceRows = () =>
  within(screen.getAllByRole("rowgroup")[1]!)
    .getAllByRole("row")
    .map((row) => within(row).getAllByRole("cell")[0]!.textContent);

async function choose(user: UserEvent, select: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: select }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

describe("ActiveEventPage", () => {
  it("lists the races sorted by mode and stage, and filters them with the selects", async () => {
    const { user } = renderPage();
    await screen.findByText("Cadet Men 6000 Elim-Final B");

    // Standard < Points < Elimination
    expect(raceRows()).toEqual(["Cadet Men 500 Heat 1", "Cadet Men 6000 Points-Final A", "Cadet Men 6000 Elim-Final B"]);
    expect(screen.getByText("3 race(s)")).toBeInTheDocument();

    await choose(user, "Race Mode", "Points");
    expect(raceRows()).toEqual(["Cadet Men 6000 Points-Final A"]);
    expect(screen.getByRole("combobox", { name: "Race Mode" })).toHaveTextContent("Points");

    await choose(user, "Stage", "heat");
    expect(screen.getByText("No races match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("0 race(s)")).toBeInTheDocument();

    await choose(user, "Race Mode", "All");
    expect(raceRows()).toEqual(["Cadet Men 500 Heat 1"]);
  });

  it("creates the next race from an existing one via the race editor", async () => {
    const { user, storedEvent } = renderPage();
    await screen.findByText("Cadet Men 6000 Elim-Final B");

    const row = screen.getByRole("row", { name: /Cadet Men 6000 Elim-Final B/ });
    await user.click(within(row).getByRole("button", { name: "Next race" }));

    // Template: same race with stage value B -> C; the name is generated from the fields.
    const editor = within(screen.getByRole("region", { name: "New Race" }));
    expect(editor.getByRole("combobox", { name: "Stage" })).toHaveTextContent("final");
    expect(editor.getByRole("textbox", { name: "Stage value" })).toHaveValue("C");
    expect(editor.getByRole("checkbox", { name: "Elimination" })).toBeChecked();
    expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("Cadet (men) Men 6000 Elimination Final C");

    await user.click(editor.getByRole("checkbox", { name: "Points" }));
    expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("Cadet (men) Men 6000 Points Elimination Final C");

    await user.click(editor.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(storedEvent().races).toHaveLength(4));
    const created = storedEvent().races.find((r) => r.name === "Cadet (men) Men 6000 Points Elimination Final C")!;
    expect(created).toMatchObject({
      stage: "final",
      stage_value: "C",
      distance_value: "6000",
      racemode: { isPointsRace: true, isEliminationRace: true },
      raceResults: [],
      raceActivities: [],
    });
    expect(created.id).not.toBe("elim");
    expect(screen.queryByRole("region", { name: "New Race" })).not.toBeInTheDocument();
  });

  it("edits a race and keeps a manually given name", async () => {
    const { user, storedEvent } = renderPage();
    await screen.findByText("Cadet Men 500 Heat 1");

    const row = screen.getByRole("row", { name: /Cadet Men 500 Heat 1/ });
    await user.click(within(row).getByRole("button", { name: "Edit race" }));
    const editor = within(screen.getByRole("region", { name: "Edit Race" }));

    await user.click(editor.getByRole("combobox", { name: "Stage" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "qualifying" }));
    // The name differs from the generated one, so it is kept; the editor offers a refresh.
    expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("Cadet Men 500 Heat 1");
    expect(editor.getByRole("button", { name: "Refresh name" })).toBeInTheDocument();

    await user.click(editor.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(storedEvent().races.find((r) => r.id === "heat")?.stage).toBe("qualifying"));
    expect(storedEvent().races.find((r) => r.id === "heat")?.name).toBe("Cadet Men 500 Heat 1");
    expect(storedEvent().races.find((r) => r.id === "heat")?.raceStarters).toEqual(races[2]!.raceStarters);
  });

  it("keeps the editor input when another client changes the event meanwhile", async () => {
    const { user, server } = renderPage();
    await screen.findByText("Cadet Men 500 Heat 1");

    await user.click(within(screen.getByRole("row", { name: /Cadet Men 500 Heat 1/ })).getByRole("button", { name: "Edit race" }));
    const editor = within(screen.getByRole("region", { name: "Edit Race" }));
    await user.clear(editor.getByRole("textbox", { name: "Distance" }));
    await user.type(editor.getByRole("textbox", { name: "Distance" }), "1000");

    server.update(`Event-${TEST_EVENT_ID}`, (event: FullEvent) => ({ ...event, races: [...event.races, race({ id: "other", name: "Race added elsewhere" })] }));
    expect(await screen.findByText("Race added elsewhere")).toBeInTheDocument();

    expect(editor.getByRole("textbox", { name: "Distance" })).toHaveValue("1000");
    expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("Cadet Men 500 Heat 1");
  });

  it("activates and deactivates a race", async () => {
    const { user, storedEvent } = renderPage();
    await screen.findByText("Cadet Men 6000 Elim-Final B");
    const row = () => screen.getByRole("row", { name: /Cadet Men 6000 Elim-Final B/ });

    await user.click(within(row()).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(storedEvent().activeRaceId).toBe("elim"));
    expect(await within(row()).findByRole("button", { name: "Deactivate" })).toBeInTheDocument();

    await user.click(within(row()).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(storedEvent().activeRaceId).toBeNull());
  });

  it("deletes a race only after confirmation", async () => {
    const { user, storedEvent } = renderPage();
    await screen.findByText("Cadet Men 500 Heat 1");
    const confirm = vi.spyOn(window, "confirm");
    const row = () => screen.getByRole("row", { name: /Cadet Men 500 Heat 1/ });

    confirm.mockReturnValueOnce(false);
    await user.click(within(row()).getByRole("button", { name: "Delete race" }));
    expect(confirm).toHaveBeenCalledWith('Delete race "Cadet Men 500 Heat 1"?');
    expect(storedEvent().races).toHaveLength(3);

    confirm.mockReturnValueOnce(true);
    await user.click(within(row()).getByRole("button", { name: "Delete race" }));
    await waitFor(() => expect(storedEvent().races.map((r) => r.id)).toEqual(["elim", "points"]));
    expect(screen.queryByText("Cadet Men 500 Heat 1")).not.toBeInTheDocument();

    confirm.mockRestore();
  });
});
