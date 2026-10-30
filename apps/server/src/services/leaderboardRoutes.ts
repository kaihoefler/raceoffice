import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";

import type { LeaderboardServiceManager } from "./leaderboardServiceManager.js";

/**
 * Leaderboard integration in the RaceOffice server (doc/leaderboard-integration/05-worker-und-steuerung.md).
 *
 * Modes (switchable at runtime, e.g. for the emergency fallback to the Java app):
 * - managed:  the server runs the leaderboard service itself (LeaderboardServiceManager)
 * - external: proxy to LEADERBOARD_URL – another leaderboard service or the Java RMonitorLeaderboard
 * - off:      no proxy (503); the scoring then uses its own configured URL
 *
 * Routes:
 * - GET  /leaderboard-service/status  mode, process status, service status (if reachable)
 * - POST /leaderboard-service/start   managed only
 * - POST /leaderboard-service/stop    managed only
 * - POST /leaderboard-service/mode    { mode, url? }
 * - *    /leaderboard/*               HTTP proxy to the service (managed: adds the control token)
 * - WS   /leaderboard/ws/*            WebSocket proxy
 */

export type LeaderboardMode = "managed" | "external" | "off";

export const LEADERBOARD_SERVICE_ENDPOINTS = [
  { path: "/leaderboard-service/status", description: "Leaderboard service status (mode, process, Orbits)" },
  { path: "/leaderboard/races?filter=current", description: "Live race status (proxy to the leaderboard service)" },
  { path: "/leaderboard/ui/", description: "Leaderboard frontend" },
] as const;

export type LeaderboardIntegrationOptions = {
  mode: LeaderboardMode;
  externalUrl: string | null;
  manager: LeaderboardServiceManager;
};

/** Holds the current mode and resolves the proxy target. */
export class LeaderboardIntegration {
  mode: LeaderboardMode;
  externalUrl: string | null;

  constructor(readonly options: LeaderboardIntegrationOptions) {
    this.mode = options.mode;
    this.externalUrl = normalizeUrl(options.externalUrl);
  }

  get manager(): LeaderboardServiceManager {
    return this.options.manager;
  }

  /** Current upstream, or null if there is none (off, or managed but not running). */
  target(): { baseUrl: string; token: string | null } | null {
    if (this.mode === "external" && this.externalUrl) return { baseUrl: this.externalUrl, token: null };
    if (this.mode === "managed" && this.manager.status().state === "running") {
      return { baseUrl: this.manager.baseUrl, token: this.manager.token };
    }
    return null;
  }
}

function normalizeUrl(url: string | null | undefined): string | null {
  const v = String(url ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // fetch decompresses transparently; forwarding the encoding headers would corrupt the body.
  "accept-encoding",
  "content-encoding",
]);

const PROXY_PREFIX = "/leaderboard";
const PROXY_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;

