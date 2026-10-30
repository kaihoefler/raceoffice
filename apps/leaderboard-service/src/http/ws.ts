/**
 * WebSocket endpoints (read-only for clients):
 * - `/ws/race/current`  snapshot + patches, follows the current race
 * - `/ws/race/:id`      snapshot + patches of one race (snapshot with data null until it exists)
 * - `/ws/status`        service status, pushed on change (checked every second)
 *
 * Clients may send `{"type":"resync"}` to get a fresh snapshot. The server pings every 15 s.
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { LeaderboardWsMessage } from "@raceoffice/domain";
import type { ChannelKey } from "../publisher.js";
import type { LeaderboardService } from "../service.js";

const PING_INTERVAL_MS = 15_000;
const STATUS_INTERVAL_MS = 1000;

export function registerWsRoutes(app: FastifyInstance, service: LeaderboardService): { clients: () => number } {
  const sockets = new Set<WebSocket>();

  const pinger = setInterval(() => {
    for (const s of sockets) {
      try {
        s.ping();
      } catch {
        // closed meanwhile
      }
    }
  }, PING_INTERVAL_MS);
  pinger.unref();
  app.addHook("onClose", async () => clearInterval(pinger));

  const track = (socket: WebSocket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };

  const sendJson = (socket: WebSocket, message: unknown) => {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // ignore: the close handler cleans up
    }
  };

  const subscribe = (socket: WebSocket, key: ChannelKey) => {
    track(socket);
    const subscription = service.publisher.subscribe(key, (m: LeaderboardWsMessage) => sendJson(socket, m));
    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString("utf8")) as { type?: unknown };
        if (msg.type === "resync") subscription.resync();
      } catch {
        sendJson(socket, { type: "error", code: "bad_message", message: "expected JSON {type:\"resync\"}" });
      }
    });
    socket.on("close", () => subscription.unsubscribe());
  };

  app.get("/ws/race/current", { websocket: true }, (socket) => subscribe(socket, "current"));

  app.get("/ws/race/:id", { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    if (!/^\d+$/.test(id)) {
      sendJson(socket, { type: "error", code: "bad_race_id", message: `invalid race id: ${id}` });
      socket.close(1008, "invalid race id");
      return;
    }
    subscribe(socket, `race:${Number(id)}`);
  });

  app.get("/ws/status", { websocket: true }, (socket) => {
    track(socket);
    let last = "";
    const push = () => {
      const status = service.status();
      // Time-dependent fields change constantly; compare without them to push only real changes…
      const key = JSON.stringify({ ...status, player: { ...status.player, positionMs: 0, progress: 0 } });
      // …but keep pushing once per second while a replay runs or data flows (progress, rates).
      if (key === last && status.player.state !== "playing") return;
      last = key;
      sendJson(socket, { type: "status", status } satisfies LeaderboardWsMessage);
    };
    push();
    const timer = setInterval(push, STATUS_INTERVAL_MS);
    const off = service.onStatus(push);
    socket.on("close", () => {
      clearInterval(timer);
      off();
    });
  });

  return { clients: () => sockets.size };
}
