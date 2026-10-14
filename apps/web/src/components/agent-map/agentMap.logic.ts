/**
 * Pure derivation for the Agents map: a thread projection plus its visible items
 * (and any child-thread feeds) become one tree of bubbles.
 *
 * Two steps on purpose. `deriveAgentMapSkeleton` folds the data and is memoized on
 * it; `resolveAgentMapModel` applies the clock (elapsed time, satellite fade, stall)
 * and runs every second while the thread is live, so it must stay cheap.
 */
import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2Run,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import { isOrchestrationV2WorkActive, orchestrationV2RunWorkStartedAt } from "@t3tools/contracts";
import { classifyToolActivity } from "@t3tools/shared/toolActivity";
import * as DateTime from "effect/DateTime";

import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "~/lib/contextWindow";

import type { AgentMapCategory } from "./agentMapColors";
import { agentName } from "./agentMapNames";

export type AgentBubbleStatus =
  | "thinking"
  | "tool"
  | "waiting"
  | "failed"
  | "stalled"
  | "done"
  | "idle";

export interface AgentMapSatellite {
  readonly id: string;
  readonly category: AgentMapCategory;
  readonly status: OrchestrationV2TurnItem["status"];
  readonly opacity: number;
}

export interface AgentMapTask {
  readonly id: string;
  readonly label: string;
  readonly category: AgentMapCategory;
  /** How many tool calls the bubble stands for; drives its size. */
  readonly count: number;
  readonly durationMs: number;
}

export interface AgentBubble {
  readonly id: string;
  readonly name: string;
  readonly kind: "main" | "subagent";
  readonly status: AgentBubbleStatus;
  readonly subtitle: string;
  readonly tokens: number | null;
  readonly elapsedMs: number | null;
  /** Main bubble only: share of the context window in use, null when unknown. */
  readonly contextFraction: number | null;
  /** Main bubble only: the latest event was a compaction, so the ring shows ↻. */
  readonly compacted: boolean;
  /** Model the agent runs on, as the provider reports it. */
  readonly model: string | null;
  /** What the agent was asked to do, untruncated, for the feed. */
  readonly detail: string | null;
  /** Last time anything about this agent changed; the feed sorts by it. */
  readonly lastActivityAtMs: number | null;
  readonly satellites: ReadonlyArray<AgentMapSatellite>;
  readonly tasks: ReadonlyArray<AgentMapTask>;
  readonly children: ReadonlyArray<AgentBubble>;
}

export interface AgentMapModel {
  readonly root: AgentBubble;
  readonly live: boolean;
}

export interface AgentMapFeed {
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
}

/** What a finished subagent keeps once its feed is released. */
export interface SettledChildSnapshot {
  readonly status: AgentBubbleStatus;
  readonly tokens: number | null;
  readonly elapsedMs: number | null;
  readonly tasks: ReadonlyArray<AgentMapTask>;
}

export interface AgentMapInput {
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  /** Live feeds keyed by child thread id. */
  readonly children: ReadonlyMap<ThreadId, AgentMapFeed>;
  /** Released feeds keyed by subagent id. */
  readonly settled: ReadonlyMap<string, SettledChildSnapshot>;
}

export const AGENT_MAP_STALL_MS = 20_000;
export const AGENT_MAP_SATELLITE_FADE_MS = 15_000;
export const AGENT_MAP_SATELLITE_DROP_MS = 20_000;
export const AGENT_MAP_MAX_SATELLITES = 40;
export const AGENT_MAP_MAX_TASKS_PER_RUN = 8;
export const AGENT_MAP_MAX_DOCKED_TASKS = 24;
const SUBTITLE_MAX_LENGTH = 28;

