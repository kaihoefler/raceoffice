import type Database from "better-sqlite3";
import type { TimingPassing, TimingPassingDeleteFilter, TimingPassingInput } from "@raceoffice/domain";

/**
 * Passing store of the timing layer (doc/timing-architecture.md, 5.2).
 *
 * - One SQLite table next to `docs`, not a realtime document: a document is rewritten as a
 *   whole on every change, which does not scale to tens of thousands of passings and allows no
 *   queries by decoder or time.
 * - Append-only, keyed by physical decoder only (no setup, no timing point).
 * - `seq` (AUTOINCREMENT) increases strictly and never reuses values, also after deletes – the
 *   basis for measurement windows and catch-up of consumers.
 * - Inserts are idempotent through the stable passing `id` (repeated uploads after errors).
 * - Time filters (`from`/`to`) use `received_at` (ISO 8601 UTC, compares as text).
 */

export type TimingPassingStoreEvent =
  | { type: "inserted"; passings: TimingPassing[] }
  | { type: "deleted"; deleted: number; filter: TimingPassingDeleteFilter };

export type TimingPassingQuery = {
  sinceSeq?: number;
  limit?: number;
  decoderIds?: string[];
  from?: string;
  to?: string;
};

export type TimingPassingStats = {
  total: number;
  lastSeq: number;
  decoders: Array<{ decoderId: string; count: number; lastReceivedAt: string | null; maxPassingNumber: number | null }>;
};

export const TIMING_PASSING_QUERY_MAX = 5000;

type Row = {
  seq: number;
  id: string;
  decoder_id: string;
  connection_session_id: string | null;
  decoder_time: string;
  time_source: string | null;
  received_at: string;
  passing_number: number | null;
  transponder_id: string;
  transponder_type: string | null;
  signal_strength: number | null;
  hits: number | null;
  low_battery: number | null;
  signal_kind: string | null;
  backend: string;
  raw: string | null;
};

function toPassing(r: Row): TimingPassing {
  return {
    seq: r.seq,
    id: r.id,
    decoderId: r.decoder_id,
    connectionSessionId: r.connection_session_id,
    decoderTime: r.decoder_time,
    timeSource: r.time_source as TimingPassing["timeSource"],
    receivedAt: r.received_at,
    passingNumber: r.passing_number,
    transponderId: r.transponder_id,
    transponderType: r.transponder_type as TimingPassing["transponderType"],
    signalStrength: r.signal_strength,
    hits: r.hits,
    lowBattery: r.low_battery === null ? null : r.low_battery === 1,
    signalKind: r.signal_kind,
    backend: r.backend as TimingPassing["backend"],
    raw: r.raw,
  };
}

/** WHERE clause for decoder/time filters (named parameters). */
function filterSql(filter: { decoderIds?: string[]; from?: string; to?: string }, params: Record<string, unknown>): string[] {
  const where: string[] = [];
  if (filter.decoderIds && filter.decoderIds.length > 0) {
    const names = filter.decoderIds.map((id, i) => {
      params[`d${i}`] = id;
      return `@d${i}`;
    });
    where.push(`decoder_id IN (${names.join(", ")})`);
  }
  if (filter.from) {
    params.from = filter.from;
    where.push("received_at >= @from");
  }
  if (filter.to) {
    params.to = filter.to;
    where.push("received_at < @to");
  }
  return where;
}

