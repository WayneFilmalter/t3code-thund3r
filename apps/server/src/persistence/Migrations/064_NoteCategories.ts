import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Named, coloured groups the Notes list folds notes under. A note points at
  // at most one; deleting a category clears that pointer rather than the note.
  yield* sql`
    CREATE TABLE IF NOT EXISTS note_categories (
      category_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(notes)`;
  if (!columns.some((column) => column.name === "category_id")) {
    yield* sql`ALTER TABLE notes ADD COLUMN category_id TEXT`;
  }
});
