import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type LinearTicket,
  type OrchestrationV2Run,
  type ScheduledTask,
  type SlackFeedEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";

import * as LinearTickets from "../linear/LinearTickets.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackService from "./SlackService.ts";

type Listener = (event: Socket.WebSocketEvent) => void;

/** One Socket Mode connection: records acks and lets the test deliver frames. */
const makeFakeSocket = () => {
  const listeners = new Map<string, Set<Listener>>();
  const sent: string[] = [];
  const closed = Deferred.makeUnsafe<void>();
  const ws: Socket.WebSocketLike = {
    readyState: 1,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    close: () => Deferred.doneUnsafe(closed, Effect.void),
    send: (data) => sent.push(typeof data === "string" ? data : new TextDecoder().decode(data)),
  };
  const deliver = (frame: unknown) =>
    listeners.get("message")?.forEach((listener) => listener({ data: JSON.stringify(frame) }));
  return { ws, sent, closed, deliver };
};

/**
 * Slack's Web API, answering each method the service calls. Command answers
 * and #priorities replies go to `answers`; `history` is #priorities' history.
 */
const fakeSlackApi = (
  posted: Array<URLSearchParams>,
  commands?: {
    answers: Queue.Queue<string>;
    connected: Deferred.Deferred<void>;
    history?: ReadonlyArray<unknown>;
  },
) =>
  HttpClient.make((request) => {
    if (request.url.startsWith(RESPONSE_URL)) {
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      if (commands !== undefined) Queue.offerUnsafe(commands.answers, JSON.parse(body).text);
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("ok")));
    }
    const method = new URL(request.url).pathname.split("/").pop();
    const params = new URLSearchParams(
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
    );
    const body = (() => {
      switch (method) {
        case "auth.test":
          return {
            ok: true,
            user_id: "USELF",
            user: "me",
            team: "Steeple",
            url: "https://s.slack.com/",
          };
        case "users.info":
          return { ok: true, user: { name: params.get("user"), profile: { display_name: "Ana" } } };
        case "conversations.info":
          return { ok: true, channel: { name: "general" } };
        case "apps.connections.open":
          return { ok: true, url: "wss://socket.slack.test" };
        case "search.messages":
          // The socket is reading by now, so delivered frames are not lost.
          if (commands !== undefined) Deferred.doneUnsafe(commands.connected, Effect.void);
          return {
            ok: true,
            messages: {
              matches: [{ channel: { id: "C1" }, user: "U1", text: "backfilled", ts: "1.000100" }],
              paging: { pages: 1 },
            },
          };
        case "users.conversations":
          return { ok: true, channels: [{ id: "CPRI", name: "priorities" }] };
        case "conversations.history":
          return { ok: true, messages: commands?.history ?? [] };
        case "chat.postMessage":
          params.set("token", request.headers.authorization ?? "");
          posted.push(params);
          if (commands !== undefined) Queue.offerUnsafe(commands.answers, params.get("text") ?? "");
          return { ok: true, ts: "9.000900" };
        default:
          return { ok: false, error: "unknown_method" };
      }
    })();
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)));
  });

const RESPONSE_URL = "https://hooks.slack.test/commands/1";

const ticket = (identifier: string, title: string, priority: LinearTicket["priority"]) =>
  ({
    id: identifier,
    identifier,
    title,
    url: `https://linear.app/acme/issue/${identifier}`,
    priority,
    estimate: null,
    stateName: "Todo",
    branchName: null,
    stateType: "unstarted",
    stateColor: "#000000",
    pullRequestUrl: null,
    pullRequestState: null,
    latestOthersCommentAt: null,
    mentionsViewer: false,
  }) satisfies LinearTicket;

/** Linear knows ENG-1 and ENG-2 only. */
const fakeLinear = LinearTickets.LinearTickets.of({
  getTickets: ({ identifiers }) => {
    const known = [
      ticket("ENG-1", "Checkout <times out>", "low"),
      ticket("ENG-2", "Onboarding", "urgent"),
    ];
    return Effect.succeed({
      tickets: known.filter((t) => identifiers.includes(t.identifier)),
      missing: identifiers.filter((id) => !known.some((t) => t.identifier === id)),
    });
  },
  searchTickets: () => Effect.die("unused"),
  getTicketDetail: () => Effect.die("unused"),
  getBoardStats: () => Effect.die("unused"),
  getRecentComments: () => Effect.die("unused"),
  createComment: () => Effect.die("unused"),
});

