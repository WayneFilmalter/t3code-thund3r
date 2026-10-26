import {
  ActivityStatsError,
  type ActivityStatsDay,
  type ActivityStatsInput,
  type ActivityStatsResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const AgentRow = Schema.Struct({
  model: Schema.String,
  provider: Schema.String,
  threads: Schema.Number,
  subagents: Schema.Number,
});

const PromptHourRow = Schema.Struct({
  hour: Schema.String,
  threadId: Schema.String,
  count: Schema.Number,
});

/**
 * Folds `YYYY-MM-DDTHH` UTC hours, one row per thread, into days in
 * `timeZone`, oldest first, with the distinct threads prompted each day.
 * `weekThreads` counts each thread once across days on or after
 * `weekStartDay`. Hours are whole, so zones with a half-hour offset place a
 * prompt sent in the first half hour after local midnight on the day before.
 */
export function foldHoursIntoDays(
  hours: ReadonlyArray<{
    readonly hour: string;
    readonly threadId: string;
    readonly count: number;
  }>,
  timeZone: string,
  weekStartDay: string,
): { readonly promptsByDay: ReadonlyArray<ActivityStatsDay>; readonly weekThreads: number } {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map<string, { count: number; threads: Set<string> }>();
  const weekThreads = new Set<string>();
  for (const { hour, threadId, count } of hours) {
    const day = format.format(Date.parse(`${hour}:00:00.000Z`));
    const entry = days.get(day) ?? { count: 0, threads: new Set<string>() };
    entry.count += count;
    entry.threads.add(threadId);
    days.set(day, entry);
    if (day >= weekStartDay) weekThreads.add(threadId);
  }
  return {
    promptsByDay: [...days]
      .map(([day, entry]) => ({ day, count: entry.count, threads: entry.threads.size }))
      .toSorted((left, right) => left.day.localeCompare(right.day)),
    weekThreads: weekThreads.size,
  };
}

/**
 * Agent and prompt activity across the environment's threads, for the
 * Control window's Pulse panel. Reads the V2 projections only, so it costs
 * two indexed queries per call.
 */
export class ActivityStats extends Context.Service<
  ActivityStats,
  {
    readonly read: (
      input: ActivityStatsInput,
    ) => Effect.Effect<ActivityStatsResult, ActivityStatsError>;
  }
>()("t3/orchestration-v2/ActivityStats") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Active means working: queued runs wait behind another run on the same
  // thread. A delegated task's child thread is counted once, as the subagent.
  const agentRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: AgentRow,
    execute: () => sql`
      WITH active_subagents AS (
        SELECT
          COALESCE(
            json_extract(subagents.payload_json, '$.model'),
            json_extract(runs.payload_json, '$.modelSelection.model'),
            'unknown'
          ) AS model,
          subagents.provider AS provider,
          subagents.child_thread_id AS child_thread_id
        FROM orchestration_v2_projection_subagents AS subagents
        LEFT JOIN orchestration_v2_projection_runs AS runs
          ON runs.run_id = subagents.run_id
        WHERE subagents.status IN ('pending', 'running', 'waiting')
      ),
      active_threads AS (
        SELECT DISTINCT
          COALESCE(json_extract(payload_json, '$.modelSelection.model'), 'unknown') AS model,
          provider,
          thread_id
        FROM orchestration_v2_projection_runs
        WHERE status IN ('preparing', 'starting', 'running', 'waiting')
          AND thread_id NOT IN (
            SELECT child_thread_id FROM active_subagents WHERE child_thread_id IS NOT NULL
          )
      ),
      agents AS (
        SELECT model, provider, 1 AS is_thread, 0 AS is_subagent FROM active_threads
        UNION ALL
        SELECT model, provider, 0 AS is_thread, 1 AS is_subagent FROM active_subagents
      )
      SELECT
        model,
        provider,
        SUM(is_thread) AS threads,
        SUM(is_subagent) AS subagents
      FROM agents
      GROUP BY model, provider
      ORDER BY model ASC, provider ASC
    `,
  });

  // Only prompts the user wrote: wakes and agent-sent messages also carry the user role.
  const promptHourRows = SqlSchema.findAll({
    Request: Schema.Struct({ since: Schema.String }),
    Result: PromptHourRow,
    execute: ({ since }) => sql`
      SELECT substr(created_at, 1, 13) AS hour, thread_id AS "threadId", COUNT(*) AS count
      FROM orchestration_v2_projection_messages
      WHERE role = 'user'
        AND created_at >= ${since}
        AND json_extract(payload_json, '$.createdBy') = 'user'
      GROUP BY hour, thread_id
    `,
  });

  const read: ActivityStats["Service"]["read"] = Effect.fn("ActivityStats.read")(function* (input) {
    const since = DateTime.make(input.since);
    if (Option.isNone(since)) {
      return yield* new ActivityStatsError({ detail: "Activity stats need a valid start time." });
    }
    const timeZone = input.timeZone;
    const timeZoneValid = yield* Effect.try(
      () => new Intl.DateTimeFormat("en-CA", { timeZone }),
    ).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!timeZoneValid) {
      return yield* new ActivityStatsError({ detail: `Unknown time zone ${timeZone}.` });
    }
    // One read transaction, so the two queries see the same snapshot.
    const [agents, promptHours] = yield* sql
      .withTransaction(
        Effect.all([
          agentRows(undefined),
          promptHourRows({ since: DateTime.formatIso(since.value) }),
        ]),
      )
      .pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(() => new ActivityStatsError({ detail: "Could not read activity." })),
      );
    return { agents, ...foldHoursIntoDays(promptHours, timeZone, input.weekStartDay) };
  });

  return ActivityStats.of({ read });
});

export const layer = Layer.effect(ActivityStats, make);
