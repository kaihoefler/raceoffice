import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

type ConnInfo = { status: RealtimeStatus; error: string | null; updatedAt: number };

type Ctx = {
  connections: Record<string, ConnInfo>;
  setConnection: (docId: string, status: RealtimeStatus, error?: string | null) => void;
};

const RealtimeConnectionContext = createContext<Ctx | null>(null);

export function RealtimeConnectionProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Record<string, ConnInfo>>({});

  const setConnection = useCallback((docId: string, status: RealtimeStatus, error: string | null = null) => {
    setConnections((prev) => ({
      ...prev,
      [docId]: { status, error, updatedAt: Date.now() },
    }));
  }, []);

  const value = useMemo(() => ({ connections, setConnection }), [connections, setConnection]);
  return <RealtimeConnectionContext.Provider value={value}>{children}</RealtimeConnectionContext.Provider>;
}

export function useRealtimeConnections() {
  return useContext(RealtimeConnectionContext);
}