export async function registerLeaderboardRoutes(app: FastifyInstance, integration: LeaderboardIntegration): Promise<void> {
  // --- status / control
  app.get("/leaderboard-service/status", async () => {
    const target = integration.target();
    let service: unknown = null;
    if (target) {
      try {
        const res = await fetch(`${target.baseUrl}/api/status`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) service = await res.json();
      } catch {
        service = null;
      }
    }
    return {
      ok: true,
      mode: integration.mode,
      externalUrl: integration.externalUrl,
      available: target !== null,
      process: integration.manager.status(),
      service,
    };
  });

  app.post("/leaderboard-service/start", async (_req, reply) => {
    if (integration.mode !== "managed") {
      return reply.code(409).send({ ok: false, message: `mode is ${integration.mode}, not managed` });
    }
    const result = await integration.manager.start();
    return reply.code(result.ok ? 200 : 500).send(result);
  });

  app.post("/leaderboard-service/stop", async (_req, reply) => {
    if (integration.mode !== "managed") {
      return reply.code(409).send({ ok: false, message: `mode is ${integration.mode}, not managed` });
    }
    return integration.manager.stop();
  });

  app.post(
    "/leaderboard-service/mode",
    {
      schema: {
        body: {
          type: "object",
          required: ["mode"],
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["managed", "external", "off"] },
            url: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { mode: LeaderboardMode; url?: string | null };
      if (body.mode === "external") {
        const url = normalizeUrl(body.url ?? integration.externalUrl);
        if (!url) return reply.code(400).send({ ok: false, message: "external mode needs a url" });
        integration.externalUrl = url;
      }
      // Leaving managed mode does not stop a running service; it keeps running until stopped.
      integration.mode = body.mode;
      return { ok: true, mode: integration.mode, externalUrl: integration.externalUrl };
    },
  );

  // --- proxy (encapsulated: raw bodies for every content type)
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) =>
      done(null, body),
    );

    scope.get(`${PROXY_PREFIX}/ws/*`, { websocket: true }, (client, req) => proxyWebSocket(client, req, integration));

    const handler = (req: FastifyRequest, reply: FastifyReply) => proxyHttp(req, reply, integration);
    scope.route({ method: [...PROXY_METHODS], url: PROXY_PREFIX, handler });
    scope.route({ method: [...PROXY_METHODS], url: `${PROXY_PREFIX}/*`, handler });
  });
}

function upstreamPath(req: FastifyRequest): string {
  const url = req.raw.url ?? "/";
  const rest = url.slice(PROXY_PREFIX.length);
  return rest.startsWith("/") ? rest : `/${rest}`;
}

function unavailable(reply: FastifyReply, integration: LeaderboardIntegration) {
  return reply.code(503).send({
    error: "leaderboard_unavailable",
    mode: integration.mode,
    message:
      integration.mode === "managed"
        ? "Leaderboard service is not running (POST /leaderboard-service/start)."
        : integration.mode === "external"
          ? "No external leaderboard URL configured."
          : "Leaderboard integration is off.",
  });
}

async function proxyHttp(req: FastifyRequest, reply: FastifyReply, integration: LeaderboardIntegration) {
  const target = integration.target();
  if (!target) return unavailable(reply, integration);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  if (target.token) headers.set("authorization", `Bearer ${target.token}`);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && Buffer.isBuffer(req.body);
  let res: Response;
  try {
    res = await fetch(`${target.baseUrl}${upstreamPath(req)}`, {
      method: req.method,
      headers,
      redirect: "manual",
      ...(hasBody ? { body: new Uint8Array(req.body as Buffer) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    req.log.warn({ err: (err as Error).message }, "leaderboard proxy request failed");
    return reply.code(502).send({ error: "leaderboard_unreachable", message: (err as Error).message });
  }

  reply.code(res.status);
  res.headers.forEach((value, name) => {
    if (HOP_BY_HOP.has(name.toLowerCase())) return;
    // Keep redirects of the service (e.g. "/" → "/ui/") inside the proxy prefix.
    if (name.toLowerCase() === "location" && value.startsWith("/")) value = `${PROXY_PREFIX}${value}`;
    reply.header(name, value);
  });
  return reply.send(Buffer.from(await res.arrayBuffer()));
}

function proxyWebSocket(client: WebSocket, req: FastifyRequest, integration: LeaderboardIntegration): void {
  const target = integration.target();
  if (!target) {
    client.close(1013, "leaderboard unavailable");
    return;
  }
  const wsUrl = `${target.baseUrl.replace(/^http/i, "ws")}${upstreamPath(req)}`;
  const upstream = new WebSocket(wsUrl, target.token ? { headers: { authorization: `Bearer ${target.token}` } } : {});
  const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];

  upstream.on("open", () => {
    for (const m of pending.splice(0)) upstream.send(m.data, { binary: m.isBinary });
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("close", (code) => {
    if (client.readyState === WebSocket.OPEN) client.close(code === 1005 || code === 1006 ? 1011 : code);
  });
  upstream.on("error", () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, "leaderboard upstream error");
  });

  client.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, isBinary });
  });
  client.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
  });
}
