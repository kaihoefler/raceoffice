// Timing area and measurement page: hardware status and explicit connecting, deleting passings
// with confirmation, decoder register, decoder assignment in setups, measurement commands.

import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createLiveTrackingRuntimeDocument,
  createLiveTrackingSessionDocument,
  createLiveTrackingSetupDocument,
  createTimingConnectionDocument,
  createTimingDecoderStatus,
  createTimingDecodersDocument,
  createTimingStatusDocument,
  makeLiveTrackingListDocId,
  makeLiveTrackingRuntimeDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  TIMING_CONNECTION_DOC_ID,
  TIMING_DECODERS_DOC_ID,
  TIMING_SIMULATOR_DOC_ID,
  TIMING_STATUS_DOC_ID,
  type LiveTrackingSessionDocument,
  type LiveTrackingSetupDocument,
  type TimingDecoder,
} from "@raceoffice/domain";

import { renderApp } from "../../test/renderApp";

const P3: TimingDecoder = {
  id: "p3@10.0.0.7:5403",
  name: "Ziel",
  backend: "p3",
  ip: "10.0.0.7",
  port: 5403,
  clockOffsetSecs: 0,
  hardwareId: null,
  updatedAt: null,
};
const SIM: TimingDecoder = { ...P3, id: "ammc@127.0.0.1", name: "Sim Gegengerade", backend: "ammc", ip: "127.0.0.1", port: 5403 };

const register = (...decoders: TimingDecoder[]) => ({ ...createTimingDecodersDocument(), decoders });

function setup(): LiveTrackingSetupDocument {
  const doc = createLiveTrackingSetupDocument({ setupId: "s1", eventId: null, name: "Arena" });
  return {
    ...doc,
    decoderBackend: "p3parser",
    track: {
      id: "t1",
      name: "Oval",
      lengthM: 200,
      timingPoints: [
        // Old setup: only the address – resolves to the register id "p3@10.0.0.7:5403".
        { id: "tp1", name: "Ziel", decoderIp: "10.0.0.7", websocketPortAMM: 0, order: 1, distanceFromPreviousM: 0, absolutePositionM: 0, role: "start_finish", enabled: true },
      ],
    },
  };
}

function fetchStub(calls: Array<{ url: string; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.startsWith("/timing/passings/stats")) {
      return Response.json({
        total: 3,
        lastSeq: 3,
        decoders: [
          { decoderId: P3.id, count: 2, lastReceivedAt: null },
          { decoderId: SIM.id, count: 1, lastReceivedAt: null },
        ],
      });
    }
    if (url.startsWith("/timing/passings/delete")) return Response.json({ ok: true, deleted: 2 });
    if (url.startsWith("/timing/passings")) {
      // ?latest=N[&decoderIds=…]: newest first.
      const all = [
        { seq: 3, id: "c", decoderId: SIM.id, decoderTime: "2026-10-31T10:00:02.000Z", transponderId: "9999", passingNumber: 1, signalStrength: 300, signalKind: null },
        { seq: 2, id: "b", decoderId: P3.id, decoderTime: "2026-10-31T10:00:01.000Z", transponderId: "5678", passingNumber: 8, signalStrength: 99, signalKind: null },
        { seq: 1, id: "a", decoderId: P3.id, decoderTime: "2026-10-31T10:00:00.000Z", transponderId: "1234", passingNumber: 7, signalStrength: 120, signalKind: null },
      ];
      const ids = new URL(url, "http://x").searchParams.get("decoderIds");
      return Response.json({ passings: ids ? all.filter((p) => p.decoderId === ids) : all, hasMore: false, lastSeq: 3 });
    }
    return Response.json({ ok: true, message: "ok" });
  }) as unknown as typeof fetch;
}

