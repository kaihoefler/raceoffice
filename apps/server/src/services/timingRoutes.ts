import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  createTimingDecodersDocument,
  isLiveTrackingListDocument,
  isLiveTrackingSetupDocument,
  isTimingDecodersDocument,
  isTimingPassingInput,
  makeLiveTrackingListDocId,
  makeLiveTrackingSessionDocId,
  makeLiveTrackingSetupDocId,
  normalizeLiveTrackingSessionDocument,
  isLiveTrackingSessionDocument,
  mergeLegacySetupDecoders,
  migrateAmmcDecoderIds,
  createTimingSimulatorDocument,
  isTimingSimulatorDocument,
  legacySimulatorSettings,
  normalizeSimulatorPassingDelay,
  normalizeTimingDecodersDocument,
  TIMING_SIMULATOR_DOC_ID,
  TIMING_CONNECTION_DOC_ID,
  type LegacySimulatorSettings,
  removeMisderivedLegacyDecoders,
  TIMING_DECODERS_DOC_ID,
  type LiveTrackingSetupDocument,
  type TimingPassing,
  type TimingPassingDeleteFilter,
  type TimingPassingStreamMessage,
} from "@raceoffice/domain";
import type { Doc } from "./docStore.js";
import { TIMING_PASSING_QUERY_MAX, type TimingPassingStore, type TimingPassingStoreEvent } from "./timingPassingStore.js";

/**
 * Timing layer API (doc/timing-architecture.md, section 6).
 *
 * - POST /timing/passings            batch from the timing worker, idempotent by passing id
 * - GET  /timing/passings            query: sinceSeq, limit, decoderIds (comma separated), from, to;
 *                                     or latest=N: the newest N passings, newest first
 * - GET  /timing/passings/stats      totals per decoder, last seq
 * - POST /timing/passings/delete     { confirm: true, filter } – deleting must be explicit
 * - WS   /timing/passings/stream     catch-up from sinceSeq, then live; also deletions
 *
 * Deleting uses POST with a body (not DELETE) so the filter and the confirmation travel
 * reliably through proxies and fetch.
 */

export const TIMING_SERVICE_ENDPOINTS = [
  { path: "/timing/passings", description: "Timing layer passing store (query/upload)" },
  { path: "/timing/passings/stats", description: "Timing layer passing statistics" },
] as const;

/** Catch-up page size of the stream. */
const STREAM_PAGE = 1000;

