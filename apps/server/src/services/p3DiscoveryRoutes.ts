import type { FastifyInstance } from "fastify";
import { P3DecoderDiscovery, type DiscoveredDecoder } from "@raceoffice/p3parser";

export const P3_DISCOVERY_SERVICE_ENDPOINTS = [
  {
    path: "/live-tracking/p3-discovery/scan",
    description: "UDP broadcast scan for P3 decoders in the local network",
  },
] as const;

function toErrorMessage(err: unknown): string {
  // The discovery binds the fixed reply port 5303; a second scan (e.g. from the
  // P3 test client) running at the same time fails with EADDRINUSE.
  if ((err as NodeJS.ErrnoException | null)?.code === "EADDRINUSE") {
    return "UDP port 5303 is in use — another P3 discovery (e.g. P3 test client) is running. Retry in a few seconds.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function registerP3DiscoveryRoutes(app: FastifyInstance): void {
  // Concurrent requests (double click, several operator tabs) join the running scan.
  let scanInFlight: Promise<DiscoveredDecoder[]> | null = null;

  app.get("/live-tracking/p3-discovery/scan", async (req, reply) => {
    const rawTimeout = (req.query as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs = rawTimeout !== undefined
      ? Math.min(10_000, Math.max(500, Number(rawTimeout)))
      : 3_000;

    if (!Number.isFinite(timeoutMs)) {
      return reply.code(400).send({ ok: false, message: "Invalid timeoutMs" });
    }

    try {
      scanInFlight ??= P3DecoderDiscovery.scan(timeoutMs).finally(() => {
        scanInFlight = null;
      });
      const decoders = await scanInFlight;
      return reply.send({ ok: true, decoders });
    } catch (err) {
      return reply.code(500).send({ ok: false, message: toErrorMessage(err) });
    }
  });
}
