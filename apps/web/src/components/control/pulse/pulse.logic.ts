import {
  LINEAR_ISSUE_STATUSES,
  type ActivityStatsAgents,
  type ActivityStatsDay,
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

/** Each of the `days` local days ending today, oldest first, with prompt counts filled in. */
export function promptDays(
  promptsByDay: ReadonlyArray<ActivityStatsDay>,
  now: Date,
  days: number,
): ReadonlyArray<{ readonly day: string; readonly date: Date; readonly count: number }> {
  const counts = new Map(promptsByDay.map((entry) => [entry.day, entry.count]));
  const first = localDaysBack(now, days);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const day = localDayKey(date);
    return { day, date, count: counts.get(day) ?? 0 };
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
