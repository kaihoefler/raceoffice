// usePassings: finish line log over /ws/race/current/passings.
//
// The service sends all buffered passings of the current race (snapshot: on connect, race change,
// reset, bursts) and then each new or updated passing; updates carry the same `seq` (position and
// lap from the following $G, photo-finish correction). Reconnects with backoff like the race stream.

import { useEffect, useState } from "react";
import type { LeaderboardPassing, LeaderboardWsMessage } from "@raceoffice/domain";
import { onReconnectRequest, wsUrl } from "../api";

export type PassingsStream = {
  raceId: number | null;
  /** Oldest first. */
  passings: LeaderboardPassing[];
  /** Arrival time per seq for passings received live (not from a snapshot): highlights new rows. */
  arrivedAt: ReadonlyMap<number, number>;
  connected: boolean;
};

const MAX_PASSINGS = 500;

export function usePassings(): PassingsStream {
  const [stream, setStream] = useState<PassingsStream>({ raceId: null, passings: [], arrivedAt: new Map(), connected: false });

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl("ws/race/current/passings"));
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
        if (msg.type === "passings") {
          setStream({ raceId: msg.raceId, passings: msg.passings, arrivedAt: new Map(), connected: true });
        } else if (msg.type === "passing") {
          const passing = msg.passing;
          setStream((s) => {
            if (s.raceId !== msg.raceId) return s;
            const i = s.passings.findIndex((p) => p.seq === passing.seq);
            if (i >= 0) {
              const passings = [...s.passings];
              passings[i] = passing;
              return { ...s, passings };
            }
            const arrivedAt = new Map(s.arrivedAt).set(passing.seq, Date.now());
            return { ...s, passings: [...s.passings, passing].slice(-MAX_PASSINGS), arrivedAt };
          });
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setStream((s) => ({ ...s, connected: false }));
        retry = setTimeout(connect, backoff);
        backoff = Math.min(10_000, backoff * 2);
      };
    };

    connect();
    const unsubscribe = onReconnectRequest(() => {
      if (disposed || (socket && socket.readyState === WebSocket.OPEN)) return;
      if (retry) clearTimeout(retry);
      retry = null;
      backoff = 1000;
      if (socket) socket.onclose = null;
      socket?.close();
      connect();
    });
    return () => {
      unsubscribe();
      disposed = true;
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return stream;
}
