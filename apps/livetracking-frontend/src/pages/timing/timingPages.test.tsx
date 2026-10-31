// Timing area and measurement page: hardware status and explicit connecting, deleting passings
// with confirmation, decoder register, decoder assignment in setups, measurement commands.

import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createLiveTrackingSessionDocument,
  createLiveTrackingSetupDocument,
  createTimingConnectionDocument,
  createTimingDecoderStatus,
  createTimingDecodersDocument,
  createTimingStatusDocument,
  makeLiveTrackingListDocId,
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
const SIM: TimingDecoder = { ...P3, id: "ammc@127.0.0.1:9100", name: "Sim Gegengerade", backend: "ammc", ip: "127.0.0.1", port: 9100 };

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
    if (url.startsWith("/timing/passings/stats")) return Response.json({ total: 2, lastSeq: 2, decoders: [{ decoderId: P3.id, count: 2, lastReceivedAt: null }] });
    if (url.startsWith("/timing/passings/delete")) return Response.json({ ok: true, deleted: 2 });
    if (url.startsWith("/timing/passings")) {
      return Response.json({
        passings: [
          { seq: 1, id: "a", decoderId: P3.id, decoderTime: "2026-10-31T10:00:00.000Z", transponderId: "1234", passingNumber: 7, signalStrength: 120, signalKind: null },
          { seq: 2, id: "b", decoderId: P3.id, decoderTime: "2026-10-31T10:00:01.000Z", transponderId: "5678", passingNumber: 8, signalStrength: 99, signalKind: null },
        ],
        hasMore: false,
        lastSeq: 2,
      });
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

  it("lists the newest passings and deletes only after confirmation", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const { user } = renderApp({ route: "/timing/control", fetch: fetchStub(calls), docs: { [TIMING_DECODERS_DOC_ID]: register(P3) } });
    const log = await screen.findByRole("table", { name: "Neueste Passings" });
    expect(within(log).getAllByRole("row")[1]).toHaveTextContent("5678");

    await user.click(screen.getByRole("button", { name: "Passings löschen …" }));
    expect(calls.some((c) => c.url.startsWith("/timing/passings/delete"))).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(calls.find((c) => c.url.startsWith("/timing/passings/delete"))?.body).toEqual({ confirm: true, filter: { all: true } }));
    expect(await screen.findByText("2 Passings gelöscht.")).toBeInTheDocument();
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
