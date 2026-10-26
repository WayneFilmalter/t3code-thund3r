import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Auto Agents are scheduled tasks the Control window owns: a kind that keeps
  // them out of the scheduled-task lists, a saved start delay, and a timer
  // armed apart from the schedule's next run.
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(scheduled_tasks)`;
  const has = (name: string) => columns.some((column) => column.name === name);
  if (!has("kind")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'`;
  }
  if (!has("start_delay_ms")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN start_delay_ms INTEGER`;
  }
  if (!has("timer_at")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN timer_at TEXT`;
  }
});