function splitIds(value: unknown): string[] | undefined {
  const ids = String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function optionalIso(value: unknown): string | undefined {
  const v = String(value ?? "").trim();
  return v && Number.isFinite(Date.parse(v)) ? v : undefined;
}

export function registerTimingRoutes(app: FastifyInstance, store: TimingPassingStore): void {
  app.post("/timing/passings", async (req, reply) => {
    const body = req.body as { passings?: unknown } | null;
    const items = Array.isArray(body?.passings) ? body.passings : null;
    if (!items) return reply.code(400).send({ ok: false, message: "expected { passings: [...] }" });
    const invalid = items.filter((p) => !isTimingPassingInput(p)).length;
    if (invalid > 0) return reply.code(400).send({ ok: false, message: `${invalid} invalid passing(s)` });
    const { inserted, duplicates } = store.insert(items as Parameters<TimingPassingStore["insert"]>[0]);
    return { ok: true, inserted: inserted.length, duplicates, lastSeq: store.lastSeq() };
  });

  app.get("/timing/passings", async (req) => {
    const q = req.query as Record<string, unknown>;
    const decoderIds = splitIds(q.decoderIds);
    if (Number(q.latest) > 0) {
      return { passings: store.latest(Number(q.latest), decoderIds), hasMore: false, lastSeq: store.lastSeq(), maxLimit: TIMING_PASSING_QUERY_MAX };
    }
    const from = optionalIso(q.from);
    const to = optionalIso(q.to);
    const { passings, hasMore } = store.query({
      sinceSeq: Number(q.sinceSeq) || 0,
      limit: Number(q.limit) || 1000,
      ...(decoderIds ? { decoderIds } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return { passings, hasMore, lastSeq: store.lastSeq(), maxLimit: TIMING_PASSING_QUERY_MAX };
  });

  app.get("/timing/passings/stats", async () => store.stats());

  app.post("/timing/passings/delete", async (req, reply) => {
    const body = (req.body ?? {}) as { confirm?: unknown; filter?: Partial<TimingPassingDeleteFilter> };
    if (body.confirm !== true) return reply.code(400).send({ ok: false, message: "deleting passings needs confirm: true" });
    const raw = body.filter ?? {};
    const decoderIds = Array.isArray(raw.decoderIds) ? raw.decoderIds.filter((x): x is string => typeof x === "string") : undefined;
    const from = optionalIso(raw.from);
    const to = optionalIso(raw.to);
    const filter: TimingPassingDeleteFilter = {
      ...(decoderIds && decoderIds.length ? { decoderIds } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(raw.all === true ? { all: true } : {}),
    };
    if (!filter.decoderIds && !filter.from && !filter.to && !filter.all) {
      return reply.code(400).send({ ok: false, message: "empty filter: pass decoderIds/from/to or all: true" });
    }
    return { ok: true, deleted: store.delete(filter) };
  });

  app.get("/timing/passings/stream", { websocket: true }, (socket: WebSocket, req) => {
    const q = req.query as Record<string, unknown>;
    const decoderIds = splitIds(q.decoderIds);
    const wanted = decoderIds ? new Set(decoderIds) : null;
    let lastSent = Math.max(0, Number(q.sinceSeq) || 0);
    let live = false;
    const buffered: TimingPassingStoreEvent[] = [];

    const send = (m: TimingPassingStreamMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    const sendPassings = (passings: TimingPassing[]) => {
      const fresh = passings.filter((p) => p.seq > lastSent && (!wanted || wanted.has(p.decoderId)));
      if (fresh.length === 0) return;
      lastSent = fresh[fresh.length - 1]!.seq;
      send({ type: "passings", passings: fresh });
    };
    const forward = (event: TimingPassingStoreEvent) => {
      if (event.type === "inserted") sendPassings(event.passings);
      else send({ type: "deleted", deleted: event.deleted, filter: event.filter });
    };

    // Subscribe before catching up, so nothing inserted meanwhile is lost (duplicates are
    // filtered by seq).
    const unsubscribe = store.subscribe((event) => (live ? forward(event) : buffered.push(event)));
    socket.on("close", unsubscribe);

    for (;;) {
      const page = store.query({ sinceSeq: lastSent, limit: STREAM_PAGE, ...(decoderIds ? { decoderIds } : {}) });
      sendPassings(page.passings);
      if (!page.hasMore) break;
    }
    live = true;
    for (const event of buffered.splice(0)) forward(event);
    send({ type: "live", lastSeq: store.lastSeq() });
  });
}

/**
 * Phase 1 migration: registers the decoders of all LiveTracking setups in the timing decoder
 * register (non-destructive, idempotent; existing entries are never overwritten).
 */
export function migrateLegacySetupDecoders(
  loadDoc: (id: string) => Doc,
  commit: (docId: string, updater: (current: unknown) => unknown) => Doc,
  renamePassings: (oldId: string, newId: string) => void = () => {},
): number {
  const list = loadDoc(makeLiveTrackingListDocId()).data;
  if (!isLiveTrackingListDocument(list)) return 0;
  const setups: LiveTrackingSetupDocument[] = [];
  for (const entry of list.setups) {
    const setup = loadDoc(makeLiveTrackingSetupDocId(entry.setupId)).data;
    if (isLiveTrackingSetupDocument(setup)) setups.push(setup);
  }
  const current = loadDoc(TIMING_DECODERS_DOC_ID).data;
  // Entries of the former decoder type "sim" become AMMC decoders (simulator settings extracted).
  const normalized = normalizeTimingDecodersDocument(current);
  const at = new Date().toISOString();
  // AMMC ids without the local converter port; references follow the renames.
  const ammc = migrateAmmcDecoderIds(normalized?.doc ?? createTimingDecodersDocument(), at);
  const base = ammc.doc;
  if (ammc.renames.size > 0) applyDecoderRenames(ammc.renames, setups, loadDoc, commit, renamePassings);
  migrateSimulatorSettings(loadDoc, commit, normalized?.legacySimulator ?? legacySimulatorSettings(setups), at);
  const cleaned = removeMisderivedLegacyDecoders(base, setups, at);
  const merged = mergeLegacySetupDecoders(cleaned, setups, at);
  if (merged === current) return 0;
  commit(TIMING_DECODERS_DOC_ID, () => merged);
  return Math.max(1, Math.abs(merged.decoders.length - base.decoders.length));
}

/** Rewrites decoder ids in setups, the connection wish and the stored passings. */
function applyDecoderRenames(
  renames: Map<string, string>,
  setups: LiveTrackingSetupDocument[],
  loadDoc: (id: string) => Doc,
  commit: (docId: string, updater: (current: unknown) => unknown) => Doc,
  renamePassings: (oldId: string, newId: string) => void,
): void {
  const rename = (id: unknown) => (typeof id === "string" ? (renames.get(id) ?? id) : id);
  for (let i = 0; i < setups.length; i++) {
    const setup = setups[i]!;
    const points = setup.track.timingPoints;
    if (!points.some((p) => renames.has(String(p.timingDecoderId ?? "")))) continue;
    const next = { ...setup, track: { ...setup.track, timingPoints: points.map((p) => (p.timingDecoderId ? { ...p, timingDecoderId: rename(p.timingDecoderId) as string } : p)) } };
    commit(makeLiveTrackingSetupDocId(setup.setupId), () => next);
    setups[i] = next;
  }
  const connection = loadDoc(TIMING_CONNECTION_DOC_ID).data as { connectedDecoderIds?: unknown } | null;
  const ids = Array.isArray(connection?.connectedDecoderIds) ? (connection.connectedDecoderIds as string[]) : [];
  if (ids.some((id) => renames.has(id))) {
    commit(TIMING_CONNECTION_DOC_ID, (current) => ({ ...(current as object), connectedDecoderIds: [...new Set(ids.map((id) => rename(id) as string))] }));
  }
  for (const [oldId, newId] of renames) renamePassings(oldId, newId);
}

/**
 * Takes the simulator parameters of earlier versions (register entry of type "sim" or a
 * "simulation" timing point) into the simulator document – once, while it was never configured.
 */
function migrateSimulatorSettings(
  loadDoc: (id: string) => Doc,
  commit: (docId: string, updater: (current: unknown) => unknown) => Doc,
  legacy: LegacySimulatorSettings | null,
  at: string,
): void {
  if (!legacy) return;
  const current = loadDoc(TIMING_SIMULATOR_DOC_ID).data;
  const doc = isTimingSimulatorDocument(current) ? current : createTimingSimulatorDocument();
  if (doc.updatedAt !== null) return;
  commit(TIMING_SIMULATOR_DOC_ID, () => ({
    ...doc,
    config: {
      ...doc.config,
      transponderIds: legacy.transponderIds,
      passingDelay: normalizeSimulatorPassingDelay(legacy.passingDelay),
      startupDelaySecs: legacy.startupDelaySecs,
    },
    updatedAt: at,
  }));
}

/**
 * The setup chosen in the LiveTracking session becomes the active setup of the timing layer
 * (once, when none is set yet) – it is chosen in the Control Center from now on.
 */
export function migrateActiveSetup(
  loadDoc: (id: string) => Doc,
  commit: (docId: string, updater: (current: unknown) => unknown) => Doc,
): boolean {
  const connection = loadDoc(TIMING_CONNECTION_DOC_ID).data as { activeSetupId?: unknown } | null;
  if (!connection || connection.activeSetupId !== undefined) return false;
  const session = normalizeLiveTrackingSessionDocument(loadDoc(makeLiveTrackingSessionDocId()).data);
  commit(TIMING_CONNECTION_DOC_ID, (current) => ({ ...(current as object), activeSetupId: session?.setupId || null }));
  return true;
}

/** Migrates the LiveTracking session document of older versions; true if it was rewritten. */
export function migrateLegacySession(
  loadDoc: (id: string) => Doc,
  commit: (docId: string, updater: (current: unknown) => unknown) => Doc,
): boolean {
  const id = makeLiveTrackingSessionDocId();
  const current = loadDoc(id).data;
  if (isLiveTrackingSessionDocument(current)) return false;
  const migrated = normalizeLiveTrackingSessionDocument(current);
  if (!migrated) return false;
  commit(id, () => migrated);
  return true;
}
