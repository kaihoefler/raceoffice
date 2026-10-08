import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerStaticServing } from "../src/services/staticServing";

const SERVICE_ENDPOINTS = [
  { path: "/health", description: "Service health check" },
] as const;

/**
 * Builds a temp `publicDir` tree that mirrors a fully built deploy:
 * top-level SPA shell + the two standalone LiveTracking/P3test shells,
 * each with an asset file nested under their own `assets/` folder.
 */
function makeBuiltPublicDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raceoffice-static-"));

  fs.writeFileSync(path.join(dir, "index.html"), "<html>root shell</html>", "utf8");

  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log('root asset');", "utf8");

  fs.mkdirSync(path.join(dir, "livetracking", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "livetracking", "index.html"), "<html>livetracking shell</html>", "utf8");
  fs.writeFileSync(
    path.join(dir, "livetracking", "assets", "app.js"),
    "console.log('livetracking asset');",
    "utf8",
  );

  fs.mkdirSync(path.join(dir, "p3test", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "p3test", "index.html"), "<html>p3test shell</html>", "utf8");

  return dir;
}

async function buildApp(publicDir: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerStaticServing(app, { publicDir, serviceEndpoints: SERVICE_ENDPOINTS });
  await app.ready();
  return app;
}

describe("registerStaticServing — built deploy", () => {
  let publicDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    publicDir = makeBuiltPublicDir();
    app = await buildApp(publicDir);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  it("serves the root SPA shell and its assets", async () => {
    const indexRes = await app.inject({ method: "GET", url: "/index.html" });
    expect(indexRes.statusCode).toBe(200);
    expect(indexRes.body).toBe("<html>root shell</html>");

    const assetRes = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.body).toBe("console.log('root asset');");
  });

  it("redirects /p3test and /livetracking to their trailing-slash form", async () => {
    const p3Redirect = await app.inject({ method: "GET", url: "/p3test" });
    expect(p3Redirect.statusCode).toBe(308);
    expect(p3Redirect.headers.location).toBe("/p3test/");

    const ltRedirect = await app.inject({ method: "GET", url: "/livetracking" });
    expect(ltRedirect.statusCode).toBe(308);
    expect(ltRedirect.headers.location).toBe("/livetracking/");
  });

  it("serves the standalone p3test shell and its assets", async () => {
    const shellRes = await app.inject({ method: "GET", url: "/p3test/" });
    expect(shellRes.statusCode).toBe(200);
    expect(shellRes.headers["content-type"]).toContain("text/html");
    expect(shellRes.body).toBe("<html>p3test shell</html>");
  });

  it("serves the standalone livetracking shell and its nested asset", async () => {
    const shellRes = await app.inject({ method: "GET", url: "/livetracking/" });
    expect(shellRes.statusCode).toBe(200);
    expect(shellRes.body).toBe("<html>livetracking shell</html>");

    const assetRes = await app.inject({ method: "GET", url: "/livetracking/assets/app.js" });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.body).toBe("console.log('livetracking asset');");
  });

  it("falls back to the livetracking shell for client-router routes, without swallowing asset requests", async () => {
    const baseRoute = await app.inject({ method: "GET", url: "/livetracking/live-tracking" });
    expect(baseRoute.statusCode).toBe(200);
    expect(baseRoute.body).toBe("<html>livetracking shell</html>");

    const deepRoute = await app.inject({ method: "GET", url: "/livetracking/live-tracking/session/42" });
    expect(deepRoute.statusCode).toBe(200);
    expect(deepRoute.body).toBe("<html>livetracking shell</html>");

    // Guards the "do NOT use a broad /livetracking/* matcher" invariant from the route comment:
    // asset requests under /livetracking/assets/* must stay static-served, not swallowed by the SPA fallback.
    const assetRes = await app.inject({ method: "GET", url: "/livetracking/assets/app.js" });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers["content-type"]).not.toContain("text/html");
  });

  it("returns the JSON discovery body for unknown non-HTML requests", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/does-not-exist",
      headers: { accept: "application/json" },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("not_found");
    expect(body.availableServices).toEqual(SERVICE_ENDPOINTS);
  });

  it("returns 404 JSON discovery for non-GET requests regardless of Accept header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/does-not-exist",
      headers: { accept: "text/html" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("falls back to the root SPA shell for unknown browser-navigation requests", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/some/client-side/route",
      headers: { accept: "text/html" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<html>root shell</html>");
  });
});

describe("registerStaticServing — not-yet-built deploy", () => {
  let publicDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    // Empty publicDir: mirrors a dev checkout where no frontend has been built yet.
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "raceoffice-static-empty-"));
    app = await buildApp(publicDir);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  it("reports p3test/livetracking as not built instead of erroring", async () => {
    const p3Res = await app.inject({ method: "GET", url: "/p3test/" });
    expect(p3Res.statusCode).toBe(404);
    expect(p3Res.json().error).toBe("p3test_ui_not_built");

    const ltRes = await app.inject({ method: "GET", url: "/livetracking/" });
    expect(ltRes.statusCode).toBe(404);
    expect(ltRes.json().error).toBe("livetracking_ui_not_built");
  });

  it("serves the service-discovery HTML page when no root shell is built", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/some/client-side/route",
      headers: { accept: "text/html" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Endpoint not found");
    expect(res.body).toContain("/health");
  });
});
