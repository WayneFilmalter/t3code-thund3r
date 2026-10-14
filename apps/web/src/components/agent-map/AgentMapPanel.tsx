/**
 * The Agents tab: the focused thread drawn as a bubble map. This is the only file in
 * the folder that touches hooks. Live subagents stream through a feed (a real server
 * subscription, capped). A finished subagent is read once, kept as a snapshot, and its
 * thread subscription is dropped so nothing stays open for work that is over.
 */
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePanelAnimationSettings } from "~/panelAnimations";
import { useThreadProjection, useThreadVisibleTurnItems } from "~/state/entities";

import {
  assignChildFeeds,
  deriveAgentMapSkeleton,
  resolveAgentMapModel,
  snapshotChildFromFeed,
  type AgentMapFeed,
  type SettledChildSnapshot,
} from "./agentMap.logic";
import { layoutAgentMap } from "./agentMapLayout";
import { AgentMapCanvas } from "./AgentMapCanvas";
import { AgentMapLegend } from "./AgentMapLegend";

export const AGENT_MAP_MAX_CHILD_FEEDS = 10;
const VIEWBOX = { width: 420, height: 300 };
const EMPTY_FEEDS: ReadonlyMap<ThreadId, AgentMapFeed> = new Map();

function useClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  return now;
}

/**
 * One child thread. While the subagent works it streams into the panel as a feed; once
 * the record says it is over, the loaded thread becomes a snapshot and the parent stops
 * rendering this component, which releases the subscription. Renders nothing.
 */
function ChildThread(props: {
  readonly subagent: OrchestrationV2Subagent;
  readonly threadRef: ScopedThreadRef;
  readonly onFeed: (threadId: ThreadId, feed: AgentMapFeed | null) => void;
  readonly onSettled: (subagentId: string, snapshot: SettledChildSnapshot) => void;
}) {
  const thread = useThreadProjection(props.threadRef);
  const items = useThreadVisibleTurnItems(props.threadRef);
  const { onFeed, onSettled, subagent, threadRef } = props;
  const live = isOrchestrationV2WorkActive(subagent.status);
  useEffect(() => {
    if (live) {
      onFeed(threadRef.threadId, { projection: thread?.projection ?? null, items });
      return;
    }
    if (thread === null) return;
    onSettled(
      subagent.id,
      snapshotChildFromFeed(subagent, { projection: thread.projection, items }, Date.now()),
    );
    onFeed(threadRef.threadId, null);
  }, [items, live, onFeed, onSettled, subagent, thread, threadRef.threadId]);
  useEffect(() => () => onFeed(threadRef.threadId, null), [onFeed, threadRef.threadId]);
  return null;
}

function AgentMapForThread({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useThreadProjection(threadRef);
  const items = useThreadVisibleTurnItems(threadRef);
  const projection = thread?.projection ?? null;
  const { active: animated } = usePanelAnimationSettings();

  const [feeds, setFeeds] = useState<ReadonlyMap<ThreadId, AgentMapFeed>>(EMPTY_FEEDS);
  const [settled, setSettled] = useState<ReadonlyMap<string, SettledChildSnapshot>>(
    () => new Map(),
  );

  const onFeed = useCallback((threadId: ThreadId, feed: AgentMapFeed | null) => {
    setFeeds((previous) => {
      if (feed === null && !previous.has(threadId)) return previous;
      const next = new Map(previous);
      if (feed === null) next.delete(threadId);
      else next.set(threadId, feed);
      return next;
    });
  }, []);
  const onSettled = useCallback((subagentId: string, snapshot: SettledChildSnapshot) => {
    setSettled((previous) => {
      if (previous.has(subagentId)) return previous;
      const next = new Map(previous);
      next.set(subagentId, snapshot);
      return next;
    });
  }, []);

  const subagents = projection?.subagents;
  const assignment = useMemo(
    () =>
      assignChildFeeds({
        subagents: subagents ?? [],
        settled,
        maxFeeds: AGENT_MAP_MAX_CHILD_FEEDS,
      }),
    [subagents, settled],
  );
  const mounted = useMemo(
    () => [...assignment.feeds, ...assignment.toLoad],
    [assignment.feeds, assignment.toLoad],
  );

  const skeleton = useMemo(
    () => deriveAgentMapSkeleton({ projection, items, children: feeds, settled }),
    [feeds, items, projection, settled],
  );
  const now = useClock(skeleton.live);
  const model = useMemo(() => resolveAgentMapModel(skeleton, now), [now, skeleton]);
  const layout = useMemo(() => (model === null ? null : layoutAgentMap(model, VIEWBOX)), [model]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mounted.map((subagent) => (
        <ChildThread
          key={subagent.id}
          subagent={subagent}
          threadRef={scopeThreadRef(threadRef.environmentId, subagent.childThreadId!)}
          onFeed={onFeed}
          onSettled={onSettled}
        />
      ))}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 p-2">
          {layout === null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Start a turn to see agents here.
            </div>
          ) : (
            <AgentMapCanvas layout={layout} live={model?.live ?? false} animated={animated} />
          )}
        </div>
        <AgentMapLegend />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border text-xs text-muted-foreground">
        Coming soon
      </div>
    </div>
  );
}

export function AgentMapPanel({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  if (threadRef === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open a thread to see its agents.
      </div>
    );
  }
  return <AgentMapForThread key={scopedThreadKey(threadRef)} threadRef={threadRef} />;
}
