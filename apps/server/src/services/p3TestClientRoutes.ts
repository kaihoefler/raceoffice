import type { FastifyInstance } from "fastify";
import type { P3TestRequestKind } from "./p3TestClientService.js";

type P3TestClientController = {
  getState: () => unknown;
  getDiscoveryState: () => unknown;
  startDiscovery: (timeoutMs?: number) => Promise<{ ok: boolean; message: string }>;
  connect: (host: string, port: number) => { ok: boolean; message: string };
  disconnect: (reason?: string) => { ok: boolean; message: string };
  clearHistory: () => void;
  sendRequest: (input: {
    kind: P3TestRequestKind;
    decoderId?: string;
    fromPassingNumber?: number;
    toPassingNumber?: number;
  }) => { ok: boolean; message: string };
};


export const P3_TEST_CLIENT_SERVICE_ENDPOINTS = [
  { path: "/p3-test/state", description: "P3 test client snapshot" },
  { path: "/p3-test/discovery/state", description: "UDP discovery state snapshot" },
  { path: "/p3-test/discovery/start", description: "Run UDP decoder discovery" },
  { path: "/p3-test/connect", description: "Connect P3 test client TCP socket" },
  { path: "/p3-test/disconnect", description: "Disconnect P3 test client TCP socket" },
  { path: "/p3-test/request", description: "Send one evidenced P3 request" },
  { path: "/p3-test/clear", description: "Clear P3 test event history" },
] as const;


/**
 * Registers HTTP routes for a server-side P3 test session.
 *
 * Reason for server-side placement:
 * Browsers cannot open raw TCP sockets to decoder port 5403, so the backend
 * terminates TCP and exposes a controlled HTTP API for the frontend.
 */
export function registerP3TestClientRoutes(app: FastifyInstance, controller: P3TestClientController) {
  app.get("/p3-test/state", async () => {
    return {
      ok: true,
      state: controller.getState(),
    };
  });

    app.get("/p3-test/discovery/state", async () => {
    return {
      ok: true,
      discovery: controller.getDiscoveryState(),
    };
  });

  app.post("/p3-test/discovery/start", async (req, reply) => {
    const body = (req.body ?? {}) as { timeoutMs?: unknown };
    const timeoutMs = Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : undefined;

    const result = await controller.startDiscovery(timeoutMs);
    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result);
  });

  app.post("/p3-test/connect", async (req, reply) => {

    const body = (req.body ?? {}) as { host?: unknown; port?: unknown };
    const host = String(body.host ?? "").trim();
    const port = Number(body.port);

    const result = controller.connect(host, port);
    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result);
  });

  app.post("/p3-test/disconnect", async (req) => {
    const body = (req.body ?? {}) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    return controller.disconnect(reason);
  });

  app.post("/p3-test/clear", async () => {
    controller.clearHistory();
    return { ok: true, message: "History cleared." };
  });

  app.post("/p3-test/request", async (req, reply) => {
    const body = (req.body ?? {}) as {
      kind?: unknown;
      decoderId?: unknown;
      fromPassingNumber?: unknown;
      toPassingNumber?: unknown;
    };

    const kind = String(body.kind ?? "").trim() as P3TestRequestKind;
    const payload: {
      kind: P3TestRequestKind;
      decoderId?: string;
      fromPassingNumber?: number;
      toPassingNumber?: number;
    } = { kind };

    if (typeof body.decoderId === "string" && body.decoderId.trim()) {
      payload.decoderId = body.decoderId.trim();
    }

    if (Number.isFinite(Number(body.fromPassingNumber))) {
      payload.fromPassingNumber = Number(body.fromPassingNumber);
    }

    if (Number.isFinite(Number(body.toPassingNumber))) {
      payload.toPassingNumber = Number(body.toPassingNumber);
    }

    const result = controller.sendRequest(payload);

    if (!result.ok) return reply.code(400).send(result);
    return reply.send(result);
  });
}
