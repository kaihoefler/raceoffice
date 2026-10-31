// Control Center: actions call the service API; status comes from the fake /ws/status.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { defaultStatus, FakeSocket, installFakes, type FetchCall } from "./fakes";

let calls: FetchCall[];

function renderControl() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/control"]}>
      <App />
    </MemoryRouter>,
  );
  return { user };
}

const pushStatus = async (status = defaultStatus()) => {
  await waitFor(() => expect(FakeSocket.find("/ws/status")).toBeDefined());
  for (const s of FakeSocket.all.filter((x) => x.url.endsWith("/ws/status"))) s.emit({ type: "status", status });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = installFakes({
    "GET api/recordings": [{ file: "2026-10-20_elim.txt", size: 2048, modifiedAt: 0, lines: 120, durationMs: 750_000 }],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("control center", () => {
  it("connects to Orbits with validated host/port", async () => {
    const { user } = renderControl();
    await pushStatus();
    const host = await screen.findByRole("textbox", { name: "Host" });
    await waitFor(() => expect(host).toHaveValue("192.168.1.20"));

    const port = screen.getByRole("textbox", { name: "Port" });
    await user.clear(port);
    await user.type(port, "70000");
    expect(screen.getByRole("button", { name: "Verbinden" })).toBeDisabled();
    await user.clear(port);
    await user.type(port, "50001");
    await user.click(screen.getByRole("button", { name: "Verbinden" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("api/client/connect"))).toBe(true));
    const call = calls.find((c) => c.url.endsWith("api/client/connect"))!;
    expect(call).toMatchObject({ method: "POST", body: { host: "192.168.1.20", port: 50001, encoding: "windows-1252" } });
  });

  it("starts a recording and lists recordings with download links", async () => {
    const { user } = renderControl();
    await pushStatus();
    expect(await screen.findByText("2026-10-20_elim.txt", { selector: "span, p" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-10-20_elim.txt herunterladen" })).toHaveAttribute(
      "href",
      "/api/recordings/2026-10-20_elim.txt",
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "elim-u17");
    await user.click(screen.getByRole("button", { name: "Aufnahme starten" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("api/recorder/start"))?.body).toEqual({ name: "elim-u17" }));
  });

  it("starts a replay with the chosen speed and warns about the live connection", async () => {
    const { user } = renderControl();
    await pushStatus(defaultStatus({ source: "rmonitor", client: { ...defaultStatus().client, state: "connected" } }));
    expect(await screen.findByText(/Live-Verbindung zu Orbits wird während des Replays getrennt/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "10×" }));
    await user.click(screen.getByRole("button", { name: "Abspielen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith("api/player/start"))?.body).toEqual({ file: "2026-10-20_elim.txt", speedup: 10, skipGaps: true }),
    );
  });

  it("switches gap skipping of a running replay", async () => {
    const { user } = renderControl();
    await pushStatus(
      defaultStatus({
        source: "player",
        player: { ...defaultStatus().player, state: "playing", file: "2026-10-20_elim.txt", skipGaps: true },
      }),
    );
    const toggle = await screen.findByRole("switch", { name: "Pausen überspringen" });
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("api/player/skip-gaps"))?.body).toEqual({ enabled: false }));
  });

  it("shows REPLAY and asks for the control token when the service demands one", async () => {
    vi.unstubAllGlobals();
    calls = installFakes({ "POST api/state/reset": () => new Response('{"error":"unauthorized"}', { status: 401 }) });
    const { user } = renderControl();
    await pushStatus(defaultStatus({ source: "player", player: { ...defaultStatus().player, state: "playing", file: "x.txt" } }));
    expect(await screen.findByText(/REPLAY aktiv/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rennzustand zurücksetzen" }));
    await user.click(await screen.findByRole("button", { name: "Zurücksetzen" }));
    expect(await screen.findByRole("dialog", { name: "Steuer-Token" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Token"), "secret");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(sessionStorage.getItem("leaderboard.controlToken")).toBe("secret");
  });
});
