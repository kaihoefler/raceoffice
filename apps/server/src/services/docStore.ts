import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createInitialLiveTrackingDocument } from "@raceoffice/domain";

/**
 * Generic persisted document envelope used by the server.
 * - `rev` increments on every successful patch write.
 * - `data` is document-specific payload (event, visualization, livetracking, ...).
 */
export type Doc = {
  rev: number;
  data: any; // TODO später sauber typisieren
};

/**
 * Revisioned JSON document store backed by a single SQLite file.
 *
 * Kept isolated from the realtime core (`index.ts`) so the persistence/bootstrap
 * behavior can be exercised against a temp SQLite file without booting
 * websocket/SSE/worker-manager side effects.
 */
export class DocStore {
  private readonly db: Database.Database;
  private readonly getDocStmt: Database.Statement;
  private readonly upsertDocStmt: Database.Statement;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        json TEXT NOT NULL
      );
    `);

    this.getDocStmt = this.db.prepare("SELECT id, rev, json FROM docs WHERE id = ?");
    this.upsertDocStmt = this.db.prepare(`
      INSERT INTO docs (id, rev, json) VALUES (@id, @rev, @json)
      ON CONFLICT(id) DO UPDATE SET rev=excluded.rev, json=excluded.json
    `);
  }

  /**
   * Loads one persisted document by id.
   *
   * Bootstrap behavior (important for first access):
   * - `eventList` gets a dedicated default shape (legacy core document).
   * - known LiveTracking ids are initialized via domain defaults
   *   (`createInitialLiveTrackingDocument`) to keep setup/session/runtime/results
   *   strictly separated from the start.
   * - unknown ids fall back to an empty object for backward compatibility.
   *
   * Design note:
   * - Initialization is persisted immediately so all clients observe the same
   *   revisioned starting state (`rev: 0`).
   */
  loadDoc(id: string): Doc {
    const row = this.getDocStmt.get(id) as { rev: number; json: string } | undefined;

    // Existing document path: return current revision + parsed JSON payload.
    if (row) {
      return { rev: row.rev, data: JSON.parse(row.json) };
    }

    // Missing document path: create and persist initial state once.
    const liveTrackingInitial = createInitialLiveTrackingDocument(id);

    const initial =
      id === "eventList"
        ? { rev: 0, data: { activeEventId: null, events: [] } } // dedicated core default
        : liveTrackingInitial
          ? { rev: 0, data: liveTrackingInitial } // typed LiveTracking default
          : { rev: 0, data: {} }; // generic fallback for unknown ids

    this.saveDoc(id, initial);
    return initial;
  }

  /**
   * Persists one full document snapshot (id + rev + JSON payload).
   *
   * Notes:
   * - Revisions are managed by ws patch flow; this method is intentionally simple.
   * - Writes are idempotent for the same (id, rev, data) tuple.
   */
  saveDoc(id: string, doc: Doc): void {
    this.upsertDocStmt.run({ id, rev: doc.rev, json: JSON.stringify(doc.data) });
  }

  close(): void {
    this.db.close();
  }
}
