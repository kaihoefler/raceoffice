// Access to the leaderboard service: base path, control API, optional control token.
//
// The frontend runs under /ui/ of the service (standalone) or /leaderboard/ui/ (through the
// RaceOffice proxy). All URLs are derived from the page location, never hard-wired.

import type { LeaderboardServiceStatus } from "@raceoffice/domain";

/** Service base path: "/leaderboard/" behind the proxy, "/" standalone and in dev. */
export function serviceBase(pathname: string = globalThis.location?.pathname ?? "/"): string {
  const i = pathname.indexOf("/ui/");
  if (i >= 0) return pathname.slice(0, i + 1);
  return pathname.endsWith("/ui") ? pathname.slice(0, -2) : "/";
}

/**
 * Process control of the RaceOffice server ("/leaderboard-service/" next to the "/leaderboard/"
 * proxy). Null when the frontend is served by a standalone service – there is nothing to start.
 */
export function integrationBase(pathname: string = globalThis.location?.pathname ?? "/"): string | null {
  const base = serviceBase(pathname);
  return base === "/" ? null : `${base.replace(/\/$/, "")}-service/`;
}

/** Status of the leaderboard integration in RaceOffice (GET /leaderboard-service/status, abridged). */
export type IntegrationStatus = {
  mode: "managed" | "external" | "off";
  available: boolean;
  process: { state: "stopped" | "starting" | "running" | "stopping" | "crashed"; lastError: string | null };
};

export const integrationApi = {
  async status(base: string): Promise<IntegrationStatus | null> {
    const res = await fetch(`${base}status`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as IntegrationStatus;
  },
  async start(base: string): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch(`${base}start`, { method: "POST", headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return { ok: res.ok && body.ok !== false, ...(body.message ? { message: body.message } : {}) };
  },
};

const RECONNECT_EVENT = "leaderboard:reconnect";

/** Asks all service connections to reconnect now (e.g. right after the service was started). */
export function requestReconnect(): void {
  globalThis.dispatchEvent?.(new Event(RECONNECT_EVENT));
}

/** Subscribes to reconnect requests; returns the unsubscribe function. */
export function onReconnectRequest(listener: () => void): () => void {
  globalThis.addEventListener?.(RECONNECT_EVENT, listener);
  return () => globalThis.removeEventListener?.(RECONNECT_EVENT, listener);
}

export function apiUrl(path: string): string {
  return `${serviceBase()}${path.replace(/^\//, "")}`;
}

export function wsUrl(path: string): string {
  const loc = globalThis.location;
  const proto = loc?.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${loc?.host ?? "localhost"}${apiUrl(path)}`;
}

/** Absolute URL for display/copy (external consumers). */
export function absoluteUrl(path: string, ws = false): string {
  if (ws) return wsUrl(path);
  const loc = globalThis.location;
  return `${loc?.protocol ?? "http:"}//${loc?.host ?? "localhost"}${apiUrl(path)}`;
}

const TOKEN_KEY = "leaderboard.controlToken";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (raw !== undefined) {
    headers["Content-Type"] = "application/octet-stream";
    payload = raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(apiUrl(path), { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Steuer-Token erforderlich"
        : ((parsed as { message?: string } | null)?.message ?? `HTTP ${res.status}`);
    throw new ApiError(res.status, message);
  }
  return parsed as T;
}

export type RecordingInfo = { file: string; size: number; modifiedAt: number; lines: number; durationMs: number };

export type PersistedConfig = {
  client: { host: string; port: number; encoding: string; autoConnect: boolean; retryMax: number; retryTimeoutMs: number };
  recorder: { autoStart: boolean; name: string };
  player: { file: string | null; speedup: number; fileEncoding: string; skipGaps: boolean };
  publish: { coalesceMs: number };
  state: { corrections: "apply" | "ignore"; maxRaces: number };
  compat: { catchAllRace: boolean };
};

export const api = {
  status: () => request<LeaderboardServiceStatus>("GET", "api/status"),
  config: () => request<PersistedConfig>("GET", "api/config"),
  updateConfig: (patch: Record<string, unknown>) => request<PersistedConfig>("PUT", "api/config", patch),
  connect: (params: { host?: string; port?: number; encoding?: string } = {}) =>
    request<LeaderboardServiceStatus>("POST", "api/client/connect", params),
  disconnect: () => request<LeaderboardServiceStatus>("POST", "api/client/disconnect"),
  startRecorder: (name?: string) => request<{ file: string }>("POST", "api/recorder/start", name ? { name } : {}),
  stopRecorder: () => request<LeaderboardServiceStatus>("POST", "api/recorder/stop"),
  recordings: () => request<RecordingInfo[]>("GET", "api/recordings"),
  recordingUrl: (file: string) => apiUrl(`api/recordings/${encodeURIComponent(file)}`),
  uploadRecording: (file: string, data: Blob) =>
    request<{ file: string }>("PUT", `api/recordings/${encodeURIComponent(file)}`, undefined, data),
  deleteRecording: (file: string) => request<null>("DELETE", `api/recordings/${encodeURIComponent(file)}`),
  startPlayer: (file: string, speedup: number, skipGaps: boolean) =>
    request<LeaderboardServiceStatus>("POST", "api/player/start", { file, speedup, skipGaps }),
  pausePlayer: () => request<LeaderboardServiceStatus>("POST", "api/player/pause"),
  resumePlayer: () => request<LeaderboardServiceStatus>("POST", "api/player/resume"),
  stopPlayer: () => request<LeaderboardServiceStatus>("POST", "api/player/stop"),
  seekPlayer: (positionMs: number) => request<LeaderboardServiceStatus>("POST", "api/player/seek", { positionMs }),
  setPlayerSkipGaps: (enabled: boolean) =>
    request<LeaderboardServiceStatus>("POST", "api/player/skip-gaps", { enabled }),
  setPlayerSpeed: (speedup: number) => request<LeaderboardServiceStatus>("POST", "api/player/speed", { speedup }),
  resetState: () => request<LeaderboardServiceStatus>("POST", "api/state/reset"),
};
