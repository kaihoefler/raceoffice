import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

export type ServiceEndpoint = { path: string; description: string };

/**
 * Registers static asset serving, the standalone SPA shells (p3test, livetracking)
 * and the not-found fallback (JSON discovery vs. SPA index.html) on `app`.
 *
 * Kept isolated from the realtime core (`index.ts`) so it can be exercised with
 * `fastify.inject()` without booting SQLite/websocket/worker-manager side effects.
 */
export async function registerStaticServing(
  app: FastifyInstance,
  options: { publicDir: string; serviceEndpoints: readonly ServiceEndpoint[] },
): Promise<void> {
  const { publicDir, serviceEndpoints } = options;
  const p3TestUiIndex = path.join(publicDir, "p3test", "index.html");
  const liveTrackingUiIndex = path.join(publicDir, "livetracking", "index.html");

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/", // assets unter /
  });

  function serviceDiscoveryBody() {
    return {
      error: "not_found",
      message: "Unknown endpoint.",
      availableServices: serviceEndpoints,
    };
  }

  // --- Standalone P3 test UI (separate from race result management shell)
  // Important URL behavior:
  // - Vite build uses relative asset paths (./assets/...)
  // - Therefore the canonical URL must end with a trailing slash so browsers resolve
  //   assets under /p3test/assets instead of /assets.
  app.get("/p3test", async (_req, reply) => {
    return reply.redirect("/p3test/", 308);
  });

  app.get("/p3test/", async (_req, reply) => {
    if (!fs.existsSync(p3TestUiIndex)) {
      return reply.code(404).send({
        error: "p3test_ui_not_built",
        message: "P3 test frontend not built. Run npm run build:p3test-frontend.",
      });
    }

    return reply.type("text/html; charset=utf-8").send(fs.readFileSync(p3TestUiIndex, "utf8"));
  });

  // --- Standalone LiveTracking UI
  app.get("/livetracking", async (_req, reply) => {
    return reply.redirect("/livetracking/", 308);
  });

  app.get("/livetracking/", async (_req, reply) => {
    if (!fs.existsSync(liveTrackingUiIndex)) {
      return reply.code(404).send({
        error: "livetracking_ui_not_built",
        message: "LiveTracking frontend not built. Run npm run build:livetracking-frontend.",
      });
    }

    return reply.type("text/html; charset=utf-8").send(fs.readFileSync(liveTrackingUiIndex, "utf8"));
  });

  // Browser-router fallback for standalone LiveTracking frontend routes.
  // Important: keep this scoped to the client route namespace only.
  // Do NOT use a broad /livetracking/* matcher, otherwise JS/CSS asset requests under
  // /livetracking/assets/* would receive HTML and fail MIME checks.
  app.get("/livetracking/live-tracking", async (_req, reply) => {
    if (!fs.existsSync(liveTrackingUiIndex)) {
      return reply.code(404).send({
        error: "livetracking_ui_not_built",
        message: "LiveTracking frontend not built. Run npm run build:livetracking-frontend.",
      });
    }

    return reply.type("text/html; charset=utf-8").send(fs.readFileSync(liveTrackingUiIndex, "utf8"));
  });

  app.get("/livetracking/live-tracking/*", async (_req, reply) => {
    if (!fs.existsSync(liveTrackingUiIndex)) {
      return reply.code(404).send({
        error: "livetracking_ui_not_built",
        message: "LiveTracking frontend not built. Run npm run build:livetracking-frontend.",
      });
    }

    return reply.type("text/html; charset=utf-8").send(fs.readFileSync(liveTrackingUiIndex, "utf8"));
  });

  // Not-found strategy:
  // - JSON discovery for API/non-HTML requests
  // - SPA fallback to index.html for browser navigation when built
  app.setNotFoundHandler((req, reply) => {
    const discovery = serviceDiscoveryBody();

    if (req.method !== "GET") return reply.code(404).send(discovery);

    const accept = String(req.headers.accept ?? "");
    if (!accept.includes("text/html")) return reply.code(404).send(discovery);

    const indexPath = path.join(publicDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      const servicesHtml = serviceEndpoints
        .map((s) => `<li><a href="${s.path}">${s.path}</a> — ${s.description}</li>`)
        .join("");

      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RaceOffice Server - Not Found</title>
  </head>
  <body style="font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5;">
    <h1>Endpoint not found</h1>
    <p>The requested address does not exist on this server.</p>
    <p><strong>Available services:</strong></p>
    <ul>${servicesHtml}</ul>
    <p style="margin-top: 1rem; color: #666;">Frontend is not built. Run <code>npm run build</code> to serve the SPA.</p>
  </body>
</html>`);
    }

    return reply.type("text/html").sendFile("index.html");
  });
}
