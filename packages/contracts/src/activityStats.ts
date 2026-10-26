import * as Schema from "effect/Schema";

/**
 * Agent and prompt activity across every thread of an environment, for the
 * Control window's Pulse panel.
 */
export const ActivityStatsInput = Schema.Struct({
  /** ISO instant; prompts before it are not counted. */
  since: Schema.String,
  /** IANA time zone the prompt days are bucketed in. */
  timeZone: Schema.String,
  /** `YYYY-MM-DD` in `timeZone`; threads prompted on or after it count toward `weekThreads`. */
  weekStartDay: Schema.String,
  /** ISO instant the week starts; tool calls count from runs requested on or after it. */
  weekStart: Schema.String,
});
export type ActivityStatsInput = typeof ActivityStatsInput.Type;

export const ActivityStatsAgents = Schema.Struct({
  /** The model id the agents run on, as the provider names it. */
  model: Schema.String,
  /** Provider driver, such as `claudeAgent` or `codex`. */
  provider: Schema.String,
  /** Threads with an active run on this model. */
  threads: Schema.Number,
  /** Active subagents, workflow agents and delegated tasks on this model. */
  subagents: Schema.Number,
});
export type ActivityStatsAgents = typeof ActivityStatsAgents.Type;

export const ActivityStatsDay = Schema.Struct({
  /** `YYYY-MM-DD` in the requested time zone. */
  day: Schema.String,
  count: Schema.Number,
  /** Distinct threads prompted that day. */
  threads: Schema.Number,
});
export type ActivityStatsDay = typeof ActivityStatsDay.Type;

export const ActivityStatsToolCalls = Schema.Struct({
  /** Turn item type, such as `command_execution`, `file_change` or `dynamic_tool`. */
  type: Schema.String,
  /** For `dynamic_tool`, the integration it came from or else the tool's own name. */
  name: Schema.NullOr(Schema.String),
  count: Schema.Number,
});
export type ActivityStatsToolCalls = typeof ActivityStatsToolCalls.Type;

export const ActivityStatsResult = Schema.Struct({
  agents: Schema.Array(ActivityStatsAgents),
  /** Prompts the user sent, per day that had any, oldest first. */
  promptsByDay: Schema.Array(ActivityStatsDay),
  /** Distinct threads prompted on or after `weekStartDay`. */
  weekThreads: Schema.Number,
  /** Tool calls this week, threads and their subagents together, most used first. */
  toolCalls: Schema.Array(ActivityStatsToolCalls),
});
export type ActivityStatsResult = typeof ActivityStatsResult.Type;

export class ActivityStatsError extends Schema.TaggedError<ActivityStatsError>()(
  "ActivityStatsError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
