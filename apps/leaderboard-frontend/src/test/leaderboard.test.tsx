// Leaderboard page with the real app shell; the service is a fake WebSocket.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { serviceBase } from "../api";
import { FakeSocket, installFakes, race } from "./fakes";

function renderAt(route = "/") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
  return { user };
}

const stream = async () => {
  await waitFor(() => expect(FakeSocket.find("/ws/race/current")).toBeDefined());
  return FakeSocket.find("/ws/race/current")!;
};

const rows = () => within(screen.getByRole("table", { name: "Rangliste" })).getAllByRole("row").slice(1);

beforeEach(() => {
  localStorage.clear();
  installFakes();
});
afterEach(() => vi.unstubAllGlobals());

describe("service base", () => {
  it("derives the service path from the page location", () => {
    expect(serviceBase("/leaderboard/ui/")).toBe("/leaderboard/");
    expect(serviceBase("/ui/index.html")).toBe("/");
    expect(serviceBase("/")).toBe("/");
  });
});

describe("leaderboard", () => {
  it("shows the race with header tiles, names without IOC suffix, nation, gap and interval", async () => {
    renderAt();
    const ws = await stream();
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race() });

    expect(await screen.findByRole("heading", { name: "Elimination U17m" })).toBeInTheDocument();
    expect(screen.getByRole("banner", { name: "Flagge GREEN" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rennzeit")).toHaveTextContent("4:12");
    expect(screen.getByLabelText("Noch")).toHaveTextContent("13 Runden");
    expect(screen.getByLabelText("Fahrer:innen")).toHaveTextContent("3");

    const [first, second, third] = rows();
    expect(first).toHaveTextContent("Muster, Max");
    expect(first).toHaveTextContent("GER");
    expect(first).toHaveTextContent("4:11.532");
    expect(second).toHaveTextContent("+0,032");
    expect(third).toHaveTextContent("+1 Lap");
  });

  it("applies patches and marks position changes", async () => {
    renderAt();
    const ws = await stream();
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race() });
    await screen.findByRole("heading", { name: "Elimination U17m" });
    // Rider 23 overtakes rider 17.
    ws.emit({
      type: "patch",
      raceId: 12,
      rev: 2,
      baseRev: 1,
      patch: [
        { op: "replace", path: "/competitors/0/position", value: 2 },
        { op: "replace", path: "/competitors/1/position", value: 1 },
      ],
    });
    await waitFor(() => expect(rows()[0]).toHaveTextContent("Beispiel, Tim"));
    expect(within(rows()[0]!).getByLabelText("verbessert")).toBeInTheDocument();
    expect(within(rows()[1]!).getByLabelText("verloren")).toBeInTheDocument();
  });

  it("hides times during PURPLE and marks photo-finish corrections", async () => {
    renderAt();
    const ws = await stream();
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race({ flagStatus: "PURPLE" }) });
    await screen.findByRole("heading", { name: "Elimination U17m" });
    expect(screen.queryByRole("columnheader", { name: "Abstand" })).not.toBeInTheDocument();
    expect(screen.queryByText("4:11.532")).not.toBeInTheDocument();

    const corrected = race();
    corrected.competitors[0] = { ...corrected.competitors[0]!, timeCorrection: { lap: 7, deltaMs: -48 } };
    ws.emit({ type: "snapshot", raceId: 12, rev: 2, data: corrected });
    await screen.findByRole("columnheader", { name: "Abstand" });
    expect(within(rows()[0]!).getAllByLabelText("Zielfoto-Korrektur").length).toBeGreaterThan(0);
  });

  it("shows 'no active race' for the empty race and a warning when the connection drops", async () => {
    renderAt();
    const ws = await stream();
    ws.emit({ type: "snapshot", raceId: -1, rev: 1, data: race({ raceID: -1, raceName: "", competitors: [] }) });
    expect(await screen.findAllByText("Kein aktives Rennen")).not.toHaveLength(0);
    ws.drop();
    expect(await screen.findByText(/Verbindung zum Leaderboard-Service getrennt/)).toBeInTheDocument();
  });

  it("switches columns with presets and remembers them on the device", async () => {
    const { user } = renderAt();
    const ws = await stream();
    ws.emit({ type: "snapshot", raceId: 12, rev: 1, data: race() });
    await screen.findByRole("heading", { name: "Elimination U17m" });
    expect(screen.getByRole("columnheader", { name: "Intervall" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Spalten wählen" }));
    await user.click(screen.getByRole("button", { name: "Beamer" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Intervall" })).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("leaderboard.columns")!)).toEqual(["pos", "bib", "name", "laps", "gap"]);
  });

  it("kiosk mode hides the app bar", async () => {
    renderAt("/?kiosk=1");
    await stream();
    expect(screen.queryByRole("button", { name: "Control Center" })).not.toBeInTheDocument();
  });
});
