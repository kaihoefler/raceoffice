// useServiceStatus: service status pushed over /ws/status (with reconnect).

import { useEffect, useState } from "react";
import type { LeaderboardServiceStatus, LeaderboardWsMessage } from "@raceoffice/domain";
import { wsUrl } from "../api";

export type ServiceStatusStream = { status: LeaderboardServiceStatus | null; connected: boolean };

export function useServiceStatus(): ServiceStatusStream {
  const [state, setState] = useState<ServiceStatusStream>({ status: null, connected: false });

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl("ws/status"));
      socket = ws;
      ws.onopen = () => {
        backoff = 1000;
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as LeaderboardWsMessage;
          if (msg.type === "status") setState({ status: msg.status, connected: true });
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setState((s) => ({ ...s, connected: false }));
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
  }, []);

  return state;
}
