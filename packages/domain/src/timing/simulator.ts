/**
 * timing/simulator
 * ----------------
 * Decoder simulator of the timing layer (doc/timing-architecture.md, 2.1).
 *
 * `ammc-sim` simulates a MyLaps decoder: it listens on the fixed MyLaps port 5403, so at most
 * one simulator can run per machine. It replaces hardware, it is no decoder type: a normal P3 or
 * AMMC decoder in the register with address 127.0.0.1 connects to it like to a real device.
 *
 * The timing worker runs it; operators start/stop and configure it on the decoder page.
 */

export type TimingSimulatorConfig = {
  /** Decoder id the simulator reports (exactly 6 hex characters, e.g. "0A87E5"). */
  decoderId: string;
  /** Transponder codes of the simulated passings. */
  transponderIds: string[];
  /** Gap between passings in ms as range "from-to" (a single value means value…value+1000). */
  passingDelay: string;
  /** Delay before the first passing in seconds. */
  startupDelaySecs: number;
  /** IP to answer the network search with (`--my_ip`); null = not discoverable. */
  announceIp: string | null;
};

export type TimingSimulatorDocument = {
  kind: "timingSimulator";
  version: 1;
  /** Operator wish: the simulator should run. */
  running: boolean;
  config: TimingSimulatorConfig;
  updatedAt: string | null;
};

export type TimingSimulatorStatus = {
  state: "stopped" | "starting" | "running" | "error";
  startedAt: string | null;
  lastError: string | null;
  /** Last output line of the simulator (diagnostics). */
  lastLine: string | null;
};

/** TCP port a MyLaps decoder (and the simulator) listens on. */
export const SIMULATOR_DECODER_PORT = 5403;

export function createTimingSimulatorDocument(): TimingSimulatorDocument {
  return {
    kind: "timingSimulator",
    version: 1,
    running: false,
    config: { decoderId: "0A87E5", transponderIds: [], passingDelay: "24000-25000", startupDelaySecs: 0, announceIp: null },
    updatedAt: null,
  };
}

export function isTimingSimulatorDocument(value: unknown): value is TimingSimulatorDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  const c = doc.config as Record<string, unknown> | undefined;
  return (
    doc.kind === "timingSimulator" &&
    doc.version === 1 &&
    typeof doc.running === "boolean" &&
    !!c &&
    typeof c.decoderId === "string" &&
    Array.isArray(c.transponderIds) &&
    typeof c.passingDelay === "string" &&
    typeof c.startupDelaySecs === "number" &&
    (c.announceIp === null || typeof c.announceIp === "string")
  );
}

/** Decoder id as `ammc-sim` requires it: exactly 6 hex characters (padded/truncated). */
export function normalizeSimulatorDecoderId(raw: string): string {
  return String(raw ?? "").toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 6).padEnd(6, "0");
}

/** Passing delay as range "from-to" in ms; a single value v becomes "v-(v+1000)". */
export function normalizeSimulatorPassingDelay(raw: string): string {
  const value = String(raw ?? "").trim();
  const range = value.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const from = Number(range[1]);
    return `${from}-${Math.max(from, Number(range[2]))}`;
  }
  const single = Number(value);
  if (Number.isFinite(single) && single >= 0) return `${Math.floor(single)}-${Math.floor(single) + 1000}`;
  return "1000-2000";
}

/**
 * Lap time as passing delay range: track length at the given speed (the old setup editor used
 * 30 km/h), plus one second of spread.
 */
export function simulatorPassingDelayForLap(lengthM: number, speedKmh: number): string {
  const ms = Math.max(250, Math.round((Math.max(0, lengthM) / Math.max(1, speedKmh / 3.6)) * 1000));
  return `${ms}-${ms + 1000}`;
}