/** The Auto Agent `/eod` runs; the title matches whatever its case. */
const eodAgent: ScheduledTask = {
  id: ScheduledTaskId.make("task-eod"),
  title: "eod",
  prompt: "List the tickets I worked on today",
  enabled: true,
  schedule: { type: "interval", everyMs: 86_400_000 },
  projectId: ProjectId.make("project"),
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
  kind: "auto_agent",
};
const eodThreadId = ThreadId.make("thread-eod");
const eodRun = { id: RunId.make("run-eod"), status: "completed" } as OrchestrationV2Run;

const fakeScheduledTasks = Layer.mock(ScheduledTaskService.ScheduledTaskService)({
  list: () => Effect.succeed({ tasks: [{ ...eodAgent, kind: "task", title: "EOD" }, eodAgent] }),
  runNow: ({ id }) =>
    Effect.succeed({
      task: { ...eodAgent, id, lastRunStatus: "succeeded", lastRunThreadId: eodThreadId },
    }),
});

/** The run settles at once; its last assistant message is the answer. */
const fakeThreads = Layer.mock(ThreadManagementService.ThreadManagementService)({
  waitForThread: ({ threadId }) => Effect.succeed({ threadId, run: eodRun, timedOut: false }),
  getThreadRecords: (threadId) =>
    Effect.succeed({
      messages: [
        {
          id: MessageId.make("reply-eod"),
          threadId,
          runId: eodRun.id,
          role: "assistant",
          text: "*Urgent*\nENG-2 - Onboarding",
          updatedAt: DateTime.makeUnsafe("2026-10-26T17:00:00.000Z"),
        },
      ],
      turnItems: [],
    } as never),
});

const makeLayer = (
  socket: ReturnType<typeof makeFakeSocket>,
  posted: Array<URLSearchParams>,
  slack: { mutedChannels?: Record<string, string>; priorityCursor?: string } = {},
  commands?: Parameters<typeof fakeSlackApi>[1],
) =>
  SlackService.layer.pipe(
    Layer.provideMerge(
      ServerSettings.ServerSettingsService.layerTest({
        linear: { teamKey: "ENG" },
        slack: { userToken: "xoxp-test", appToken: "xapp-test", botToken: "xoxb-test", ...slack },
      }),
    ),
    Layer.provide(Layer.succeed(LinearTickets.LinearTickets, fakeLinear)),
    Layer.provide(Layer.merge(fakeScheduledTasks, fakeThreads)),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, fakeSlackApi(posted, commands))),
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, () => socket.ws)),
  );

const takeUntil = (queue: Queue.Queue<SlackFeedEvent>, done: (event: SlackFeedEvent) => boolean) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(queue);
      if (done(event)) return event;
    }
  });

it.effect("backfills, applies live events with acks, and replies as the user", () => {
  const socket = makeFakeSocket();
  const posted: Array<URLSearchParams> = [];
  return Effect.gen(function* () {
    const slack = yield* SlackService.SlackService;
    const events = yield* Queue.unbounded<SlackFeedEvent>();
    const watcher = yield* slack.subscribe().pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkChild,
    );

    const first = yield* Queue.take(events);
    assert.equal(first._tag, "snapshot");

    const live = yield* takeUntil(
      events,
      (event) => event._tag === "snapshot" && event.status.state === "live",
    );
    assert.deepEqual(
      live._tag === "snapshot"
        ? live.messages.map((m) => [m.senderName, m.channelName, m.text])
        : [],
      [["Ana", "#general", "backfilled"]],
    );

    socket.deliver({
      envelope_id: "env-1",
      type: "events_api",
      payload: {
        event: {
          type: "message",
          channel: "D1",
          channel_type: "im",
          user: "U2",
          text: "ping",
          ts: "2.0",
        },
      },
    });
    const upsert = yield* takeUntil(events, (event) => event._tag === "upsert");
    assert.deepInclude(upsert._tag === "upsert" ? upsert.message : {}, {
      kind: "dm",
      text: "ping",
    });
    assert.deepEqual(socket.sent, [JSON.stringify({ envelope_id: "env-1" })]);

    yield* slack.reply({ channelId: "C1", threadTs: "1.000100", text: "a < b" });
    assert.equal(posted[0]?.get("thread_ts"), "1.000100");
    assert.equal(posted[0]?.get("text"), "a &lt; b");

    yield* Fiber.interrupt(watcher);
  }).pipe(Effect.provide(makeLayer(socket, posted)));
});

