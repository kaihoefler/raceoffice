import type { FastifyInstance } from "fastify";

import type {
  LiveTrackingWorkerControlResult,
  LiveTrackingWorkerStatusSnapshot,
} from "./liveTrackingWorkerManager.js";

export const LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS = [
  {
    path: "/live-tracking/worker/status",
    description: "LiveTracking worker process status",
  },
  {
    path: "/live-tracking/worker/start",
    description: "Start LiveTracking worker process",
  },
  {
    path: "/live-tracking/worker/stop",
    description: "Stop LiveTracking worker process",
  },
] as const;

type LiveTrackingWorkerControl = {
  status: () => LiveTrackingWorkerStatusSnapshot;
  start: () => LiveTrackingWorkerControlResult;
  stop: () => LiveTrackingWorkerControlResult;
};

/**
 * Registers HTTP routes for server-managed LiveTracking worker lifecycle.
 *
 * Kept separate from `index.ts` so entrypoint focuses on generic realtime infra
 * while this module owns the LiveTracking control surface.
 */
export function registerLiveTrackingWorkerRoutes(app: FastifyInstance, worker: LiveTrackingWorkerControl) {
  app.get("/live-tracking/worker/status", async () => {
    const status = worker.status();
    return {
      ok: true,
      ...status,
    };
  });

  app.post("/live-tracking/worker/start", async (_req, reply) => {
    const result = worker.start();
    if (!result.ok) return reply.code(500).send(result);
    return reply.send(result);
  });

  app.post("/live-tracking/worker/stop", async () => {
    return worker.stop();
  });
}
