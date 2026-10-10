// LiveTrackingControlPage: the setup editor (track, timing points, simulation) of the tracking
// setup selected in the session. Covers the inputs with native attributes (min/step, inputMode,
// readOnly) that a MUI upgrade moves between props and slots, and that edits reach the document.

import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createLiveTrackingSessionDocument,
  createLiveTrackingSetupDocument,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  type LiveTrackingSetupDocument,
  type LiveTrackingTimingPoint,
} from "@raceoffice/domain";

import { renderApp } from "../../test/renderApp";

const SETUP_DOC_ID = makeLiveTrackingSetupDocId("s1");

function point(overrides: Partial<LiveTrackingTimingPoint>): LiveTrackingTimingPoint {
  return {
    id: "p1",
    name: "Finish",
    decoderIp: "10.0.0.1",
    websocketPortAMM: 9000,
    decoderType: "amb",
    decoderTimestampOffsetSecs: 0,
    order: 1,
    distanceFromPreviousM: 0,
    absolutePositionM: 0,
    role: "start_finish",
    enabled: true,
    ...overrides,
  };
}

function renderSetupEditor() {
  const setup: LiveTrackingSetupDocument = {
    ...createLiveTrackingSetupDocument({ setupId: "s1", name: "Test track" }),
    track: {
      id: "t1",
      name: "Oval",
      lengthM: 200,
      timingPoints: [
        point({ id: "p1", name: "Finish" }),
        point({ id: "p2", name: "Back straight", decoderType: "sim", order: 2, distanceFromPreviousM: 100, absolutePositionM: 100, role: "split" }),
      ],
    },
  };
  const view = renderApp({
    route: "/live-tracking/setup",
    docs: {
      [makeLiveTrackingSessionDocId()]: createLiveTrackingSessionDocument({ setupId: "s1", eventId: "" }),
      [SETUP_DOC_ID]: setup,
    },
  });
  const storedSetup = () => view.server.doc(SETUP_DOC_ID).data as LiveTrackingSetupDocument;
  return { ...view, storedSetup };
}

describe("LiveTrackingControlPage setup editor", () => {
  it("edits the minimum lap time and a decoder time offset and saves them to the setup document", async () => {
    const { user, storedSetup } = renderSetupEditor();

    const minLap = await screen.findByRole("spinbutton", { name: "Min. Lap Time (s)" });
    expect(minLap).toHaveValue(8);
    expect(minLap).toHaveAttribute("min", "1");
    expect(minLap).toHaveAttribute("step", "1");
    await user.type(minLap, "12", { initialSelectionStart: 0, initialSelectionEnd: 1 });
    expect(minLap).toHaveValue(12);

    const offset = screen.getAllByRole("textbox", { name: "Time Offset (s)" })[0]!;
    expect(offset).toHaveAttribute("inputmode", "decimal");
    expect(offset).toHaveAttribute("placeholder", "z. B. -1,234");
    // Only signed decimals with "." or "," get through; on blur the value is normalized.
    await user.type(offset, "-1,25x", { initialSelectionStart: 0, initialSelectionEnd: 1 });
    expect(offset).toHaveValue("-1,25");
    await user.tab();
    expect(offset).toHaveValue("-1.25");

    await user.click(screen.getByRole("button", { name: "Save Setup Document" }));

    await waitFor(() => expect(storedSetup().minLapTimeSecs).toBe(12));
    expect(storedSetup().track.timingPoints.find((p) => p.id === "p1")?.decoderTimestampOffsetSecs).toBe(-1.25);
  });

  it("renders the debug document JSON only while its accordion is expanded", async () => {
    const { user } = renderSetupEditor();

    const setupToggle = await screen.findByRole("button", { name: "Setup Document" });
    expect(setupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/"name": "Test track"/)).not.toBeInTheDocument();

    await user.click(setupToggle);
    expect(await screen.findByText(/"name": "Test track"/)).toBeInTheDocument();

    await user.click(setupToggle);
    await waitFor(() => expect(screen.queryByText(/"name": "Test track"/)).not.toBeInTheDocument());
  });

  it("shows the derived simulator delays of a simulated timing point read-only", async () => {
    renderSetupEditor();

    const passingDelay = await screen.findByRole("textbox", { name: "Passing Delay (ms)" });
    const startupDelay = screen.getByRole("textbox", { name: "Startup Delay (s)" });
    expect(passingDelay).toHaveAttribute("readonly");
    expect(startupDelay).toHaveAttribute("readonly");
    expect(passingDelay).not.toHaveValue("");
    expect(startupDelay).not.toHaveValue("");
  });
});
