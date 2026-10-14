import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2Run,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_MAP_MAX_DOCKED_TASKS,
  AGENT_MAP_MAX_TASKS_PER_RUN,
  assignChildFeeds,
  deriveAgentMapModel,
  groupTasks,
  orderAgentFeed,
  snapshotSettledChild,
} from "./agentMap.logic";
import { agentName } from "./agentMapNames";

const T0 = Date.parse("2026-06-20T00:00:00.000Z");
const at = (offsetMs: number) => DateTime.makeUnsafe(new Date(T0 + offsetMs).toISOString());

type ItemOverrides = Omit<Partial<OrchestrationV2TurnItem>, "id"> & {
  id: string;
  type: OrchestrationV2TurnItem["type"];
};

let ordinal = 0;
function item(overrides: ItemOverrides & Record<string, unknown>): OrchestrationV2TurnItem {
  ordinal += 1;
  return {
    threadId: "thread-1",
    runId: "run-1",
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: null,
    startedAt: at(0),
    completedAt: at(1_000),
    updatedAt: at(1_000),
    ...overrides,
  } as never;
}

const tool = (id: string, toolName: string, extra: Record<string, unknown> = {}) =>
  item({ id, type: "dynamic_tool", toolName, input: {}, title: toolName, ...extra });
const shell = (id: string, extra: Record<string, unknown> = {}) =>
  item({ id, type: "command_execution", input: "ls", ...extra });
const edit = (id: string, extra: Record<string, unknown> = {}) =>
  item({ id, type: "file_change", fileName: "a.ts", ...extra });
const web = (id: string) => item({ id, type: "web_search" });

