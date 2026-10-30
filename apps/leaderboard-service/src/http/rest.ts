/**
 * REST compatibility layer – drop-in for the Java app's JsonServer.
 *
 * Java behavior reproduced:
 * - every HTTP method is answered the same way
 * - `/race/<digits>` → that race or 404 with body `null`; `/race`, `/race/…` → current race
 * - `/races` → all races; `/races?filter=current` (exact query string) → `[current race]`
 * - any other path → current race (`compat.catchAllRace`), except the service's own prefixes
 *   /api, /ws, /ui, /health
 * - `Content-Type: application/json`, `Access-Control-Allow-Origin: *` and the same
 *   `Access-Control-Allow-Headers`
 * - "current race" = current race if it has an id, otherwise the previous, otherwise the empty one
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { toRaceTO } from "@raceoffice/rmonitor";
import type { LeaderboardService } from "../service.js";
import { RateCounter } from "../util/rateCounter.js";

const ALLOW_HEADERS =
  "Access-Control-Allow-Origin, Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers";

const ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;

/** Paths that belong to the service itself and never fall back to the race. */
const OWN_PREFIXES = ["/api/", "/api", "/ws/", "/ui", "/health"];

export function registerRestRoutes(
  app: FastifyInstance,
  service: LeaderboardService,
  options: { catchAllRace: boolean; hasUi: boolean },
): { requestsPerMinute: () => number } {
  const rate = new RateCounter(60);

  const send = (reply: FastifyReply, body: unknown, status = 200) => {
    rate.add();
    return reply
      .code(status)
      .header("Content-Type", "application/json")
      .header("Access-Control-Allow-Headers", ALLOW_HEADERS)
      .header("Access-Control-Allow-Origin", "*")
      // Buffer: Fastify would append "; charset=utf-8" to a string body; Java sends plain application/json.
      .send(Buffer.from(`${JSON.stringify(body)}\n`, "utf8"));
  };

  const currentRace = () => toRaceTO(service.store.displayRace);

  const raceHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    // Java: pathInfo.split("/") → ["", "race", "<id>", …]
    const parts = pathOf(req).split("/");
    const idPart = parts[2];
    if (idPart !== undefined && /^\d+$/.test(idPart)) {
      const race = service.store.getById(Number(idPart));
      return race ? send(reply, toRaceTO(race)) : send(reply, null, 404);
    }
    return send(reply, currentRace());
  };

  const racesHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (queryOf(req) === "filter=current") return send(reply, [currentRace()]);
    return send(reply, service.store.all.map(toRaceTO));
  };

  app.route({ method: [...ALL_METHODS], url: "/race", handler: raceHandler });
  app.route({ method: [...ALL_METHODS], url: "/race/*", handler: raceHandler });
  app.route({ method: [...ALL_METHODS], url: "/races", handler: racesHandler });
  app.route({ method: [...ALL_METHODS], url: "/races/*", handler: racesHandler });

  // "/" : browsers go to the UI (once it exists), everything else gets the race like in Java.
  app.route({
    method: [...ALL_METHODS],
    url: "/",
    handler: async (req, reply) => {
      if (options.hasUi && String(req.headers.accept ?? "").includes("text/html")) return reply.redirect("/ui/");
      if (!options.catchAllRace) return reply.code(404).send({ error: "not_found" });
      return send(reply, currentRace());
    },
  });

  app.setNotFoundHandler(async (req, reply) => {
    const path = pathOf(req);
    if (!options.catchAllRace || OWN_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) {
      return reply.code(404).send({ error: "not_found", path });
    }
    return send(reply, currentRace());
  });

  return { requestsPerMinute: () => rate.total() };
}

function pathOf(req: FastifyRequest): string {
  const url = req.raw.url ?? "/";
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function queryOf(req: FastifyRequest): string | null {
  const url = req.raw.url ?? "";
  const q = url.indexOf("?");
  return q === -1 ? null : url.slice(q + 1);
}
