// PointsBibField: the bib input used by all three scoring tabs (MUI Autocomplete, freeSolo).
//
// Guards the Autocomplete contract the scoring pages rely on, which is what a MUI major
// upgrade is most likely to break: list only after typing, filtering by bib, keyboard
// selection, free text resolved via resolveByBib, clearing, the name shown when not focused,
// and the slotProps wiring (aria-label, error state, own focus handlers).

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFilterOptions } from "@mui/material/Autocomplete";
import { describe, expect, it, vi } from "vitest";
import type { Athlete } from "@raceoffice/domain";

import PointsBibField, { type AthleteFilterOptions } from "./PointsBibField";
import { athlete } from "../test/fixtures";

const riders = [
  athlete(11, { lastName: "Alpha", firstName: "Anna" }),
  athlete(12, { lastName: "Beta", firstName: "Bea" }),
  athlete(21, { lastName: "Gamma", firstName: "Gina" }),
];

// Same filter as the scoring components: nothing before the first character.
const baseFilter = createFilterOptions<Athlete>({ stringify: (o) => `${o.bib ?? ""} ${o.lastName} ${o.firstName}`, trim: true });
const filterOptions: AthleteFilterOptions = (options, state) => (state.inputValue.trim() ? baseFilter(options, state) : []);

/** Controlled like in PointsScoring: typing clears the selection, selecting writes the bib back. */
function Harness(props: {
  initial?: Athlete | null;
  invalid?: boolean;
  onSelect?: (a: Athlete | null) => void;
  onEnter?: () => void;
}) {
  const [value, setValue] = useState<Athlete | null>(props.initial ?? null);
  const [input, setInput] = useState(props.initial ? String(props.initial.bib) : "");

  return (
    <>
      <PointsBibField
        ariaLabel="2 P bib"
        value={value}
        inputValue={input}
        options={riders}
        invalid={props.invalid}
        filterOptions={filterOptions}
        formatOption={(a) => `${a.bib} ${a.lastName}`}
        resolveByBib={(text) => riders.find((r) => String(r.bib) === text.trim()) ?? null}
        onInputValueChange={(v, reason) => {
          setInput(v);
          if (reason === "input") setValue(null);
        }}
        onSelect={(next) => {
          props.onSelect?.(next);
          setValue(next);
          setInput(next?.bib != null ? String(next.bib) : "");
        }}
        onEnter={props.onEnter}
      />
      <button type="button">elsewhere</button>
    </>
  );
}

const field = () => screen.getByRole("combobox", { name: "2 P bib" });

describe("PointsBibField", () => {
  it("opens the list only after typing and filters it by bib", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(field());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(field(), "1");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["11 Alpha", "12 Beta", "21 Gamma"]);

    await user.type(field(), "2");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["12 Beta"]);
  });

  it("selects the highlighted option with arrow keys and Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onEnter = vi.fn();
    render(<Harness onSelect={onSelect} onEnter={onEnter} />);

    await user.type(field(), "1");
    // autoHighlight puts the first option under the cursor; one step down is the second.
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenLastCalledWith(riders[1]);
    expect(onEnter).toHaveBeenCalled();
    expect(field()).toHaveValue("12");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("resolves free text without a matching option via resolveByBib", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    await user.type(field(), "99{Enter}");

    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(field()).toHaveValue("");
  });

  it("clears the selection when the text is deleted", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness initial={riders[0]} onSelect={onSelect} />);

    await user.clear(field());

    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(field()).toHaveValue("");
  });

  it("shows the selected rider's name only while the field is not focused", async () => {
    const user = userEvent.setup();
    render(<Harness initial={riders[0]} />);

    expect(screen.getByText("Alpha Anna")).toBeInTheDocument();

    await user.click(field());
    expect(screen.queryByText("Alpha Anna")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.getByText("Alpha Anna")).toBeInTheDocument();
  });

  it("marks an invalid bib as erroneous and keeps the numeric keyboard", () => {
    render(<Harness initial={riders[0]} invalid />);

    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAttribute("inputmode", "numeric");
  });
});
