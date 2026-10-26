import { assert, it } from "@effect/vitest";
import type { SlackFeedEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";

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

/** Slack's Web API, answering each method the service calls. */
const fakeSlackApi = (posted: Array<URLSearchParams>) =>
  HttpClient.make((request) => {
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
          return {
            ok: true,
            messages: {
              matches: [{ channel: { id: "C1" }, user: "U1", text: "backfilled", ts: "1.000100" }],
              paging: { pages: 1 },
            },
          };
        case "chat.postMessage":
          posted.push(params);
          return { ok: true, ts: "9.000900" };
        default:
          return { ok: false, error: "unknown_method" };
      }
    })();
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)));
  });

const makeLayer = (socket: ReturnType<typeof makeFakeSocket>, posted: Array<URLSearchParams>) =>
  SlackService.layer.pipe(
    Layer.provide(
      ServerSettings.ServerSettingsService.layerTest({
        slack: { userToken: "xoxp-test", appToken: "xapp-test" },
      }),
    ),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, fakeSlackApi(posted))),
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, () => socket.ws)),
  );

const takeUntil = (queue: Queue.Queue<SlackFeedEvent>, done: (event: SlackFeedEvent) => boolean) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(queue);
      if (done(event)) return event;
    }
  });

it.effect("backfills, applies live events with acks, and closes the socket when unwatched", () => {
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
    yield* TestClock.adjust("31 seconds");
    yield* Deferred.await(socket.closed);
  }).pipe(Effect.provide(makeLayer(socket, posted)));
});
