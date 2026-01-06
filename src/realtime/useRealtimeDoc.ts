import { useCallback, useEffect, useRef, useState } from "react";
import { applyPatch, compare, type Operation } from "fast-json-patch";

type SnapshotMsg<T> = { type: "snapshot"; docId: string; rev: number; data: T };
type PatchMsg = { docId: string; rev: number; patch: Operation[] };

/*
TODO von ChatGPT:
Was du als Nächstes brauchst (sonst wirst du es schnell merken)

1. rev mismatch handling: Server kann {error:"rev_mismatch", rev:...} senden. Dann Client: Snapshot neu ziehen / reconnect.

2. Persistente Initialdaten: Server initialisiert eventList sauber (oben).

3. Konflikte/Validierung: spätestens wenn mehrere Clients gleichzeitig editieren.

Wenn du mir sagst, ob du SSE zusätzlich willst (z.B. Read-only Clients ohne WS), gebe ich dir die identische Client-Variante mit EventSource + fallback auf WS für Commands.

*/

// TODO: Was passiert wenn der Server nicht da ist? --> Application Status muss auf Fehler gehen?

export function useRealtimeDoc<T>(docId: string) {
    const [data, setData] = useState<T | null>(null);

    const dataRef = useRef<T | null>(null);
    const revRef = useRef<number>(0);
    const wsRef = useRef<WebSocket | null>(null);

    // immer den letzten Stand im Ref halten (für update())
    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    useEffect(() => {
        const wsUrl = new URL(`/ws/${docId}`, window.location.origin);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

        const ws = new WebSocket(wsUrl.toString());
        wsRef.current = ws;

        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            console.log("WS msg", ev.data);
            if (msg?.type === "snapshot") {
                const s = msg as SnapshotMsg<T>;
                revRef.current = s.rev;
                setData(s.data);
                return;
            }

            // patch broadcast
            const p = msg as PatchMsg;
            if (!p?.patch || typeof p.rev !== "number") return;

            setData((prev) => {
                if (prev === null) return prev;

                const next = applyPatch(structuredClone(prev), p.patch, true, true).newDocument as T;
                revRef.current = p.rev;
                return next;
            });
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [docId]);

    // KEIN optimistic update: nur senden, State kommt vom Server
    const update = useCallback((fn: (prev: T) => T) => {
        const prev = dataRef.current;
        if (prev === null) return;

        const next = fn(prev);
        const patch = compare(prev as any, next as any) as Operation[];

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && patch.length > 0) {
            ws.send(JSON.stringify({ baseRev: revRef.current, patch }));
            console.log(JSON.stringify({ baseRev: revRef.current, patch }));
        }
    }, []);

    return { data, update };
}