describe("timing control center", () => {
  it("shows the hardware status and connects/disconnects decoders explicitly", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const now = new Date().toISOString();
    const { server, user } = renderApp({
      route: "/timing/control",
      fetch: fetchStub(calls),
      docs: {
        [TIMING_DECODERS_DOC_ID]: register(P3, SIM),
        [TIMING_CONNECTION_DOC_ID]: { ...createTimingConnectionDocument(), connectedDecoderIds: [P3.id] },
        [TIMING_STATUS_DOC_ID]: {
          ...createTimingStatusDocument(),
          workerHeartbeatAt: now,
          decoders: [
            {
              ...createTimingDecoderStatus(P3.id),
              connection: "connected",
              connectedSince: now,
              lastMessageAt: now,
              passingCount: 2,
              hardware: { hardwareId: "40-24-04-00", decoderType: "X2", firmwareVersion: "4.5" },
              device: { noise: 12, gpsLocked: false, temperatureC: 41, voltage: 12.4, at: now },
              sequence: { requested: 3, recovered: 2, open: 1 },
            },
          ],
        },
      },
    });

    const table = await screen.findByRole("table", { name: "Hardware-Status" });
    const [ziel, sim] = within(table).getAllByRole("row").slice(1);
    expect(ziel).toHaveTextContent("verbunden");
    expect(ziel).toHaveTextContent("ID 40-24-04-00 · FW 4.5");
    expect(ziel).toHaveTextContent("GPS ✗");
    expect(ziel).toHaveTextContent("3 / 2 / 1");
    expect(sim).toHaveTextContent("getrennt");

    await user.click(within(sim!).getByRole("switch", { name: "Sim Gegengerade verbinden" }));
    await waitFor(() => expect(server.doc(TIMING_CONNECTION_DOC_ID).data.connectedDecoderIds).toEqual([P3.id, SIM.id]));
    await user.click(screen.getByRole("button", { name: "Alle trennen" }));
    await waitFor(() => expect(server.doc(TIMING_CONNECTION_DOC_ID).data.connectedDecoderIds).toEqual([]));
  });

  it("never shows a decoder as connected when the worker no longer reports", async () => {
    const stale = new Date(Date.now() - 60_000).toISOString();
    renderApp({
      route: "/timing/control",
      fetch: fetchStub([]),
      docs: {
        [TIMING_DECODERS_DOC_ID]: register(P3),
        [TIMING_CONNECTION_DOC_ID]: { ...createTimingConnectionDocument(), connectedDecoderIds: [P3.id] },
        [TIMING_STATUS_DOC_ID]: {
          ...createTimingStatusDocument(),
          workerHeartbeatAt: stale,
          decoders: [{ ...createTimingDecoderStatus(P3.id), connection: "connected", connectedSince: stale, lastMessageAt: stale }],
        },
      },
    });
    const table = await screen.findByRole("table", { name: "Hardware-Status" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("getrennt");
    expect(within(table).getAllByRole("row")[1]).not.toHaveTextContent("verbunden");
  });

  it("lists the newest passings and deletes only after confirmation", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const { user } = renderApp({ route: "/timing/control", fetch: fetchStub(calls), docs: { [TIMING_DECODERS_DOC_ID]: register(P3) } });
    const log = await screen.findByRole("table", { name: "Neueste Passings" });
    expect(within(log).getAllByRole("row")[1]).toHaveTextContent("9999");

    await user.click(screen.getByRole("button", { name: "Passings löschen …" }));
    expect(calls.some((c) => c.url.startsWith("/timing/passings/delete"))).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(calls.find((c) => c.url.startsWith("/timing/passings/delete"))?.body).toEqual({ confirm: true, filter: { all: true } }));
    expect(await screen.findByText("2 Passings gelöscht.")).toBeInTheDocument();
  });

  it("filters the passings by decoder and deletes only the filtered decoder", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const { user } = renderApp({ route: "/timing/control", fetch: fetchStub(calls), docs: { [TIMING_DECODERS_DOC_ID]: register(P3, SIM) } });
    await screen.findByRole("table", { name: "Neueste Passings" });
    // Clicking the count chip of a decoder filters the list.
    await user.click(screen.getByRole("button", { name: "Ziel: 2" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Neueste Passings" })).getAllByRole("row")).toHaveLength(3));
    expect(screen.getByRole("table", { name: "Neueste Passings" })).not.toHaveTextContent("9999");
    expect(screen.getByText("2 von 3 gespeichert")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("decoderIds=" + encodeURIComponent(P3.id)))).toBe(true);

    await user.click(screen.getByRole("button", { name: "Passings löschen …" }));
    await user.click(await screen.findByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(calls.find((c) => c.url.startsWith("/timing/passings/delete"))?.body).toEqual({ confirm: true, filter: { decoderIds: [P3.id] } }));
  });
});

