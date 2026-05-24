import type { FastifyInstance } from "fastify";
import { P3DecoderDiscovery } from "@raceoffice/p3parser";

export const P3_DISCOVERY_SERVICE_ENDPOINTS = [
  {
    path: "/live-tracking/p3-discovery/scan",
    description: "UDP broadcast scan for P3 decoders in the local network",
  },
] as const;

export function registerP3DiscoveryRoutes(app: FastifyInstance): void {
  app.get("/live-tracking/p3-discovery/scan", async (req, reply) => {
    const rawTimeout = (req.query as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs = rawTimeout !== undefined
      ? Math.min(10_000, Math.max(500, Number(rawTimeout)))
      : 3_000;

    if (!Number.isFinite(timeoutMs)) {
      return reply.code(400).send({ ok: false, message: "Invalid timeoutMs" });
    }

    try {
      const decoders = await P3DecoderDiscovery.scan(timeoutMs);
      return reply.send({ ok: true, decoders });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, message });
    }
  });
}
