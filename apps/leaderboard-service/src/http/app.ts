/**
 * Builds the Fastify app: REST (Java-compatible), WebSocket, control API, optional UI.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { LeaderboardService } from "../service.js";
import { registerControlRoutes } from "./control.js";
import { registerRestRoutes } from "./rest.js";
import { registerWsRoutes } from "./ws.js";

export type BuildAppOptions = {
  /** Directory with the built leaderboard frontend; default `<package>/public`. Served under /ui/. */
  uiDir?: string | null;
  logger?: boolean;
};

/** Default UI location: `public/` next to `dist/` (tsc build) or next to the bundle file. */
export function defaultUiDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "../../public"), join(here, "../public"), join(here, "public")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export async function buildApp(service: LeaderboardService, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const logLevel = service.config.logLevel;
  const app = Fastify({
    logger: options.logger === false || logLevel === "silent" ? false : { level: logLevel },
    // Java answers any path; keep Fastify from rejecting e.g. "//race".
    routerOptions: { ignoreDuplicateSlashes: true },
    bodyLimit: 1024 * 1024,
  });

  await app.register(fastifyWebsocket);

  const uiDir = options.uiDir === undefined ? defaultUiDir() : options.uiDir;
  if (uiDir) {
    await app.register(fastifyStatic, { root: uiDir, prefix: "/ui/", wildcard: false, index: ["index.html"] });
    // SPA fallback for client-side routes under /ui/.
    app.get("/ui/*", (_req, reply) => reply.sendFile("index.html"));
    app.get("/ui", (_req, reply) => reply.redirect("/ui/"));
  }

  registerControlRoutes(app, service);
  const ws = registerWsRoutes(app, service);
  const rest = registerRestRoutes(app, service, {
    catchAllRace: service.config.compat.catchAllRace,
    hasUi: uiDir !== null,
  });

  service.serverStats = () => ({
    port: service.config.server.port,
    wsClients: ws.clients(),
    restRequestsPerMinute: rest.requestsPerMinute(),
  });

  return app;
}