export class TimingPassingStore {
  private readonly insertStmt: Database.Statement;
  private readonly existsStmt: Database.Statement;
  private readonly lastSeqStmt: Database.Statement;
  private readonly listeners = new Set<(event: TimingPassingStoreEvent) => void>();

  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS timing_passings (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        decoder_id TEXT NOT NULL,
        connection_session_id TEXT,
        decoder_time TEXT NOT NULL,
        time_source TEXT,
        received_at TEXT NOT NULL,
        passing_number INTEGER,
        transponder_id TEXT NOT NULL,
        transponder_type TEXT,
        signal_strength INTEGER,
        hits INTEGER,
        low_battery INTEGER,
        signal_kind TEXT,
        backend TEXT NOT NULL,
        raw TEXT
      );
      CREATE INDEX IF NOT EXISTS timing_passings_decoder ON timing_passings (decoder_id, seq);
      CREATE INDEX IF NOT EXISTS timing_passings_received ON timing_passings (received_at);
    `);
    this.insertStmt = db.prepare(`
      INSERT OR IGNORE INTO timing_passings (
        id, decoder_id, connection_session_id, decoder_time, time_source, received_at, passing_number,
        transponder_id, transponder_type, signal_strength, hits, low_battery, signal_kind, backend, raw
      ) VALUES (
        @id, @decoderId, @connectionSessionId, @decoderTime, @timeSource, @receivedAt, @passingNumber,
        @transponderId, @transponderType, @signalStrength, @hits, @lowBattery, @signalKind, @backend, @raw
      )
    `);
    this.existsStmt = db.prepare("SELECT 1 FROM timing_passings WHERE id = ?");
    // sqlite_sequence keeps the highest seq ever handed out, also after deleting the rows.
    this.lastSeqStmt = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'timing_passings'");
  }

  subscribe(listener: (event: TimingPassingStoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Inserts new passings; already known ids are skipped. Returns the inserted ones with `seq`. */
  insert(inputs: readonly TimingPassingInput[]): { inserted: TimingPassing[]; duplicates: number } {
    const inserted: TimingPassing[] = [];
    const run = this.db.transaction((items: readonly TimingPassingInput[]) => {
      for (const p of items) {
        // Checked first: INSERT OR IGNORE would still consume a seq and leave gaps.
        if (this.existsStmt.get(p.id)) continue;
        const result = this.insertStmt.run({ ...p, lowBattery: p.lowBattery === null ? null : p.lowBattery ? 1 : 0 });
        if (result.changes === 1) inserted.push({ ...p, seq: Number(result.lastInsertRowid) });
      }
    });
    run(inputs);
    if (inserted.length > 0) this.emit({ type: "inserted", passings: inserted });
    return { inserted, duplicates: inputs.length - inserted.length };
  }

  /** Passings with `seq > sinceSeq` in seq order. */
  query(q: TimingPassingQuery = {}): { passings: TimingPassing[]; hasMore: boolean } {
    const limit = Math.max(1, Math.min(TIMING_PASSING_QUERY_MAX, Math.floor(q.limit ?? 1000)));
    const params: Record<string, unknown> = { sinceSeq: Math.max(0, Math.floor(q.sinceSeq ?? 0)), limit: limit + 1 };
    const where = ["seq > @sinceSeq", ...filterSql(q, params)];
    const rows = this.db
      .prepare(`SELECT * FROM timing_passings WHERE ${where.join(" AND ")} ORDER BY seq LIMIT @limit`)
      .all(params) as Row[];
    const hasMore = rows.length > limit;
    return { passings: rows.slice(0, limit).map(toPassing), hasMore };
  }

  /**
   * Deletes passings matching the filter. An empty filter deletes nothing unless `all: true`
   * (deleting everything must be explicit). Consumers are notified.
   */
  delete(filter: TimingPassingDeleteFilter): number {
    const params: Record<string, unknown> = {};
    const where = filterSql(filter, params);
    if (where.length === 0 && filter.all !== true) return 0;
    const sql = `DELETE FROM timing_passings${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
    const deleted = this.db.prepare(sql).run(params).changes;
    if (deleted > 0) this.emit({ type: "deleted", deleted, filter });
    return deleted;
  }

  /** Assigns the passings of one decoder id to another (decoder id migrations). */
  renameDecoder(oldId: string, newId: string): number {
    return this.db.prepare("UPDATE timing_passings SET decoder_id = ? WHERE decoder_id = ?").run(newId, oldId).changes;
  }

  lastSeq(): number {
    const row = this.lastSeqStmt.get() as { seq: number } | undefined;
    return row?.seq ?? 0;
  }

  stats(): TimingPassingStats {
    const decoders = this.db
      .prepare(
        `SELECT decoder_id AS decoderId, COUNT(*) AS count, MAX(received_at) AS lastReceivedAt,
                MAX(passing_number) AS maxPassingNumber
         FROM timing_passings GROUP BY decoder_id ORDER BY decoder_id`,
      )
      .all() as TimingPassingStats["decoders"];
    return { total: decoders.reduce((n, d) => n + d.count, 0), lastSeq: this.lastSeq(), decoders };
  }

  private emit(event: TimingPassingStoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