describe("stopping the worker", () => {
  const runtime = () => ({ ...createLiveTrackingRuntimeDocument(), workerStatus: "running", workerHeartbeatAt: new Date().toISOString(), workerProcessId: 42, workerHost: "test" });
  const simulator = (running: boolean) => ({ kind: "timingSimulator", version: 1, running, config: { decoderId: "0A87E5", transponderIds: ["1"], passingDelay: "1000-2000", startupDelaySecs: 0, announceIp: null }, updatedAt: null });

  it("asks about measurement, simulator and decoders, stops the measurement first, then the worker", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const { server, user } = renderApp({
      route: "/timing/control",
      fetch: fetchStub(calls),
      docs: {
        [makeLiveTrackingRuntimeDocId()]: runtime(),
        [makeLiveTrackingSessionDocId()]: { ...createLiveTrackingSessionDocument({ setupId: "s1", eventId: "" }), state: "running" },
        [TIMING_SIMULATOR_DOC_ID]: simulator(true),
        [TIMING_CONNECTION_DOC_ID]: { ...createTimingConnectionDocument(), connectedDecoderIds: [P3.id] },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Worker stoppen" }));
    const dialog = await screen.findByRole("dialog", { name: "Worker stoppen" });
    expect(within(dialog).getByRole("checkbox", { name: "Laufende Messung stoppen" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Decoder-Simulation beenden" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Verbindung zum Decoder trennen" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Worker stoppen" }));

    await waitFor(() => expect(server.doc(TIMING_SIMULATOR_DOC_ID).data.running).toBe(false));
    // Otherwise the decoder would reconnect as soon as the worker starts again.
    await waitFor(() => expect(server.doc(TIMING_CONNECTION_DOC_ID).data.connectedDecoderIds).toEqual([]));
    await waitFor(() => expect(server.doc(makeLiveTrackingSessionDocId()).data.commandQueue.map((c: { intent: string }) => c.intent)).toEqual(["stop"]));
    // The worker is stopped only after the measurement reports idle.
    expect(calls.some((c) => c.url === "/live-tracking/worker/stop")).toBe(false);
    server.update(makeLiveTrackingSessionDocId(), (d) => ({ ...d, state: "idle" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/live-tracking/worker/stop")).toBe(true));
  });

  it("keeps the simulator when unchecked and stops without asking when nothing runs", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const { server, user } = renderApp({
      route: "/timing/control",
      fetch: fetchStub(calls),
      docs: { [makeLiveTrackingRuntimeDocId()]: runtime(), [TIMING_SIMULATOR_DOC_ID]: simulator(true) },
    });
    await user.click(await screen.findByRole("button", { name: "Worker stoppen" }));
    const dialog = await screen.findByRole("dialog", { name: "Worker stoppen" });
    expect(within(dialog).queryByRole("checkbox", { name: "Laufende Messung stoppen" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "Decoder-Simulation beenden" }));
    await user.click(within(dialog).getByRole("button", { name: "Worker stoppen" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/live-tracking/worker/stop")).toBe(true));
    expect(server.doc(TIMING_SIMULATOR_DOC_ID).data.running).toBe(true);

    server.update(TIMING_SIMULATOR_DOC_ID, (d) => ({ ...d, running: false }));
    // Wait until the page knows the simulator is off (the app bar label disappears).
    await waitFor(() => expect(screen.queryByRole("link", { name: /Decoder Simulation/ })).not.toBeInTheDocument());
    // The first dialog must be gone (closing transition), so the click hits the card button.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Worker stoppen" })).not.toBeInTheDocument());
    calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Worker stoppen" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/live-tracking/worker/stop")).toBe(true), { timeout: 3000 });
    expect(screen.queryByRole("dialog", { name: "Worker stoppen" })).not.toBeInTheDocument();
  });
});

describe("active setup in the control center", () => {
  it("activates a setup for the measurement and connects exactly its decoders", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const { server, user } = renderApp({
      route: "/timing/control",
      fetch: fetchStub(calls),
      docs: {
        [makeLiveTrackingSessionDocId()]: createLiveTrackingSessionDocument({ setupId: "", eventId: "" }),
        [makeLiveTrackingListDocId()]: { kind: "liveTrackingList", version: 1, setups: [{ setupId: "s1", name: "Arena", updatedAt: null }], participantPools: [] },
        [makeLiveTrackingSetupDocId("s1")]: setup(),
        [TIMING_DECODERS_DOC_ID]: register(P3, SIM),
        [TIMING_CONNECTION_DOC_ID]: { ...createTimingConnectionDocument(), connectedDecoderIds: [SIM.id] },
      },
    });
    expect(await screen.findByText("Noch kein Setup aktiviert.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("combobox", { name: "Setup" })[0]!);
    await user.click(await screen.findByRole("option", { name: "Arena" }));
    await waitFor(() => expect(server.doc(TIMING_CONNECTION_DOC_ID).data.activeSetupId).toBe("s1"));
    await waitFor(() => expect(server.doc(makeLiveTrackingSessionDocId()).data.setupId).toBe("s1"));

    expect(await screen.findByText("Ziel: getrennt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nur diese verbinden" }));
    await waitFor(() => expect(server.doc(TIMING_CONNECTION_DOC_ID).data.connectedDecoderIds).toEqual([P3.id]));
  });
});

describe("decoder register", () => {
  it("adds a P3 decoder with an address id", async () => {
    const { server, user } = renderApp({ route: "/timing/decoders" });
    await user.click(await screen.findByRole("button", { name: "Decoder anlegen" }));
    const dialog = await screen.findByRole("dialog", { name: "Decoder anlegen" });
    expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Name"), "Ziel");
    await user.type(within(dialog).getByLabelText("IP-Adresse"), "10.0.0.7");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(server.doc(TIMING_DECODERS_DOC_ID).data.decoders).toEqual([expect.objectContaining({ id: "p3@10.0.0.7:5403", name: "Ziel", port: 5403 })]),
    );
  });
});

describe("simulator label in the app bar", () => {
  it("shows while the simulator runs and leads to the simulation tab", async () => {
    const { user, router } = renderApp({
      route: "/live-tracking/measurement",
      docs: {
        [TIMING_SIMULATOR_DOC_ID]: { kind: "timingSimulator", version: 1, running: true, config: { decoderId: "0A87E5", transponderIds: ["1"], passingDelay: "1000-2000", startupDelaySecs: 0, announceIp: null }, updatedAt: null },
        [TIMING_STATUS_DOC_ID]: { ...createTimingStatusDocument(), simulator: { state: "running", startedAt: null, lastError: null, lastLine: null } },
      },
    });
    await user.click(await screen.findByRole("link", { name: "Decoder Simulation aktiv" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/livetracking/timing/decoders"));
    expect(router.state.location.search).toBe("?tab=simulation");
    expect(await screen.findByRole("tab", { name: "Simulation", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("Decoder-Simulation")).toBeInTheDocument();
  });

  it("worker and measurement labels lead to the Control Center and the measurement page", async () => {
    const { user, router } = renderApp({ route: "/timing/decoders" });
    await user.click(await screen.findByRole("link", { name: "Messung: bereit" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/livetracking/live-tracking/measurement"));
    await user.click(screen.getByRole("link", { name: "Worker: aus" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/livetracking/timing/control"));
  });

  it("is hidden while the simulator is off", async () => {
    renderApp({ route: "/live-tracking/measurement" });
    await screen.findByText("noch nicht gestartet");
    expect(screen.queryByText(/Simulation aktiv/)).not.toBeInTheDocument();
  });
});

describe("decoder simulation tab", () => {
  it("starts the simulator with the entered settings and creates a decoder for it", async () => {
    const { server, user } = renderApp({ route: "/timing/decoders" });
    await user.click(await screen.findByRole("tab", { name: "Simulation" }));
    const start = await screen.findByRole("button", { name: "Simulator starten" });
    expect(start).toBeDisabled(); // no transponders yet
    await user.type(screen.getByLabelText("Transponder (kommagetrennt)"), "1001, 1002");
    await user.clear(screen.getByLabelText("Rundenlänge (m)"));
    await user.type(screen.getByLabelText("Rundenlänge (m)"), "250");
    await user.click(screen.getByRole("button", { name: "berechnen" }));
    expect(screen.getByLabelText("Abstand der Passings (ms, von-bis)")).toHaveValue("30000-31000");
    await user.click(screen.getByRole("button", { name: "Simulator starten" }));
    await waitFor(() =>
      expect(server.doc(TIMING_SIMULATOR_DOC_ID).data).toMatchObject({ running: true, config: { transponderIds: ["1001", "1002"], passingDelay: "30000-31000" } }),
    );
    await user.click(screen.getByRole("button", { name: "P3-Decoder anlegen" }));
    await waitFor(() =>
      expect(server.doc(TIMING_DECODERS_DOC_ID).data.decoders).toEqual([expect.objectContaining({ id: "p3@127.0.0.1:5403", backend: "p3", ip: "127.0.0.1" })]),
    );
  });
});

describe("setups", () => {
  it("assigns decoders from the register to timing points", async () => {
    const { server, user } = renderApp({
      route: "/timing/setups",
      docs: {
        [makeLiveTrackingSessionDocId()]: createLiveTrackingSessionDocument({ setupId: "s1", eventId: "" }),
        [makeLiveTrackingListDocId()]: { kind: "liveTrackingList", version: 1, setups: [{ setupId: "s1", name: "Arena", updatedAt: null }], participantPools: [] },
        [makeLiveTrackingSetupDocId("s1")]: setup(),
        [TIMING_DECODERS_DOC_ID]: register(P3, SIM),
      },
    });
    const select = await screen.findByRole("combobox", { name: "Decoder Timing-Point 1" });
    expect(select).toHaveTextContent("Ziel (P3)"); // old address resolved to the register entry
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Sim Gegengerade (AMMC)" }));
    await user.click(screen.getByRole("button", { name: "Setup speichern" }));
    await waitFor(() => expect(server.doc(makeLiveTrackingSetupDocId("s1")).data.track.timingPoints[0].timingDecoderId).toBe(SIM.id));
  });
});

describe("measurement", () => {
  function renderMeasurement(session: Partial<LiveTrackingSessionDocument> = {}) {
    return renderApp({
      route: "/live-tracking/measurement",
      docs: {
        [makeLiveTrackingSessionDocId()]: { ...createLiveTrackingSessionDocument({ setupId: "s1", eventId: "" }), ...session },
        [makeLiveTrackingListDocId()]: { kind: "liveTrackingList", version: 1, setups: [{ setupId: "s1", name: "Arena", updatedAt: null }], participantPools: [] },
        [makeLiveTrackingSetupDocId("s1")]: setup(),
        [TIMING_DECODERS_DOC_ID]: register(P3),
      },
    });
  }

  it("offers to connect the setup decoders and starts the measurement", async () => {
    const { server, user } = renderMeasurement();
    expect(await screen.findByText("Ziel: getrennt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Decoder des Setups verbinden" }));
    await waitFor(() => expect(server.doc(TIMING_CONNECTION_DOC_ID).data.connectedDecoderIds).toEqual([P3.id]));

    await user.click(screen.getByRole("button", { name: "Messung starten" }));
    await waitFor(() => expect(server.doc(makeLiveTrackingSessionDocId()).data.commandQueue.map((c: { intent: string }) => c.intent)).toEqual(["start"]));
  });

  it("stops a running measurement and resets only after confirmation", async () => {
    const { server, user } = renderMeasurement({
      state: "running",
      measurement: { segments: [{ fromSeq: 10, toSeq: null, startedAt: new Date().toISOString(), stoppedAt: null }] },
    });
    expect(await screen.findByRole("button", { name: "Messung stoppen" })).toBeEnabled();
    // The setup is shown only; it is chosen in the Control Center.
    expect(screen.getByRole("textbox", { name: "Setup" })).toHaveValue("Arena");
    expect(screen.getByRole("textbox", { name: "Setup" })).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: "Messung zurücksetzen …" }));
    await user.click(await screen.findByRole("button", { name: "Zurücksetzen" }));
    await waitFor(() => expect(server.doc(makeLiveTrackingSessionDocId()).data.commandQueue.map((c: { intent: string }) => c.intent)).toEqual(["reset"]));
  });
});
