// Control calls for the leaderboard service, via the RaceOffice server.
//
// - /leaderboard-service/*  process (managed mode) and integration mode of the server
// - /leaderboard/api/*      control API of the service itself (proxied; the server adds the token)
// See doc/leaderboard-integration/05-worker-und-steuerung.md.

export const LEADERBOARD_UI_URL = "/leaderboard/ui/";
export const LEADERBOARD_CONTROL_URL = "/leaderboard/ui/#/control";

async function call<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const leaderboardServiceClient = {
  startService: () => call("/leaderboard-service/start", { method: "POST" }),
  stopService: () => call("/leaderboard-service/stop", { method: "POST" }),
  setMode: (mode: "managed" | "external" | "off", url?: string) =>
    call("/leaderboard-service/mode", { method: "POST", body: JSON.stringify(url ? { mode, url } : { mode }) }),
  connectOrbits: (params: { host?: string; port?: number }) =>
    call("/leaderboard/api/client/connect", { method: "POST", body: JSON.stringify(params) }),
  disconnectOrbits: () => call("/leaderboard/api/client/disconnect", { method: "POST" }),
};