it.effect("keeps muted channels out of snapshots and live updates", () => {
  const socket = makeFakeSocket();
  return Effect.gen(function* () {
    const slack = yield* SlackService.SlackService;
    const events = yield* Queue.unbounded<SlackFeedEvent>();
    yield* slack.subscribe().pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkChild,
    );

    const live = yield* takeUntil(
      events,
      (event) => event._tag === "snapshot" && event.status.state === "live",
    );
    // The only backfilled message is in the muted #general.
    assert.deepEqual(live._tag === "snapshot" ? live.messages : null, []);

    const message = (channel: string, ts: string) => ({
      type: "events_api",
      payload: {
        event: { type: "message", channel, channel_type: "channel", user: "U2", text: "x", ts },
      },
    });
    socket.deliver({ envelope_id: "env-1", ...message("C1", "2.0") });
    socket.deliver({ envelope_id: "env-2", ...message("C2", "3.0") });
    const upsert = yield* takeUntil(events, (event) => event._tag === "upsert");
    assert.equal(upsert._tag === "upsert" ? upsert.message.channelId : null, "C2");
    // Muted or not, Slack still gets its acknowledgement.
    assert.lengthOf(socket.sent, 2);
  }).pipe(Effect.provide(makeLayer(socket, [], { mutedChannels: { C1: "#general" } })));
});

it.effect("adds, lists and removes priorities from slash commands without a subscriber", () => {
  const socket = makeFakeSocket();
  return Effect.gen(function* () {
    const answers = yield* Queue.unbounded<string>();
    const connected = Deferred.makeUnsafe<void>();
    yield* run(answers, connected).pipe(
      Effect.provide(makeLayer(socket, [], {}, { answers, connected })),
    );
  });

  function run(answers: Queue.Queue<string>, connected: Deferred.Deferred<void>) {
    return Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const command = (envelopeId: string, name: string, text: string) =>
        socket.deliver({
          envelope_id: envelopeId,
          type: "slash_commands",
          payload: { command: name, text, response_url: RESPONSE_URL },
        });
      const priorities = settings.getSettings.pipe(
        Effect.map((current) => Object.keys(current.linear.priorities)),
      );

      // Nobody subscribes: the connection opens on its own.
      yield* Deferred.await(connected);

      command("env-1", "/add-priority", "#1 ENG-2 and ENG-404");
      assert.equal(
        yield* Queue.take(answers),
        [
          "Added to the priority list:",
          "• <https://linear.app/acme/issue/ENG-1|ENG-1> Checkout &lt;times out&gt; · _Todo_ · Low",
          "• <https://linear.app/acme/issue/ENG-2|ENG-2> Onboarding · _Todo_ · Urgent",
          "Linear has no ENG-404.",
        ].join("\n"),
      );
      assert.deepEqual(yield* priorities, ["ENG-1", "ENG-2"]);

      command("env-2", "/priorities", "");
      assert.equal(
        yield* Queue.take(answers),
        [
          "*Priorities* (2)",
          "*Urgent*",
          "<https://linear.app/acme/issue/ENG-2|ENG-2> - Onboarding · _Todo_",
          "*Low*",
          "<https://linear.app/acme/issue/ENG-1|ENG-1> - Checkout &lt;times out&gt; · _Todo_",
        ].join("\n"),
      );

      command("env-3", "/remove-priority", "eng-1 ENG-9");
      assert.equal(yield* Queue.take(answers), "Removed ENG-1.\nNot on the list: ENG-9.");
      assert.deepEqual(yield* priorities, ["ENG-2"]);

      command("env-4", "/add-priority", "");
      assert.include(yield* Queue.take(answers), "Name the tickets to add");

      // The EOD agent's task, not the plain task of the same name, then its reply.
      command("env-5", "/eod", "");
      assert.equal(
        yield* Queue.take(answers),
        "Running the EOD agent. Its answer will follow here.",
      );
      assert.equal(yield* Queue.take(answers), "*Urgent*\nENG-2 - Onboarding");

      command("env-6", "/get-help", "");
      const help = (yield* Queue.take(answers)).split("\n");
      assert.equal(help[0], "*Commands*");
      assert.include(help, "• `/remove-task` Take a task off the priority list, like `T-12`");
      assert.include(help, "• `/eod` Run the EOD Auto Agent and post its answer");
      assert.include(help.at(-1)!, "`eod`, `help` instead.");
      assert.lengthOf(socket.sent, 6);
    });
  }
});