const ACTIVE_RUN_STATUSES = new Set<OrchestrationV2Run["status"]>([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

type Item = OrchestrationV2TurnItem;
type Status = Exclude<AgentBubbleStatus, "stalled">;

interface SatelliteSkeleton {
  readonly id: string;
  readonly category: AgentMapCategory;
  readonly status: Item["status"];
  readonly completedAtMs: number | null;
}

interface BubbleSkeleton {
  readonly id: string;
  readonly name: string;
  readonly kind: AgentBubble["kind"];
  readonly status: Status;
  readonly subtitle: string;
  readonly tokens: number | null;
  readonly contextFraction: number | null;
  readonly compacted: boolean;
  /** Model the agent runs on, as the provider reports it. */
  readonly model: string | null;
  /** What the agent was asked to do, untruncated, for the feed. */
  readonly detail: string | null;
  /** Elapsed time that no longer moves, plus the moment the live part started. */
  readonly settledElapsedMs: number | null;
  readonly liveSinceMs: number | null;
  readonly lastActivityAtMs: number | null;
  readonly satellites: ReadonlyArray<SatelliteSkeleton>;
  readonly tasks: ReadonlyArray<AgentMapTask>;
  readonly children: ReadonlyArray<BubbleSkeleton>;
}

export interface AgentMapSkeleton {
  readonly root: BubbleSkeleton | null;
  readonly live: boolean;
}

const ms = (value: DateTime.Utc | null | undefined): number | null =>
  value == null ? null : DateTime.toEpochMillis(value);

function isToolItem(item: Item): boolean {
  switch (item.type) {
    case "command_execution":
    case "file_change":
    case "file_search":
    case "web_search":
    case "dynamic_tool":
      return true;
    default:
      return false;
  }
}

export function toolItemCategory(item: Item): AgentMapCategory {
  switch (item.type) {
    case "web_search":
      return "web";
    case "file_search":
      return "search";
    case "file_change":
      return "edit";
    case "command_execution":
      return "shell";
    case "dynamic_tool": {
      const classified = classifyToolActivity({
        itemType: "dynamic_tool_call",
        title: item.title ?? undefined,
        data: { toolName: item.toolName ?? undefined, input: item.input },
      });
      switch (classified) {
        case "read":
          return "read";
        case "search":
          return "search";
        case "file_change":
          return "edit";
        case "command":
          return "shell";
        default:
          return "other";
      }
    }
    default:
      return "other";
  }
}

const TASK_LABELS: Record<AgentMapCategory, string> = {
  read: "Research",
  search: "Research",
  edit: "Edit",
  shell: "Shell",
  web: "Web",
  plan: "Plan",
  other: "Tool",
};

/** Read and search share a task bubble; everything else groups by its own category. */
function taskCategory(category: AgentMapCategory): AgentMapCategory {
  return category === "search" ? "read" : category;
}

function itemDurationMs(item: Item): number {
  const start = ms(item.startedAt);
  const end = ms(item.completedAt);
  return start === null || end === null ? 0 : Math.max(0, end - start);
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Consecutive same-category tool calls become one labelled bubble, capped per run. */
export function groupTasks(items: ReadonlyArray<Item>, idPrefix: string): AgentMapTask[] {
  const ordered = [...items].sort((left, right) => left.ordinal - right.ordinal);
  const groups: Array<{ category: AgentMapCategory; count: number; durationMs: number }> = [];
  for (const item of ordered) {
    const category =
      item.type === "proposed_plan"
        ? "plan"
        : isToolItem(item)
          ? taskCategory(toolItemCategory(item))
          : null;
    if (category === null) continue;
    const last = groups.at(-1);
    if (last && last.category === category) {
      last.count += 1;
      last.durationMs += itemDurationMs(item);
    } else {
      groups.push({ category, count: 1, durationMs: itemDurationMs(item) });
    }
  }
  const tasks = groups.map((group, index) => ({
    id: `${idPrefix}:${index}`,
    category: group.category,
    count: group.count,
    label:
      group.category === "plan" || group.count === 1
        ? TASK_LABELS[group.category]
        : `${TASK_LABELS[group.category]} ×${group.count}`,
    durationMs: group.durationMs,
  }));
  if (tasks.length <= AGENT_MAP_MAX_TASKS_PER_RUN) return tasks;
  const kept = tasks.slice(0, AGENT_MAP_MAX_TASKS_PER_RUN - 1);
  const rest = tasks.slice(AGENT_MAP_MAX_TASKS_PER_RUN - 1);
  kept.push({
    id: `${idPrefix}:more`,
    category: "other",
    count: rest.reduce((total, task) => total + task.count, 0),
    label: `+${rest.length} more`,
    durationMs: rest.reduce((total, task) => total + task.durationMs, 0),
  });
  return kept;
}

function isWaitingItem(item: Item): boolean {
  return (
    (item.type === "user_input_request" || item.type === "approval_request") &&
    (item.status === "pending" || item.status === "running" || item.status === "waiting")
  );
}

function isRunningTool(item: Item): boolean {
  return isToolItem(item) && (item.status === "pending" || item.status === "running");
}

function latestBy(items: ReadonlyArray<Item>, predicate: (item: Item) => boolean): Item | null {
  let latest: Item | null = null;
  let latestMs = -1;
  for (const item of items) {
    if (!predicate(item)) continue;
    const updated = DateTime.toEpochMillis(item.updatedAt);
    if (updated >= latestMs) {
      latest = item;
      latestMs = updated;
    }
  }
  return latest;
}

function deriveStatus(items: ReadonlyArray<Item>, live: boolean, failed: boolean): Status {
  if (failed) return "failed";
  if (!live) return "done";
  if (items.some(isWaitingItem)) return "waiting";
  if (items.some(isRunningTool)) return "tool";
  const latestText = latestBy(
    items,
    (item) => item.type === "reasoning" || item.type === "assistant_message",
  );
  if (
    latestText !== null &&
    (latestText.type === "reasoning" || latestText.type === "assistant_message") &&
    (latestText.streaming || latestText.status === "running")
  ) {
    return "thinking";
  }
  return "idle";
}

function deriveSubtitle(status: Status, items: ReadonlyArray<Item>, runCount: number): string {
  switch (status) {
    case "tool": {
      const running = latestBy(items, isRunningTool);
      const title = running?.title ?? (running?.type === "dynamic_tool" ? running.toolName : null);
      return title ? truncate(title, SUBTITLE_MAX_LENGTH) : "Working";
    }
    case "thinking":
      return "Thinking";
    case "waiting":
      return "Waiting for you";
    case "failed":
      return "Failed";
    case "done": {
      const calls = items.filter(isToolItem).length;
      return `${calls} ${calls === 1 ? "call" : "calls"} · ${runCount} ${runCount === 1 ? "turn" : "turns"}`;
    }
    case "idle":
      return "";
  }
}

function deriveSatellites(items: ReadonlyArray<Item>): SatelliteSkeleton[] {
  const tools = items.filter(isToolItem);
  tools.sort((left, right) => right.ordinal - left.ordinal);
  return tools.slice(0, AGENT_MAP_MAX_SATELLITES).map((item) => ({
    id: item.id,
    category: toolItemCategory(item),
    status: item.status,
    completedAtMs: ms(item.completedAt) ?? ms(item.updatedAt),
  }));
}

function lastActivityAt(items: ReadonlyArray<Item>, fallback: number | null): number | null {
  let latest = fallback;
  for (const item of items) {
    const updated = DateTime.toEpochMillis(item.updatedAt);
    if (latest === null || updated > latest) latest = updated;
  }
  return latest;
}

/** Thread-wide token total from the provider thread's snapshot, else summed per turn. */
export function deriveThreadTokens(projection: OrchestrationV2ThreadProjection): number | null {
  const active = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  const usage = active?.contextUsage;
  if (usage) {
    const total =
      usage.totalProcessedTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (total > 0) return total;
    return usage.usedTokens;
  }
  let sum = 0;
  let seen = false;
  for (const turn of projection.providerTurns) {
    const turnUsage = turn.turnTokenUsage;
    if (!turnUsage || turnUsage.usageStatus === "unavailable") continue;
    seen = true;
    sum += (turnUsage.inputTokens ?? 0) + (turnUsage.outputTokens ?? 0);
  }
  return seen ? sum : null;
}

function deriveContext(
  projection: OrchestrationV2ThreadProjection,
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): { contextFraction: number | null; compacted: boolean } {
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  const snapshot = deriveLatestContextWindowSnapshot(
    items,
    latestProviderTurnTokenUsage(projection.providerTurns),
    providerThread,
  );
  const contextFraction =
    snapshot?.usedPercentage == null
      ? null
      : Math.min(1, Math.max(0, snapshot.usedPercentage / 100));
  let latestCompactionMs = -1;
  let latestToolMs = -1;
  for (const { item } of items) {
    if (item.type === "compaction" && item.status === "completed") {
      latestCompactionMs = Math.max(latestCompactionMs, DateTime.toEpochMillis(item.updatedAt));
    } else if (isToolItem(item)) {
      latestToolMs = Math.max(latestToolMs, DateTime.toEpochMillis(item.updatedAt));
    }
  }
  return {
    contextFraction,
    compacted: latestCompactionMs >= 0 && latestCompactionMs > latestToolMs,
  };
}

function isRunSettled(run: OrchestrationV2Run): boolean {
  return !ACTIVE_RUN_STATUSES.has(run.status) && run.status !== "queued";
}

function childIdentity(subagent: OrchestrationV2Subagent): {
  model: string | null;
  detail: string | null;
} {
  const prompt = subagent.prompt.trim().split("\n")[0]?.trim() ?? "";
  return {
    model: subagent.model ?? subagent.modelSelection?.model ?? null,
    detail: subagent.title ?? (prompt.length > 0 ? prompt : null),
  };
}

/** A finished child is named by what it was asked to do; its tasks show as cells. */
function settledChildSubtitle(subagent: OrchestrationV2Subagent, failed: boolean): string {
  if (failed) return "Failed";
  return truncate(subagent.title ?? subagent.progress ?? "Done", SUBTITLE_MAX_LENGTH);
}

function deriveChildFromFeed(
  subagent: OrchestrationV2Subagent,
  feed: AgentMapFeed,
): BubbleSkeleton {
  const live = isOrchestrationV2WorkActive(subagent.status);
  const items = feed.items.map((row) => row.item);
  const status = deriveStatus(items, live, subagent.status === "failed");
  return {
    id: subagent.id,
    name: agentName(subagent.id),
    kind: "subagent",
    status,
    subtitle: live
      ? deriveSubtitle(status, items, feed.projection?.runs.length ?? 1)
      : settledChildSubtitle(subagent, status === "failed"),
    tokens: feed.projection ? deriveThreadTokens(feed.projection) : null,
    contextFraction: null,
    compacted: false,
    ...childIdentity(subagent),
    settledElapsedMs: live ? null : childElapsed(subagent),
    liveSinceMs: live ? ms(subagent.startedAt) : null,
    lastActivityAtMs: lastActivityAt(items, ms(subagent.updatedAt)),
    satellites: live ? deriveSatellites(items) : [],
    tasks: live ? [] : groupTasks(items, subagent.id),
    children: [],
  };
}

function childElapsed(subagent: OrchestrationV2Subagent): number | null {
  const start = ms(subagent.startedAt);
  const end = ms(subagent.completedAt);
  return start === null || end === null ? null : Math.max(0, end - start);
}

function deriveChildFromSnapshot(
  subagent: OrchestrationV2Subagent,
  snapshot: SettledChildSnapshot,
): BubbleSkeleton {
  return {
    id: subagent.id,
    name: agentName(subagent.id),
    kind: "subagent",
    status: snapshot.status === "stalled" ? "done" : snapshot.status,
    subtitle: settledChildSubtitle(subagent, snapshot.status === "failed"),
    tokens: snapshot.tokens,
    contextFraction: null,
    compacted: false,
    ...childIdentity(subagent),
    settledElapsedMs: snapshot.elapsedMs ?? childElapsed(subagent),
    liveSinceMs: null,
    lastActivityAtMs: ms(subagent.updatedAt),
    satellites: [],
    tasks: snapshot.tasks,
    children: [],
  };
}

function deriveChildFromRecord(subagent: OrchestrationV2Subagent): BubbleSkeleton {
  const live = isOrchestrationV2WorkActive(subagent.status);
  const status: Status = subagent.status === "failed" ? "failed" : live ? "idle" : "done";
  return {
    id: subagent.id,
    name: agentName(subagent.id),
    kind: "subagent",
    status,
    subtitle: live
      ? truncate(subagent.progress ?? subagent.title ?? "", SUBTITLE_MAX_LENGTH)
      : settledChildSubtitle(subagent, status === "failed"),
    tokens: null,
    contextFraction: null,
    compacted: false,
    ...childIdentity(subagent),
    settledElapsedMs: live ? null : childElapsed(subagent),
    liveSinceMs: live ? ms(subagent.startedAt) : null,
    lastActivityAtMs: ms(subagent.updatedAt),
    satellites: [],
    tasks: [],
    children: [],
  };
}

export function deriveAgentMapSkeleton(input: AgentMapInput): AgentMapSkeleton {
  const { projection } = input;
  if (projection === null) return { root: null, live: false };

  const activeRun = projection.runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? null;
  const live = activeRun !== null;
  const allItems = input.items.map((row) => row.item);
  const activeItems =
    activeRun === null ? [] : allItems.filter((item) => item.runId === activeRun.id);
  const latestRun = projection.runs.at(-1) ?? null;
  const failed = !live && latestRun?.status === "failed";
  const status = deriveStatus(activeItems, live, failed);

  const settledRuns = projection.runs.filter(isRunSettled);
  const tasks: AgentMapTask[] = [];
  for (const run of settledRuns) {
    tasks.push(
      ...groupTasks(
        allItems.filter((item) => item.runId === run.id),
        run.id,
      ),
    );
  }
  const dockedTasks =
    tasks.length <= AGENT_MAP_MAX_DOCKED_TASKS
      ? tasks
      : [
          {
            id: `${projection.thread.id}:earlier`,
            category: "other" as const,
            count: tasks
              .slice(0, tasks.length - AGENT_MAP_MAX_DOCKED_TASKS + 1)
              .reduce((total, task) => total + task.count, 0),
            label: `+${tasks.length - AGENT_MAP_MAX_DOCKED_TASKS + 1} earlier`,
            durationMs: 0,
          },
          ...tasks.slice(tasks.length - AGENT_MAP_MAX_DOCKED_TASKS + 1),
        ];

  let settledElapsedMs = 0;
  let sawSettled = false;
  for (const run of settledRuns) {
    const end = ms(run.completedAt);
    if (end === null) continue;
    sawSettled = true;
    settledElapsedMs += Math.max(
      0,
      end - DateTime.toEpochMillis(orchestrationV2RunWorkStartedAt(run)),
    );
  }

  const spawnOrder = [...projection.subagents].sort(
    (left, right) =>
      (ms(left.startedAt) ?? ms(left.updatedAt) ?? 0) -
        (ms(right.startedAt) ?? ms(right.updatedAt) ?? 0) || left.id.localeCompare(right.id),
  );
  const children = spawnOrder.map((subagent) => {
    const feed =
      subagent.childThreadId === null ? undefined : input.children.get(subagent.childThreadId);
    if (feed) return deriveChildFromFeed(subagent, feed);
    const snapshot = input.settled.get(subagent.id);
    if (snapshot) return deriveChildFromSnapshot(subagent, snapshot);
    return deriveChildFromRecord(subagent);
  });

  const { contextFraction, compacted } = deriveContext(projection, input.items);
  return {
    live,
    root: {
      id: projection.thread.id,
      name: agentName(projection.thread.id),
      kind: "main",
      model:
        (activeRun ?? latestRun)?.modelSelection.model ?? projection.thread.modelSelection.model,
      detail: projection.thread.title,
      status,
      subtitle: deriveSubtitle(status, live ? activeItems : allItems, projection.runs.length),
      tokens: deriveThreadTokens(projection),
      contextFraction,
      compacted,
      settledElapsedMs: sawSettled ? settledElapsedMs : null,
      liveSinceMs:
        activeRun === null
          ? null
          : DateTime.toEpochMillis(orchestrationV2RunWorkStartedAt(activeRun)),
      lastActivityAtMs: lastActivityAt(
        activeItems,
        activeRun === null ? null : ms(activeRun.startedAt),
      ),
      satellites: live ? deriveSatellites(activeItems) : [],
      tasks: dockedTasks,
      children,
    },
  };
}

function satelliteOpacity(satellite: SatelliteSkeleton, nowMs: number): number | null {
  if (satellite.status === "failed") return 0.9;
  if (satellite.status === "pending" || satellite.status === "running") return 1;
  const age = satellite.completedAtMs === null ? 0 : nowMs - satellite.completedAtMs;
  if (age >= AGENT_MAP_SATELLITE_DROP_MS) return null;
  return Math.min(1, Math.max(0.1, 1 - age / AGENT_MAP_SATELLITE_FADE_MS));
}

function resolveBubble(skeleton: BubbleSkeleton, nowMs: number): AgentBubble {
  const liveElapsed =
    skeleton.liveSinceMs === null ? null : Math.max(0, nowMs - skeleton.liveSinceMs);
  const elapsedMs =
    liveElapsed === null && skeleton.settledElapsedMs === null
      ? null
      : (skeleton.settledElapsedMs ?? 0) + (liveElapsed ?? 0);
  const stalled =
    (skeleton.status === "idle" || skeleton.status === "tool" || skeleton.status === "thinking") &&
    skeleton.lastActivityAtMs !== null &&
    nowMs - skeleton.lastActivityAtMs >= AGENT_MAP_STALL_MS;
  const satellites: AgentMapSatellite[] = [];
  for (const satellite of skeleton.satellites) {
    const opacity = satelliteOpacity(satellite, nowMs);
    if (opacity === null) continue;
    satellites.push({
      id: satellite.id,
      category: satellite.category,
      status: satellite.status,
      opacity,
    });
  }
  return {
    id: skeleton.id,
    name: skeleton.name,
    kind: skeleton.kind,
    status: stalled ? "stalled" : skeleton.status,
    subtitle: stalled ? "No activity" : skeleton.subtitle,
    tokens: skeleton.tokens,
    elapsedMs,
    contextFraction: skeleton.contextFraction,
    compacted: skeleton.compacted,
    model: skeleton.model,
    detail: skeleton.detail,
    lastActivityAtMs: skeleton.lastActivityAtMs,
    satellites,
    tasks: skeleton.tasks,
    children: skeleton.children.map((child) => resolveBubble(child, nowMs)),
  };
}

export function resolveAgentMapModel(
  skeleton: AgentMapSkeleton,
  nowMs: number,
): AgentMapModel | null {
  if (skeleton.root === null) return null;
  return { live: skeleton.live, root: resolveBubble(skeleton.root, nowMs) };
}

export function deriveAgentMapModel(input: AgentMapInput, nowMs: number): AgentMapModel | null {
  return resolveAgentMapModel(deriveAgentMapSkeleton(input), nowMs);
}

/** A finished child read once from its own thread, ready to keep without a feed. */
export function snapshotChildFromFeed(
  subagent: OrchestrationV2Subagent,
  feed: AgentMapFeed,
  nowMs: number,
): SettledChildSnapshot {
  return snapshotSettledChild(resolveBubble(deriveChildFromFeed(subagent, feed), nowMs));
}

/** What the panel keeps for a child once its feed is released. */
export function snapshotSettledChild(bubble: AgentBubble): SettledChildSnapshot {
  return {
    status: bubble.status === "stalled" ? "done" : bubble.status,
    tokens: bubble.tokens,
    elapsedMs: bubble.elapsedMs,
    tasks: bubble.tasks,
  };
}

export interface ChildFeedAssignment {
  /** Subagents that hold a live feed, in spawn order. */
  readonly feeds: ReadonlyArray<OrchestrationV2Subagent>;
  /** Finished subagents still to be read once. */
  readonly toLoad: ReadonlyArray<OrchestrationV2Subagent>;
}

/** Live children take feed slots; finished ones load once unless already snapshotted. */
export function assignChildFeeds(input: {
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly settled: ReadonlyMap<string, SettledChildSnapshot>;
  readonly maxFeeds: number;
}): ChildFeedAssignment {
  const withThread = input.subagents.filter((subagent) => subagent.childThreadId !== null);
  const ordered = [...withThread].sort(
    (left, right) =>
      (ms(left.startedAt) ?? ms(left.updatedAt) ?? 0) -
        (ms(right.startedAt) ?? ms(right.updatedAt) ?? 0) || left.id.localeCompare(right.id),
  );
  const feeds: OrchestrationV2Subagent[] = [];
  const toLoad: OrchestrationV2Subagent[] = [];
  for (const subagent of ordered) {
    if (isOrchestrationV2WorkActive(subagent.status)) {
      if (feeds.length < input.maxFeeds) feeds.push(subagent);
    } else if (!input.settled.has(subagent.id)) {
      toLoad.push(subagent);
    }
  }
  return { feeds, toLoad };
}

const FEED_LIVE = new Set<AgentBubbleStatus>(["tool", "thinking", "waiting", "idle", "stalled"]);

/**
 * The feed under the map: the main agent first, then subagents still working (most
 * recently active first), then finished ones (most recently finished first).
 */
export function orderAgentFeed(model: AgentMapModel): AgentBubble[] {
  const recency = (bubble: AgentBubble) => bubble.lastActivityAtMs ?? 0;
  const children = [...model.root.children].sort((left, right) => {
    const leftLive = FEED_LIVE.has(left.status) ? 0 : 1;
    const rightLive = FEED_LIVE.has(right.status) ? 0 : 1;
    return (
      leftLive - rightLive || recency(right) - recency(left) || left.id.localeCompare(right.id)
    );
  });
  return [model.root, ...children];
}

export const AGENT_STATUS_LABELS: Record<AgentBubbleStatus, string> = {
  tool: "Working",
  thinking: "Thinking",
  waiting: "Needs you",
  idle: "Idle",
  stalled: "Stalled",
  done: "Done",
  failed: "Failed",
};
