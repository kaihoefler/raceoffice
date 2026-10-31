/**
 * WebSocket endpoints (read-only for clients):
 * - `/ws/race/current`  snapshot + patches, follows the current race
 * - `/ws/race/:id`      snapshot + patches of one race (snapshot with data null until it exists)
 * - `/ws/status`        service status, pushed on change (checked every second)
 * - `/ws/race/current/passings`  finish line log: all passings of the current race, then each new
 *                        or updated passing; a new snapshot on race change and reset
 *
 * Clients may send `{"type":"resync"}` to get a fresh snapshot. The server pings every 15 s.
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { LeaderboardPassing, LeaderboardWsMessage } from "@raceoffice/domain";
import type { ChannelKey } from "../publisher.js";
import type { LeaderboardService } from "../service.js";

const PING_INTERVAL_MS = 15_000;
const STATUS_INTERVAL_MS = 1000;
/** Passings are sent in small batches; a burst (seek, catch-up) becomes one snapshot instead. */
const PASSINGS_FLUSH_MS = 50;
const PASSINGS_BURST = 100;

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

  app.get("/ws/race/current/passings", { websocket: true }, (socket) => {
    track(socket);
    let raceId: number | null = null;
    let queue: LeaderboardPassing[] = [];
    let needSnapshot = true;
    let timer: NodeJS.Timeout | null = null;

    const displayId = () => {
      const id = service.store.displayRace.id;
      return id === -1 ? null : id;
    };
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const current = displayId();
      if (needSnapshot || current !== raceId || queue.length > PASSINGS_BURST) {
        raceId = current;
        sendJson(socket, {
          type: "passings",
          raceId,
          passings: raceId === null ? [] : service.passings.list(raceId),
        } satisfies LeaderboardWsMessage);
      } else if (raceId !== null) {
        for (const passing of queue) {
          sendJson(socket, { type: "passing", raceId, passing } satisfies LeaderboardWsMessage);
        }
      }
      queue = [];
      needSnapshot = false;
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, PASSINGS_FLUSH_MS);
    };

    const offPassings = service.passings.subscribe((event) => {
      if (event.type === "reset") needSnapshot = true;
      else if (event.raceId === raceId) queue.push(event.passing);
      else needSnapshot = true;
      schedule();
    });
    // Race changes without passings (new $B, race end) come through the race stream.
    const raceSubscription = service.publisher.subscribe("current", (m: LeaderboardWsMessage) => {
      if (m.type === "snapshot" && displayId() !== raceId) {
        needSnapshot = true;
        schedule();
      }
    });
    flush();
    socket.on("close", () => {
      if (timer) clearTimeout(timer);
      offPassings();
      raceSubscription.unsubscribe();
    });
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
