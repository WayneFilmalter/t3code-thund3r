import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The thread a task's last run sent its prompt to, so clients can follow
  // that run's progress and output.
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(scheduled_tasks)`;
  if (!columns.some((column) => column.name === "last_run_thread_id")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_run_thread_id TEXT`;
  }
});
