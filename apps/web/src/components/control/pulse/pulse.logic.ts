import {
  LINEAR_ISSUE_STATUSES,
  type ActivityStatsAgents,
  type ActivityStatsDay,
  type ActivityStatsToolCalls,
  type LinearBoardMove,
  type LinearIssueStatus,
  type UsageBucket,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { bucketTokens } from "@t3tools/shared/usageMerge";

import { PROVIDER_PRESENTATION } from "../../usage/usageProviders";

/** `YYYY-MM-DD` for a date in the local time zone. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midnight at the start of the local Monday on or before `now`. */
export function localWeekStart(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/** Local midnight `days - 1` days before today, so the window holds `days` days including today. */
export function localDaysBack(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
}

/** Each of the `days` local days ending today, oldest first, with prompt and thread counts filled in. */
export function promptDays(
  promptsByDay: ReadonlyArray<ActivityStatsDay>,
  now: Date,
  days: number,
): ReadonlyArray<{
  readonly day: string;
  readonly date: Date;
  readonly count: number;
  readonly threads: number;
}> {
  const byDay = new Map(promptsByDay.map((entry) => [entry.day, entry]));
  const first = localDaysBack(now, days);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const day = localDayKey(date);
    const entry = byDay.get(day);
    return { day, date, count: entry?.count ?? 0, threads: entry?.threads ?? 0 };
  });
}

const STATUS_BY_STATE_NAME = new Map(
  LINEAR_ISSUE_STATUSES.map((status) => [status.linearState.toLowerCase(), status.id]),
);

/** Board status for a Linear state name, or null for states outside the board such as Done. */
export function boardStatusOf(stateName: string | null): LinearIssueStatus | null {
  return stateName === null ? null : (STATUS_BY_STATE_NAME.get(stateName.toLowerCase()) ?? null);
}

/** For each board status, tickets that moved in minus tickets that moved out. */
export function statusDeltas(
  moves: ReadonlyArray<LinearBoardMove>,
): ReadonlyMap<LinearIssueStatus, number> {
  const deltas = new Map<LinearIssueStatus, number>();
  for (const move of moves) {
    const from = boardStatusOf(move.from);
    const to = boardStatusOf(move.to);
    if (from === to) continue;
    if (from !== null) deltas.set(from, (deltas.get(from) ?? 0) - move.count);
    if (to !== null) deltas.set(to, (deltas.get(to) ?? 0) + move.count);
  }
  return deltas;
}

/** Joins a provider's dated or suffixed model id with the plain one the app runs. */
export function modelKey(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "");
}

const USAGE_KIND_BY_DRIVER = new Map<string, UsageProviderKind>(
  Object.entries(PROVIDER_PRESENTATION).map(([kind, presentation]) => [
    presentation.driverKind,
    kind as UsageProviderKind,
  ]),
);

export interface AgentRow {
  readonly key: string;
  readonly label: string;
  readonly provider: UsageProviderKind | null;
  readonly threads: number;
  readonly subagents: number;
  readonly todayTokens: number;
  readonly weekTokens: number;
}

/**
 * One row per model: agents running on it now, and its tokens today and
 * this week. Buckets are the week's usage, days in the local time zone.
 * Busiest first, then by this week's tokens.
 */
export function agentRows(
  agents: ReadonlyArray<ActivityStatsAgents>,
  buckets: ReadonlyArray<Pick<UsageBucket, "day" | "provider" | "model" | "totals">>,
  today: string,
): ReadonlyArray<AgentRow> {
  const rows = new Map<string, { -readonly [K in keyof AgentRow]: AgentRow[K] }>();
  const rowFor = (model: string, provider: UsageProviderKind | null) => {
    const key = modelKey(model);
    const existing = rows.get(key);
    if (existing !== undefined) {
      existing.provider ??= provider;
      return existing;
    }
    const row = {
      key,
      label: formatModelSlugName(key),
      provider,
      threads: 0,
      subagents: 0,
      todayTokens: 0,
      weekTokens: 0,
    };
    rows.set(key, row);
    return row;
  };
  for (const agent of agents) {
    const row = rowFor(agent.model, USAGE_KIND_BY_DRIVER.get(agent.provider) ?? null);
    row.threads += agent.threads;
    row.subagents += agent.subagents;
  }
  for (const bucket of buckets) {
    const tokens = bucketTokens(bucket);
    if (tokens === 0) continue;
    const row = rowFor(bucket.model, bucket.provider);
    row.weekTokens += tokens;
    if (bucket.day === today) row.todayTokens += tokens;
  }
  return [...rows.values()].toSorted(
    (left, right) =>
      right.threads + right.subagents - (left.threads + left.subagents) ||
      right.weekTokens - left.weekTokens ||
      left.label.localeCompare(right.label),
  );
}

