/**
 * REST compatibility with the Java JsonServer (paths, methods, headers, 404 body, catch-all).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseLine } from "@raceoffice/rmonitor";
import { getJson, startService, type TestService } from "./helpers.js";

describe("REST compatibility", () => {
  let svc: TestService;

  beforeAll(async () => {
    svc = await startService();
    for (const line of [
      '$B,5,"First"',
      '$A,"1","11",T1,"Max","Muster (GER)","GER",1',
      '$G,1,"1",3,"00:01:02.500"',
      '$B,6,"Second"',
      '$F,9,"00:00:00","14:03:22","00:04:12","Green "',
    ]) {
      svc.service.store.apply(parseLine(line));
    }
  });
  afterAll(async () => svc.close());

  it("/races?filter=current returns [current race] with the Java headers", async () => {
    const { status, body, headers } = await getJson<Array<{ raceID: number; flagStatus: string }>>(
      `${svc.baseUrl}/races?filter=current`,
    );
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ raceID: 6, flagStatus: "GREEN", elapsedTime: "4:12", timeOfDay: "14:03:22" });
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("access-control-allow-headers")).toContain("X-Requested-With");
  });

  it("/races returns all races, /race the current one, /race/<id> one race", async () => {
    expect((await getJson<Array<{ raceID: number }>>(`${svc.baseUrl}/races`)).body.map((r) => r.raceID)).toEqual([5, 6]);
    expect((await getJson<{ raceID: number }>(`${svc.baseUrl}/race`)).body.raceID).toBe(6);
    const first = await getJson<{ raceID: number; flagStatus: string; competitors: unknown[] }>(`${svc.baseUrl}/race/5`);
    expect(first.body).toMatchObject({ raceID: 5, flagStatus: "FINISH" });
    expect(first.body.competitors).toHaveLength(1);
  });

  it("unknown race id → 404 with body null; non-numeric id → current race (Java)", async () => {
    const missing = await getJson(`${svc.baseUrl}/race/99`);
    expect(missing.status).toBe(404);
    expect(missing.body).toBeNull();
    expect((await getJson<{ raceID: number }>(`${svc.baseUrl}/race/abc`)).body.raceID).toBe(6);
  });

  it("answers every method and unknown paths like Java, but not the service's own prefixes", async () => {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const res = await getJson<Array<{ raceID: number }>>(`${svc.baseUrl}/races?filter=current`, { method });
      expect(res.status, method).toBe(200);
      expect(res.body[0]?.raceID).toBe(6);
    }
    expect((await getJson<{ raceID: number }>(`${svc.baseUrl}/whatever/path`)).body.raceID).toBe(6);
    expect((await getJson<{ raceID: number }>(`${svc.baseUrl}/`)).body.raceID).toBe(6);
    expect((await getJson(`${svc.baseUrl}/api/nope`)).status).toBe(404);
    expect((await getJson(`${svc.baseUrl}/ws/nope`)).status).toBe(404);
  });

  it("only the exact query 'filter=current' filters (Java compares the raw query string)", async () => {
    expect((await getJson<unknown[]>(`${svc.baseUrl}/races?filter=current&x=1`)).body).toHaveLength(2);
  });

  it("/health", async () => {
    const { body } = await getJson<{ ok: boolean; version: string }>(`${svc.baseUrl}/health`);
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("REST without data", () => {
  it("returns the empty race (id -1) like Java before the first $B", async () => {
    const svc = await startService();
    try {
      const { body } = await getJson<Array<Record<string, unknown>>>(`${svc.baseUrl}/races?filter=current`);
      expect(body).toEqual([
        {
          raceName: "",
          raceID: -1,
          flagStatus: "NONE",
          elapsedTime: "0:00",
          timeOfDay: "0:00",
          lapsComplete: 0,
          lapsToGo: 0,
          trackName: "",
          trackLength: 0,
          competitors: [],
        },
      ]);
      expect((await getJson(`${svc.baseUrl}/races`)).body).toEqual([]);
    } finally {
      await svc.close();
    }
  });
});
