import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { TimingSimulatorConfig, TimingSimulatorStatus } from "@raceoffice/domain";
import { SimulatorProcess, simulatorArgs } from "./simulatorProcess.js";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

const config = (overrides: Partial<TimingSimulatorConfig> = {}): TimingSimulatorConfig => ({
  decoderId: "Sim Ziel",
  transponderIds: ["1001", " 1002 "],
  passingDelay: "24000",
  startupDelaySecs: 3,
  announceIp: null,
  ...overrides,
});

function setup() {
  const children: FakeChild[] = [];
  const spawned: string[][] = [];
  const statuses: TimingSimulatorStatus[] = [];
  const sim = new SimulatorProcess((s) => statuses.push(s), {
    binary: "ammc-sim",
    spawnImpl: (_bin, args) => {
      spawned.push(args);
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
  });
  return { sim, children, spawned, statuses };
}

describe("decoder simulator", () => {
  it("builds the ammc-sim command line (AMB, 6-hex id, delay range)", () => {
    expect(simulatorArgs(config({ announceIp: "192.168.1.10" }))).toEqual([
      "AMB",
      "--decoder-id",
      "E00000",
      "--passing-delay",
      "24000-25000",
      "--startup_delay_secs",
      "3",
      "--tran_code",
      "1001,1002",
      "--skip_telemetry_upload",
      "--my_ip",
      "192.168.1.10",
    ]);
  });

  it("starts once, restarts on a config change and stops", () => {
    const { sim, children, spawned } = setup();
    sim.apply(true, config());
    sim.apply(true, config());
    expect(spawned).toHaveLength(1);
    children[0]!.stdout.emit("data", Buffer.from("INFO ammc_sim] Listening on: 5403\n"));
    expect(sim.status).toMatchObject({ state: "running", lastLine: "INFO ammc_sim] Listening on: 5403" });

    sim.apply(true, config({ passingDelay: "1000-2000" }));
    expect(children[0]!.killed).toBe(true);
    expect(spawned).toHaveLength(2);

    sim.apply(false, config());
    expect(children[1]!.killed).toBe(true);
    expect(sim.status.state).toBe("stopped");
  });

  it("reports an unexpected exit (port 5403 in use) and refuses to start without transponders", () => {
    const { sim, children, spawned } = setup();
    sim.apply(true, config());
    children[0]!.emit("exit", 1, null);
    expect(sim.status.state).toBe("error");
    expect(sim.status.lastError).toMatch(/Port 5403/);

    sim.apply(false, config());
    sim.apply(true, config({ transponderIds: [] }));
    expect(spawned).toHaveLength(1);
    expect(sim.status).toMatchObject({ state: "error", lastError: "Keine Transponder eingetragen" });
  });
});
