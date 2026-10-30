// useLeaderboardStream: live race over WebSocket (snapshot + JSON patch).
// - reconnects with backoff (1 s → 10 s); a revision gap forces a reconnect (fresh snapshot)
// - `lastUpdateAt` moves with every message; the service sends at least one per Orbits heartbeat,
//   so "no message for > 3 s" means the data is stale (WebSocket or Orbits down)

import { useEffect, useState } from "react";
import fastJsonPatch from "fast-json-patch";
import type { LeaderboardWsMessage, RaceStatusRace } from "@raceoffice/domain";
import { wsUrl } from "../api";

export type LeaderboardStream = {
  race: RaceStatusRace | null;
  rev: number | null;
  connected: boolean;
  lastUpdateAt: number | null;
};

export const STALE_AFTER_MS = 3000;

export function useLeaderboardStream(raceId: "current" | number = "current"): LeaderboardStream {
  const [stream, setStream] = useState<LeaderboardStream>({ race: null, rev: null, connected: false, lastUpdateAt: null });

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let data: RaceStatusRace | null = null;
    let rev: number | null = null;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl(`ws/race/${raceId}`));
      socket = ws;
      ws.onopen = () => {
        backoff = 1000;
        setStream((s) => ({ ...s, connected: true }));
      };
      ws.onmessage = (event) => {
        let msg: LeaderboardWsMessage;
        try {
          msg = JSON.parse(String(event.data)) as LeaderboardWsMessage;
        } catch {
          return;
        }
        if (msg.type === "snapshot") {
          data = msg.data;
          rev = msg.rev;
        } else if (msg.type === "patch") {
          if (rev === null || msg.baseRev !== rev) {
            ws.close();
            return;
          }
          try {
            data = fastJsonPatch.applyPatch(structuredClone(data), msg.patch, true, false).newDocument;
          } catch {
            ws.close();
            return;
          }
          rev = msg.rev;
        } else {
          return;
        }
        setStream({ race: data, rev, connected: true, lastUpdateAt: Date.now() });
      };
      ws.onclose = () => {
        if (disposed) return;
        rev = null;
        setStream((s) => ({ ...s, connected: false }));
        retry = setTimeout(connect, backoff);
        backoff = Math.min(10_000, backoff * 2);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [raceId]);

  return stream;
}

/** Re-renders every `intervalMs` (for "since …" texts and staleness). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