/**
 * Today's tokens against a daily goal, one ring segment per model in row
 * order. Past the goal the ring is full and segments share it by tokens.
 */
export function dailyTokenRing(
  rows: ReadonlyArray<Pick<AgentRow, "key" | "provider" | "todayTokens">>,
  goal: number,
): {
  readonly total: number;
  readonly progress: number;
  readonly segments: ReadonlyArray<{
    readonly key: string;
    readonly provider: UsageProviderKind | null;
    readonly start: number;
    readonly length: number;
  }>;
} {
  const total = rows.reduce((sum, row) => sum + row.todayTokens, 0);
  const scale = Math.max(goal, total);
  let start = 0;
  const segments = [];
  for (const row of rows) {
    if (row.todayTokens === 0) continue;
    const length = row.todayTokens / scale;
    segments.push({ key: row.key, provider: row.provider, start, length });
    start += length;
  }
  return { total, progress: total / goal, segments };
}

const TOOL_TYPE_LABELS: Record<string, string> = {
  command_execution: "Shell",
  file_change: "Edit",
  file_search: "Search",
  web_search: "Web search",
  subagent: "Subagent",
};

/** `Shell`, `Read`, or an MCP server's name for any of its tools: `mcp__linear__get_issue` and `Linear MCP` are both `Linear`. */
export function toolLabel(type: string, name: string | null): string {
  const label = TOOL_TYPE_LABELS[type];
  if (label !== undefined) return label;
  if (name === null) return "Other";
  const server = /^mcp__(.+?)__/.exec(name)?.[1] ?? name.replace(/\s+MCP$/i, "");
  return server.charAt(0).toUpperCase() + server.slice(1);
}

/**
 * The week's tool calls folded into one pill per label, most used first,
 * with everything past `max` pills gathered into `Other`.
 */
export function toolCallPills(
  toolCalls: ReadonlyArray<ActivityStatsToolCalls>,
  max: number,
): {
  readonly total: number;
  readonly pills: ReadonlyArray<{ readonly label: string; readonly count: number }>;
} {
  const byKey = new Map<string, { label: string; count: number }>();
  for (const entry of toolCalls) {
    const label = toolLabel(entry.type, entry.name);
    const key = label.toLowerCase();
    const pill = byKey.get(key) ?? { label, count: 0 };
    pill.count += entry.count;
    byKey.set(key, pill);
  }
  let other = byKey.get("other")?.count ?? 0;
  byKey.delete("other");
  const sorted = [...byKey.values()].toSorted(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label),
  );
  const named = Math.min(sorted.length, other > 0 || sorted.length > max ? max - 1 : max);
  for (const pill of sorted.slice(named)) other += pill.count;
  const pills = sorted.slice(0, named);
  const total = pills.reduce((sum, pill) => sum + pill.count, other);
  return { total, pills: other > 0 ? [...pills, { label: "Other", count: other }] : pills };
}

/** `845`, `12k`, `1.2M`, `3.4B`: short enough for a table cell. */
export function compactTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  const [value, suffix] =
    tokens < 1_000_000
      ? [tokens / 1_000, "k"]
      : tokens < 1_000_000_000
        ? [tokens / 1_000_000, "M"]
        : [tokens / 1_000_000_000, "B"];
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}${suffix}`;
}
