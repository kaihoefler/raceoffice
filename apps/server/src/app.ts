import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import websocket from "@fastify/websocket";
import { FastifySSEPlugin } from "fastify-sse-v2";
import cors from "@fastify/cors";
import os from "node:os";

import {
  createLiveTrackingPassingHistoryDocument,
  createLiveTrackingRuntimeDocument,
  isLiveTrackingRuntimeDocument,
  makeLiveTrackingPassingHistoryDocId,
  makeLiveTrackingRuntimeDocId,
} from "@raceoffice/domain";
import { DocStore } from "./services/docStore.js";
import { RealtimeHub } from "./services/realtimeHub.js";
import { registerStaticServing } from "./services/staticServing.js";
import {
  buildCurrentRaceResultPayload,
  resolveCurrentRaceContext,
} from "./services/currentRaceResultService.js";
import { LiveTrackingWorkerManager } from "./services/liveTrackingWorkerManager.js";
import {
  LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS,
  registerLiveTrackingWorkerRoutes,
} from "./services/liveTrackingWorkerRoutes.js";
import {
  P3_TEST_CLIENT_SERVICE_ENDPOINTS,
  registerP3TestClientRoutes,
} from "./services/p3TestClientRoutes.js";
import { P3TestClientService } from "./services/p3TestClientService.js";
import {
  P3_DISCOVERY_SERVICE_ENDPOINTS,
  registerP3DiscoveryRoutes,
} from "./services/p3DiscoveryRoutes.js";
import { TimingPassingStore } from "./services/timingPassingStore.js";
import { migrateLegacySetupDecoders, registerTimingRoutes } from "./services/timingRoutes.js";

// Public non-realtime endpoints for service discovery/fallback responses.
export const PUBLIC_SERVICE_ENDPOINTS = [
  {
    path: "/health",
    description: "Service health check",
  },
  {
    path: "/current_race_result",
    description: "Current active race result export",
  },
  {
    path: "/p3test",
    description: "Standalone P3 parser test frontend",
  },
  {
    path: "/livetracking",
    description: "Standalone LiveTracking frontend",
  },

  ...LIVE_TRACKING_WORKER_SERVICE_ENDPOINTS,
  ...P3_TEST_CLIENT_SERVICE_ENDPOINTS,
  ...P3_DISCOVERY_SERVICE_ENDPOINTS,
] as const;

export type BuildAppOptions = {
  /** SQLite file path (parent directory is created if missing). */
  dbPath: string;
  /** Root of the built SPAs (`index.html`, `livetracking/`, `p3test/`). */
  publicDir: string;
  /** Workspace/deploy root used to locate the LiveTracking worker and AMMC tools. */
  repoRoot: string;
  /** URL the LiveTracking worker uses to reach this server. */
  liveTrackingServerUrl: string;
  logger?: FastifyServerOptions["logger"];
};

