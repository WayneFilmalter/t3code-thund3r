import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // User notes, server-wide and outside any project or thread. The body is
  // markdown; created_by_thread_id names the agent thread that wrote a note
  // through MCP so the UI can recognise it, and stays null for user notes.
  yield* sql`
    CREATE TABLE IF NOT EXISTS notes (
      note_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by_thread_id TEXT
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC)
  `;
});
