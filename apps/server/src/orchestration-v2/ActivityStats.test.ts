import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ActivityStats from "./ActivityStats.ts";

const layerTest = ActivityStats.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

let ordinal = 0;
const insertRun = (runId: string, threadId: string, status: string, model: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES (${runId}, ${threadId}, ${(ordinal += 1)}, 'claudeAgent', ${status}, '2026-10-26T00:00:00.000Z',
        ${JSON.stringify({ modelSelection: { model } })})
    `,
  );

const insertSubagent = (
  subagentId: string,
  input: { status: string; runId: string; model: string | null; childThreadId?: string },
) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO orchestration_v2_projection_subagents
        (subagent_id, thread_id, run_id, parent_node_id, provider, child_thread_id, origin, status,
         updated_at, payload_json)
      VALUES (${subagentId}, 'parent', ${input.runId}, 'node', 'claudeAgent',
        ${input.childThreadId ?? null}, 'app_owned', ${input.status}, '2026-10-26T00:00:00.000Z',
        ${JSON.stringify({ model: input.model })})
    `,
  );

const insertMessage = (messageId: string, createdAt: string, createdBy: string, role = "user") =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO orchestration_v2_projection_messages
        (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (${messageId}, 'parent', ${role}, 0, ${createdAt}, ${createdAt},
        ${JSON.stringify({ createdBy })})
    `,
  );

it.layer(layerTest)("ActivityStats", (it) => {
  it.effect("counts working agents per model, a delegated child once", () =>
    Effect.gen(function* () {
      yield* insertRun("run-parent", "parent", "running", "claude-opus-5-5");
      yield* insertRun("run-queued", "parent", "queued", "claude-opus-5-5");
      yield* insertRun("run-done", "other", "completed", "claude-opus-5-5");
      yield* insertRun("run-child", "child", "running", "claude-sonnet-5-5");
      yield* insertSubagent("delegated", {
        status: "running",
        runId: "run-parent",
        model: "claude-sonnet-5-5",
        childThreadId: "child",
      });
      // A provider-native subagent without its own model runs on its parent's.
      yield* insertSubagent("native", { status: "waiting", runId: "run-parent", model: null });
      yield* insertSubagent("finished", {
        status: "completed",
        runId: "run-parent",
        model: "claude-haiku-5-5",
      });

      const stats = yield* ActivityStats.ActivityStats;
      const result = yield* stats.read({ since: "2026-10-01T00:00:00.000Z", timeZone: "UTC" });
      assert.deepStrictEqual(result.agents, [
        { model: "claude-opus-5-5", provider: "claudeAgent", threads: 1, subagents: 1 },
        { model: "claude-sonnet-5-5", provider: "claudeAgent", threads: 0, subagents: 1 },
      ]);
    }),
  );

  it.effect("counts the user's own prompts per day in the requested time zone", () =>
    Effect.gen(function* () {
      yield* insertMessage("old", "2026-10-19T12:00:00.000Z", "user");
      yield* insertMessage("a", "2026-10-26T03:10:00.000Z", "user");
      yield* insertMessage("b", "2026-10-26T05:00:00.000Z", "user");
      yield* insertMessage("c", "2026-10-26T05:30:00.000Z", "user");
      yield* insertMessage("wake", "2026-10-26T06:00:00.000Z", "agent");
      yield* insertMessage("reply", "2026-10-26T06:00:00.000Z", "user", "assistant");

      const stats = yield* ActivityStats.ActivityStats;
      const result = yield* stats.read({
        since: "2026-10-20T00:00:00.000Z",
        timeZone: "America/New_York",
      });
      assert.deepStrictEqual(result.promptsByDay, [
        { day: "2026-10-25", count: 1 },
        { day: "2026-10-26", count: 2 },
      ]);
    }),
  );

  it.effect("rejects an unknown time zone", () =>
    Effect.gen(function* () {
      const stats = yield* ActivityStats.ActivityStats;
      const error = yield* Effect.flip(
        stats.read({ since: "2026-10-20T00:00:00.000Z", timeZone: "Mars/Olympus" }),
      );
      assert.include(error.detail, "Mars/Olympus");
    }),
  );
});