/**
 * Builds the fully wired server without listening.
 *
 * Construction has no external side effects beyond opening the SQLite file:
 * the LiveTracking worker and P3 client only start on explicit API calls.
 * `app.close()` stops them and closes the database.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // Register transport plugins before route declarations.
  await app.register(websocket);
  await app.register(FastifySSEPlugin);
  await app.register(cors, {
    origin: true, // dev: alles erlauben
    credentials: true,
  });

  await registerStaticServing(app, { publicDir: options.publicDir, serviceEndpoints: PUBLIC_SERVICE_ENDPOINTS });

  const docStore = new DocStore(options.dbPath);
  app.log.info({ dbPath: options.dbPath }, "Using sqlite db");

  const hub = new RealtimeHub(docStore, app.log);
  const loadDoc = (id: string) => docStore.loadDoc(id);

  const liveTrackingRuntimeDocId = makeLiveTrackingRuntimeDocId();
  const commitLiveTrackingRuntimeUpdate = (
    updater: (runtime: ReturnType<typeof createLiveTrackingRuntimeDocument>) => ReturnType<typeof createLiveTrackingRuntimeDocument>,
  ): void => {
    hub.commitServerDocUpdate(liveTrackingRuntimeDocId, (currentData) => {
      const runtime = isLiveTrackingRuntimeDocument(currentData)
        ? {
            ...createLiveTrackingRuntimeDocument(),
            ...currentData,
          }
        : createLiveTrackingRuntimeDocument();

      return updater(runtime);
    });
  };

  const liveTrackingWorkerManager = new LiveTrackingWorkerManager({
    repoRoot: options.repoRoot,
    liveTrackingServerUrl: options.liveTrackingServerUrl,

    logger: {
      info: (obj, msg) => app.log.info(obj as any, msg),
      warn: (obj, msg) => app.log.warn(obj as any, msg),
    },
    runtimeSync: {
      markStarting: (pid) => {
        const t = new Date().toISOString();
        commitLiveTrackingRuntimeUpdate((runtime) => ({
          ...runtime,
          workerStatus: "starting",
          workerProcessId: pid,
          workerHost: os.hostname(),
          updatedAt: t,
        }));
      },
      markStopping: (pid) => {
        const t = new Date().toISOString();
        commitLiveTrackingRuntimeUpdate((runtime) => ({
          ...runtime,
          workerStatus: "stopping",
          workerProcessId: pid,
          workerHost: os.hostname(),
          updatedAt: t,
        }));
      },
      markOffline: (reason) => {
        const t = new Date().toISOString();
        commitLiveTrackingRuntimeUpdate((runtime) => ({
          ...runtime,
          workerStatus: "offline",
          workerHeartbeatAt: null,
          workerProcessId: null,
          workerHost: null,
          updatedAt: t,
          warnings: [...runtime.warnings.slice(-99), `[server] worker offline: ${reason}`],
        }));
      },
    },
  });

  const p3TestClientService = new P3TestClientService({
    info: (obj, msg) => app.log.info(obj as any, msg),
    warn: (obj, msg) => app.log.warn(obj as any, msg),
  });

  // --- Health
  app.get("/health", async () => ({ ok: true }));

  // --- LiveTracking worker process lifecycle
  registerLiveTrackingWorkerRoutes(app, liveTrackingWorkerManager);

  // --- Timing layer: passing store + API (doc/timing-architecture.md)
  const timingPassingStore = new TimingPassingStore(docStore.database);
  registerTimingRoutes(app, timingPassingStore);
  const migratedDecoders = migrateLegacySetupDecoders(loadDoc, (id, updater) => hub.commitServerDocUpdate(id, updater));
  if (migratedDecoders > 0) app.log.info({ migratedDecoders }, "registered decoders of LiveTracking setups in the timing register");

  // --- LiveTracking passing history reset
  // Done server-side so subscribers get one whole-document replace instead of a JSON-Patch
  // diff with one remove op per passing, and the control page never has to load the history.
  app.post("/live-tracking/passing-history/reset", async () => {
    const doc = hub.commitServerDocUpdate(makeLiveTrackingPassingHistoryDocId(), () => ({
      ...createLiveTrackingPassingHistoryDocument(),
      updatedAt: new Date().toISOString(),
    }));
    return { ok: true, rev: doc.rev };
  });

  // --- P3 protocol test client control routes
  registerP3TestClientRoutes(app, p3TestClientService);

  // --- P3 decoder network discovery scan
  registerP3DiscoveryRoutes(app);

  // --- Current race status export for external systems/integrations
  app.get("/current_race_result", async (_req, reply) => {
    const ctx = resolveCurrentRaceContext(loadDoc);

    if (!ctx) {
      return reply.code(404).send({
        error: "no_current_race",
        message: "No active event/race found.",
      });
    }

    return reply.send(buildCurrentRaceResultPayload(ctx.race));
  });

  // --- Realtime document protocol (WebSocket + SSE)
  hub.registerRoutes(app);

  app.addHook("onClose", async () => {
    // Stopping the worker still writes the runtime doc, so close the db last.
    liveTrackingWorkerManager.stop();
    p3TestClientService.disconnect("server shutting down");
    docStore.close();
  });

  return app;
}