function row(turnItem: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem {
  return {
    position: turnItem.ordinal,
    visibility: "local",
    sourceThreadId: turnItem.threadId,
    sourceItemId: turnItem.id,
    item: turnItem,
  };
}

function run(
  id: string,
  status: OrchestrationV2Run["status"],
  extra: Partial<OrchestrationV2Run> = {},
) {
  return {
    id,
    threadId: "thread-1",
    ordinal: 1,
    status,
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    requestedAt: at(0),
    startedAt: at(0),
    completedAt: status === "completed" || status === "failed" ? at(60_000) : null,
    ...extra,
  } as never as OrchestrationV2Run;
}

function subagent(
  overrides: Omit<Partial<OrchestrationV2Subagent>, "id"> & { id: string },
): OrchestrationV2Subagent {
  return {
    threadId: "thread-1",
    runId: "run-1",
    parentNodeId: "node-1",
    origin: "app_owned",
    createdBy: "agent",
    driver: "codex",
    providerInstanceId: "codex",
    providerThreadId: null,
    childThreadId: `child-${overrides.id}`,
    nativeTaskRef: null,
    prompt: "Do the thing",
    title: "Worker",
    model: null,
    status: "running",
    result: null,
    startedAt: at(0),
    completedAt: null,
    updatedAt: at(1_000),
    ...overrides,
  } as never;
}

function projection(overrides: {
  runs?: ReadonlyArray<OrchestrationV2Run>;
  subagents?: ReadonlyArray<OrchestrationV2Subagent>;
  providerTurns?: ReadonlyArray<unknown>;
  providerThreads?: ReadonlyArray<unknown>;
  threadId?: string;
}): OrchestrationV2ThreadProjection {
  return {
    thread: {
      id: overrides.threadId ?? "thread-1",
      title: "Thread",
      activeProviderThreadId: "pt-1",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    },
    runs: overrides.runs ?? [run("run-1", "running")],
    subagents: overrides.subagents ?? [],
    providerTurns: overrides.providerTurns ?? [],
    providerThreads: overrides.providerThreads ?? [],
  } as never;
}

function derive(
  input: {
    projection: OrchestrationV2ThreadProjection | null;
    items?: ReadonlyArray<OrchestrationV2TurnItem>;
    children?: ReadonlyMap<
      string,
      {
        projection: OrchestrationV2ThreadProjection | null;
        items: ReadonlyArray<OrchestrationV2TurnItem>;
      }
    >;
    settled?: ReadonlyMap<string, ReturnType<typeof snapshotSettledChild>>;
  },
  nowMs = T0 + 5_000,
) {
  const children = new Map<
    string,
    {
      projection: OrchestrationV2ThreadProjection | null;
      items: OrchestrationV2ProjectedTurnItem[];
    }
  >();
  for (const [key, feed] of input.children ?? []) {
    children.set(key, { projection: feed.projection, items: feed.items.map(row) });
  }
  return deriveAgentMapModel(
    {
      projection: input.projection,
      items: (input.items ?? []).map(row),
      children: children as never,
      settled: input.settled ?? new Map(),
    },
    nowMs,
  );
}

describe("deriveAgentMapModel status", () => {
  it("returns null without a projection", () => {
    expect(derive({ projection: null })).toBeNull();
  });

  it("ranks failed above waiting above tool above thinking", () => {
    const items = [
      item({ id: "ask", type: "user_input_request", status: "pending", questions: [] }),
      tool("read", "Read", { status: "running" }),
      item({ id: "think", type: "reasoning", status: "running", streaming: true, text: "" }),
    ];
    expect(derive({ projection: projection({}), items })?.root.status).toBe("waiting");
    expect(derive({ projection: projection({}), items: items.slice(1) })?.root.status).toBe("tool");
    expect(derive({ projection: projection({}), items: items.slice(2) })?.root.status).toBe(
      "thinking",
    );
    expect(
      derive({ projection: projection({ runs: [run("run-1", "failed")] }), items })?.root.status,
    ).toBe("failed");
  });

  it("is idle while live and quiet, done without an active run", () => {
    expect(derive({ projection: projection({}) })?.root.status).toBe("idle");
    const done = derive({ projection: projection({ runs: [run("run-1", "completed")] }) });
    expect(done?.root.status).toBe("done");
    expect(done?.live).toBe(false);
  });

  it("stalls after 20s of silence but never while waiting", () => {
    const items = [tool("read", "Read", { status: "running", updatedAt: at(0) })];
    expect(derive({ projection: projection({}), items }, T0 + 19_999)?.root.status).toBe("tool");
    const stalled = derive({ projection: projection({}), items }, T0 + 20_000);
    expect(stalled?.root.status).toBe("stalled");
    expect(stalled?.root.subtitle).toBe("No activity");
    const waiting = [
      item({
        id: "ask",
        type: "user_input_request",
        status: "pending",
        questions: [],
        updatedAt: at(0),
      }),
    ];
    expect(derive({ projection: projection({}), items: waiting }, T0 + 60_000)?.root.status).toBe(
      "waiting",
    );
  });

  it("uses the latest running tool's title as the subtitle, truncated", () => {
    const items = [
      tool("old", "Read", { status: "running", updatedAt: at(100), title: "Read old.ts" }),
      tool("new", "Grep", {
        status: "running",
        updatedAt: at(200),
        title: "Searching for a very long pattern across the whole repo",
      }),
    ];
    const subtitle = derive({ projection: projection({}), items })?.root.subtitle;
    expect(subtitle).toBe("Searching for a very long p…");
    expect(subtitle?.length).toBe(28);
  });
});

describe("tasks and satellites", () => {
  it("groups consecutive calls and merges read with search", () => {
    const tasks = groupTasks(
      [
        tool("a", "Read"),
        tool("b", "Grep"),
        tool("c", "Read"),
        edit("d"),
        edit("e"),
        shell("f"),
        web("g"),
      ],
      "run-1",
    );
    expect(tasks.map((task) => task.label)).toEqual(["Research ×3", "Edit ×2", "Shell", "Web"]);
    expect(tasks.map((task) => task.category)).toEqual(["read", "edit", "shell", "web"]);
    expect(tasks.map((task) => task.count)).toEqual([3, 2, 1, 1]);
  });

  it("folds tasks beyond the per-run cap into one more bubble", () => {
    const items: OrchestrationV2TurnItem[] = [];
    for (let index = 0; index < 12; index += 1) {
      items.push(index % 2 === 0 ? tool(`r${index}`, "Read") : edit(`e${index}`));
    }
    const tasks = groupTasks(items, "run-1");
    expect(tasks).toHaveLength(AGENT_MAP_MAX_TASKS_PER_RUN);
    expect(tasks.at(-1)?.label).toBe("+5 more");
  });

  it("docks tasks from settled runs while a new run is live, capped with an earlier chip", () => {
    const runs = [run("run-1", "completed"), run("run-2", "running", { ordinal: 2 })];
    const items = [
      tool("a", "Read"),
      edit("b"),
      tool("c", "Read", { runId: "run-2", status: "running" }),
    ];
    const model = derive({ projection: projection({ runs }), items });
    expect(model?.root.tasks.map((task) => task.label)).toEqual(["Research", "Edit"]);
    expect(model?.root.satellites.map((satellite) => satellite.id)).toEqual(["c"]);

    const manyRuns: OrchestrationV2Run[] = [];
    const manyItems: OrchestrationV2TurnItem[] = [];
    for (let index = 0; index < 15; index += 1) {
      manyRuns.push(run(`run-${index}`, "completed", { ordinal: index + 1 }));
      manyItems.push(
        tool(`r${index}`, "Read", { runId: `run-${index}` }),
        edit(`e${index}`, { runId: `run-${index}` }),
      );
    }
    const docked = derive({ projection: projection({ runs: manyRuns }), items: manyItems })?.root
      .tasks;
    expect(docked).toHaveLength(AGENT_MAP_MAX_DOCKED_TASKS);
    expect(docked?.[0]?.label).toBe("+7 earlier");
  });

  it("fades completed satellites and drops them at 20s; failed ones stay", () => {
    const items = [
      tool("done", "Read", { completedAt: at(0), updatedAt: at(0) }),
      tool("bad", "Read", { status: "failed", completedAt: at(0), updatedAt: at(0) }),
    ];
    const opacityAt = (offset: number) =>
      derive({ projection: projection({}), items }, T0 + offset)?.root.satellites.map((s) => [
        s.id,
        s.opacity,
      ]);
    expect(opacityAt(0)).toEqual([
      ["bad", 0.9],
      ["done", 1],
    ]);
    expect(opacityAt(7_500)).toEqual([
      ["bad", 0.9],
      ["done", 0.5],
    ]);
    expect(opacityAt(14_000)).toEqual([
      ["bad", 0.9],
      ["done", 0.1],
    ]);
    expect(opacityAt(20_000)).toEqual([["bad", 0.9]]);
  });

  it("shows no satellites once the thread is done", () => {
    const model = derive({
      projection: projection({ runs: [run("run-1", "completed")] }),
      items: [tool("a", "Read", { completedAt: at(0), updatedAt: at(0) })],
    });
    expect(model?.root.satellites).toEqual([]);
    expect(model?.root.subtitle).toBe("1 call · 1 turn");
  });
});

describe("names, tokens and context", () => {
  it("gives the same id the same name and different ids their own", () => {
    expect(agentName("thread-1")).toBe(agentName("thread-1"));
    const names = new Set(Array.from({ length: 200 }, (_, index) => agentName(`id-${index}`)));
    expect(names.size).toBeGreaterThan(20);
  });

  it("reads context usage from live turn usage and flags a fresh compaction", () => {
    const providerTurns = [
      {
        tokenUsage: {
          usedTokens: 50_000,
          maxTokens: 200_000,
          updatedAt: "2026-06-20T00:00:01.000Z",
        },
        turnTokenUsage: undefined,
      },
    ];
    const compaction = item({
      id: "compact",
      type: "compaction",
      driver: null,
      updatedAt: at(2_000),
    });
    const before = derive({
      projection: projection({ providerTurns }),
      items: [tool("a", "Read", { updatedAt: at(1_000) }), compaction],
    });
    expect(before?.root.contextFraction).toBeCloseTo(0.25);
    expect(before?.root.compacted).toBe(true);
    const after = derive({
      projection: projection({ providerTurns }),
      items: [compaction, tool("b", "Read", { updatedAt: at(3_000) })],
    });
    expect(after?.root.compacted).toBe(false);
  });

  it("sums per-turn usage when the provider thread has no snapshot", () => {
    const providerTurns = [
      {
        turnTokenUsage: {
          usageScope: "main_agent",
          usageStatus: "complete",
          inputTokens: 100,
          outputTokens: 20,
          hasSubagents: false,
        },
      },
      {
        turnTokenUsage: {
          usageScope: "main_agent",
          usageStatus: "complete",
          inputTokens: 10,
          outputTokens: 5,
          hasSubagents: false,
        },
      },
    ];
    expect(derive({ projection: projection({ providerTurns }) })?.root.tokens).toBe(135);
    expect(derive({ projection: projection({}) })?.root.tokens).toBeNull();
    expect(derive({ projection: projection({}) })?.root.contextFraction).toBeNull();
  });

  it("sums elapsed time over settled runs plus the live one", () => {
    const runs = [
      run("run-1", "completed", { startedAt: at(0), completedAt: at(30_000) }),
      run("run-2", "running", { ordinal: 2, startedAt: at(40_000), completedAt: null }),
    ];
    expect(derive({ projection: projection({ runs }) }, T0 + 50_000)?.root.elapsedMs).toBe(40_000);
  });
});

describe("children", () => {
  it("builds a terminal child from its feed with tasks and no satellites", () => {
    const child = subagent({ id: "sub-1", status: "completed", completedAt: at(9_000) });
    const feed = {
      projection: projection({ runs: [run("child-run", "completed")], threadId: "child-sub-1" }),
      items: [
        tool("a", "Read", { threadId: "child-sub-1", runId: "child-run" }),
        edit("b", { threadId: "child-sub-1", runId: "child-run" }),
      ],
    };
    const model = derive({
      projection: projection({ subagents: [child] }),
      children: new Map([["child-sub-1", feed]]),
    });
    const bubble = model?.root.children[0];
    expect(bubble?.name).toBe(agentName("sub-1"));
    expect(bubble?.status).toBe("done");
    expect(bubble?.tasks.map((task) => task.label)).toEqual(["Research", "Edit"]);
    expect(bubble?.satellites).toEqual([]);
    expect(bubble?.elapsedMs).toBe(9_000);
  });

  it("shows satellites for a live child and reports its running tool", () => {
    const child = subagent({ id: "sub-1" });
    const feed = {
      projection: projection({ threadId: "child-sub-1" }),
      items: [tool("a", "Grep", { runId: "run-1", status: "running", title: "Grep auth" })],
    };
    const bubble = derive({
      projection: projection({ subagents: [child] }),
      children: new Map([["child-sub-1", feed]]),
    })?.root.children[0];
    expect(bubble?.status).toBe("tool");
    expect(bubble?.subtitle).toBe("Grep auth");
    expect(bubble?.satellites.map((satellite) => satellite.category)).toEqual(["search"]);
  });

  it("prefers a live feed over a snapshot and a snapshot over the bare record", () => {
    const child = subagent({ id: "sub-1", status: "completed", completedAt: at(4_000) });
    const snapshot = snapshotSettledChild({
      id: "sub-1",
      name: "x",
      kind: "subagent",
      status: "done",
      subtitle: "",
      tokens: 777,
      elapsedMs: 4_000,
      contextFraction: null,
      compacted: false,
      model: null,
      detail: null,
      effort: null,
      toolCount: null,
      preview: null,
      lastActivityAtMs: null,
      satellites: [],
      tasks: [{ id: "t", label: "Shell ×2", category: "shell", count: 2, durationMs: 10 }],
      children: [],
    });
    const bare = derive({ projection: projection({ subagents: [child] }) })?.root.children[0];
    expect(bare?.tokens).toBeNull();
    expect(bare?.tasks).toEqual([]);
    expect(bare?.status).toBe("done");
    expect(bare?.subtitle).toBe("Worker");

    const fromSnapshot = derive({
      projection: projection({ subagents: [child] }),
      settled: new Map([["sub-1", snapshot]]),
    })?.root.children[0];
    expect(fromSnapshot?.tokens).toBe(777);
    expect(fromSnapshot?.tasks.map((task) => task.label)).toEqual(["Shell ×2"]);

    const fromFeed = derive({
      projection: projection({ subagents: [child] }),
      settled: new Map([["sub-1", snapshot]]),
      children: new Map([
        [
          "child-sub-1",
          {
            projection: projection({ runs: [run("r", "completed")], threadId: "child-sub-1" }),
            items: [edit("e", { runId: "r" })],
          },
        ],
      ]),
    })?.root.children[0];
    expect(fromFeed?.tasks.map((task) => task.label)).toEqual(["Edit"]);
  });
});

describe("assignChildFeeds", () => {
  it("gives live children slots in spawn order and lists settled ones to load once", () => {
    const settled = new Map([
      [
        "old",
        snapshotSettledChild({
          id: "old",
          name: "",
          kind: "subagent",
          status: "done",
          subtitle: "",
          tokens: null,
          elapsedMs: null,
          contextFraction: null,
          compacted: false,
          model: null,
          detail: null,
          effort: null,
          toolCount: null,
          preview: null,
          lastActivityAtMs: null,
          satellites: [],
          tasks: [],
          children: [],
        }),
      ],
    ]);
    const result = assignChildFeeds({
      subagents: [
        subagent({ id: "late", startedAt: at(5_000) }),
        subagent({ id: "old", status: "completed" }),
        subagent({ id: "fresh", status: "completed", startedAt: at(1_000) }),
        subagent({ id: "early", startedAt: at(2_000) }),
        subagent({ id: "no-thread", childThreadId: null }),
      ],
      settled,
      maxFeeds: 10,
    });
    expect(result.feeds.map((agent) => agent.id)).toEqual(["early", "late"]);
    expect(result.toLoad.map((agent) => agent.id)).toEqual(["fresh"]);
  });

  it("caps live feeds", () => {
    const subagents = Array.from({ length: 12 }, (_, index) =>
      subagent({ id: `s${index}`, startedAt: at(index) }),
    );
    expect(assignChildFeeds({ subagents, settled: new Map(), maxFeeds: 10 }).feeds).toHaveLength(
      10,
    );
  });
});

describe("feed", () => {
  it("names the main agent's model and thread title, and each child's model and task", () => {
    const base = projection({
      subagents: [
        subagent({ id: "titled", model: "gpt-5.4", title: "Explore auth flow" }),
        subagent({
          id: "untitled",
          title: null,
          prompt: "Read the tests\nthen report",
          model: null,
        }),
      ],
    });
    const withRun = {
      ...base,
      thread: {
        ...base.thread,
        title: "Fix login",
        modelSelection: { instanceId: "claude", model: "fallback" },
      },
      runs: [
        { ...base.runs[0]!, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" } },
      ],
    } as never as OrchestrationV2ThreadProjection;
    const model = derive({ projection: withRun })!;
    expect(model.root).toMatchObject({ model: "claude-opus-5-5", detail: "Fix login" });
    const [titled, untitled] = model.root.children;
    expect(titled).toMatchObject({ model: "gpt-5.4", detail: "Explore auth flow" });
    expect(untitled).toMatchObject({ model: null, detail: "Read the tests" });
  });

  it("carries effort, tool counts, and a result or progress preview", () => {
    const finished = subagent({
      id: "done",
      status: "completed",
      completedAt: at(9_000),
      title: "Subagent: Explore auth flow",
      result: "Found   three\nentry points",
      modelSelection: {
        instanceId: "claude",
        model: "claude-opus-5-5",
        options: [{ id: "effort", value: "medium" }],
      } as never,
    });
    const working = subagent({
      id: "live",
      progress: "Reading routes",
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "high" }],
      } as never,
    });
    const feed = {
      projection: projection({ runs: [run("r", "completed")], threadId: "child-done" }),
      items: [
        tool("a", "Read", { runId: "r" }),
        edit("b", { runId: "r" }),
        shell("c", { runId: "r" }),
      ],
    };
    const model = derive({
      projection: projection({ subagents: [finished, working] }),
      items: [
        tool("main-read", "Read"),
        item({
          id: "say",
          type: "assistant_message",
          text: "  All   done here ",
          streaming: false,
        }),
      ],
      children: new Map([["child-done", feed]]),
    })!;
    expect(model.root).toMatchObject({ toolCount: 1, preview: "All done here" });
    const [done, live] = model.root.children;
    expect(done).toMatchObject({
      detail: "Explore auth flow",
      effort: "medium",
      toolCount: 3,
      preview: "Found three entry points",
    });
    expect(live).toMatchObject({ effort: "high", toolCount: null, preview: "Reading routes" });
  });

  it("lists the main agent, then working subagents, then finished ones, newest first", () => {
    const model = derive({
      projection: projection({
        subagents: [
          subagent({
            id: "done-old",
            status: "completed",
            updatedAt: at(1_000),
            completedAt: at(1_000),
          }),
          subagent({ id: "live-old", updatedAt: at(2_000) }),
          subagent({
            id: "done-new",
            status: "completed",
            updatedAt: at(5_000),
            completedAt: at(5_000),
          }),
          subagent({ id: "live-new", updatedAt: at(4_000) }),
        ],
      }),
    })!;
    expect(orderAgentFeed(model).map((bubble) => bubble.id)).toEqual([
      "thread-1",
      "live-new",
      "live-old",
      "done-new",
      "done-old",
    ]);
  });
});