it.effect("catches up on #priorities requests missed while off, then answers live ones", () => {
  const socket = makeFakeSocket();
  const posted: Array<URLSearchParams> = [];
  // Newest first, as Slack returns history.
  const history = [
    { type: "message", user: "U1", ts: "103.000000", text: "remove ENG-9" },
    { type: "message", user: "U1", ts: "102.000000", text: "lunch anyone?" },
    { type: "message", bot_id: "B1", ts: "101.500000", text: "add ENG-2" },
    { type: "message", user: "U1", ts: "101.000000", text: "add ENG-1" },
  ];
  return Effect.gen(function* () {
    const answers = yield* Queue.unbounded<string>();
    const connected = Deferred.makeUnsafe<void>();
    yield* Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;

      assert.include(yield* Queue.take(answers), "Added to the priority list:");
      assert.equal(yield* Queue.take(answers), "Not on the list: ENG-9.");
      assert.deepEqual(
        posted.map((params) => [
          params.get("thread_ts"),
          params.get("channel"),
          params.get("token"),
        ]),
        [
          ["101.000000", "CPRI", "Bearer xoxb-test"],
          ["103.000000", "CPRI", "Bearer xoxb-test"],
        ],
      );

      yield* Deferred.await(connected);
      const live = {
        envelope_id: "env-1",
        type: "events_api",
        payload: {
          event: {
            type: "message",
            channel: "CPRI",
            channel_type: "channel",
            user: "U2",
            text: "Add ENG-2",
            ts: "104.000000",
          },
        },
      };
      socket.deliver(live);
      assert.include(yield* Queue.take(answers), "ENG-2");
      // A redelivered event is already behind the cursor; the next answer is the list.
      socket.deliver({ ...live, envelope_id: "env-2" });
      socket.deliver({
        ...live,
        envelope_id: "env-3",
        payload: { event: { ...live.payload.event, text: "list", ts: "105.000000" } },
      });
      assert.include(yield* Queue.take(answers), "*Priorities* (2)");

      const current = yield* settings.getSettings;
      assert.deepEqual(Object.keys(current.linear.priorities), ["ENG-1", "ENG-2"]);
      assert.equal(current.slack.priorityCursor, "105.000000");
    }).pipe(
      Effect.provide(
        makeLayer(
          socket,
          posted,
          { priorityCursor: "100.000000" },
          { answers, connected, history },
        ),
      ),
    );
  });
});

it.effect("adds, lists and removes tasks from slash commands and #priorities messages", () => {
  const socket = makeFakeSocket();
  return Effect.gen(function* () {
    const answers = yield* Queue.unbounded<string>();
    const connected = Deferred.makeUnsafe<void>();
    yield* Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const command = (envelopeId: string, name: string, text: string) =>
        socket.deliver({
          envelope_id: envelopeId,
          type: "slash_commands",
          payload: { command: name, text, response_url: RESPONSE_URL },
        });
      const tasks = settings.getSettings.pipe(
        Effect.map((current) =>
          Object.values(current.priorityTasks).map((task) => [task.number, task.title]),
        ),
      );

      yield* Deferred.await(connected);

      command("env-1", "/add-task", "low: Tidy <docs> | after the release");
      assert.equal(yield* Queue.take(answers), "Added T-1 *Tidy &lt;docs&gt;* · Low");

      // `add-task` is a task verb, not the ticket verb `add`.
      socket.deliver({
        envelope_id: "env-2",
        type: "events_api",
        payload: {
          event: {
            type: "message",
            channel: "CPRI",
            user: "U2",
            text: "add-task urgent: Fix login",
            ts: "104.000000",
          },
        },
      });
      assert.equal(yield* Queue.take(answers), "Added T-2 *Fix login* · Urgent");

      const current = yield* settings.getSettings;
      assert.deepEqual(Object.keys(current.linear.priorities), []);
      assert.deepEqual(yield* tasks, [
        [1, "Tidy <docs>"],
        [2, "Fix login"],
      ]);

      command("env-3", "/get-tasks", "");
      const listed = (yield* Queue.take(answers)).split("\n");
      assert.equal(listed[0], "*Tasks* (2)");
      assert.match(listed[1]!, /^• T-2 \*Fix login\* · Urgent · <!date\^\d+\^\{ago\}\|/);
      assert.include(listed[2]!, "T-1");

      command("env-4", "/remove-task", "T-1 9");
      assert.equal(yield* Queue.take(answers), "Removed T-1 Tidy &lt;docs&gt;.\nNo task T-9.");
      assert.deepEqual(yield* tasks, [[2, "Fix login"]]);

      command("env-5", "/add-task", "  ");
      assert.include(yield* Queue.take(answers), "Write the task");
    }).pipe(
      Effect.provide(
        makeLayer(socket, [], { priorityCursor: "100.000000" }, { answers, connected }),
      ),
    );
  });
});
