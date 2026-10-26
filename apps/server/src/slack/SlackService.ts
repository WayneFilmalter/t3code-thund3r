/**
 * SlackService — the Control window's Slack feed and the priority requests
 * (see `slackCommands`). One server-lifetime instance owns the only Slack
 * connection and keeps it open while Slack is connected, so requests work
 * when no Control window is open. Slack spreads events across an app's sockets, so a
 * second connection would split the feed; there is only ever this one.
 *
 * A connection opens a Socket Mode websocket with the app-level token, then
 * fills the feed window through `search.messages` with the user token while
 * live events wait in the socket's buffer. When Slack asks the socket to
 * reconnect, the whole cycle runs again, so a reconnect never leaves a gap.
 *
 * @module slack/SlackService
 */
import {
  SlackError,
  type SlackConnectionStatus,
  type SlackFeedEvent,
  type SlackFeedMessage,
  type SlackReplyInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Socket from "effect/socket/Socket";

import { LinearTickets } from "../linear/LinearTickets.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import * as Settings from "../serverSettings.ts";
import {
  type EodStart,
  isSlackTsAfter,
  PRIORITY_CHANNEL_NAME,
  type PriorityRequest,
  readPriorityMessage,
  readSlashCommand,
  runPriorityCommand,
  type SlackSlashCommand,
  startEodAgent,
} from "./slackCommands.ts";
import {
  buildPermalink,
  escapeSlackText,
  feedChangeFromEvent,
  feedKey,
  groupDmName,
  isInsideWindow,
  mentionedUserIds,
  rawFromSearchMatch,
  SLACK_FEED_WINDOW_MS,
  slackMrkdwnToMarkdown,
  type SlackRawMessage,
  windowFeed,
} from "./slackFeed.ts";

const SLACK_API = "https://slack.com/api/";
const REQUEST_TIMEOUT = "20 seconds";
/** Requests missed while the server was off, oldest first; more than a busy week brings. */
const PRIORITY_CATCH_UP_LIMIT = 200;
/** Search pages of 100; five covers a busy week without a long backfill. */
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 5;
export const FEED_LIMIT = SEARCH_PAGE_SIZE * SEARCH_MAX_PAGES;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** Slack errors a retry cannot fix: the tokens are wrong or lack a scope. */
const REJECTED_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "not_allowed_token_type",
  "no_permission",
]);

export class SlackService extends Context.Service<
  SlackService,
  {
    /** A snapshot now and after every refetch, then one event per change. */
    readonly subscribe: () => Stream.Stream<SlackFeedEvent, SlackError>;
    /** Reconnects and fetches the window again. */
    readonly refetch: () => Effect.Effect<void>;
    /** Posts as the user; resolves to the new message's ts. */
    readonly reply: (input: SlackReplyInput) => Effect.Effect<{ readonly ts: string }, SlackError>;
  }
>()("t3/slack/SlackService") {}

type Json = Record<string, unknown>;

interface Self {
  readonly userId: string;
  readonly handle: string;
  readonly teamName: string;
  readonly teamUrl: string;
}

const JsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownOption(JsonString);
const encodeJson = Schema.encodeSync(JsonString);

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const describe = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : String(error);

const make = Effect.gen(function* () {
  const serviceScope = yield* Effect.scope;
  const settingsService = yield* Settings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const makeWebSocket = yield* Socket.WebSocketConstructor;
  const linearTickets = yield* LinearTickets;
  const crypto = yield* Crypto.Crypto;
  const scheduledTasks = yield* ScheduledTaskService;
  const threadManagement = yield* ThreadManagementService;

  const events = yield* PubSub.unbounded<SlackFeedEvent>();
  const refetchRequests = yield* PubSub.unbounded<void>();
  const feed = new Map<string, SlackFeedMessage>();
  let status: SlackConnectionStatus = {
    state: "connecting",
    detail: null,
    selfName: null,
    teamName: null,
    fetchedAt: null,
  };
  // Names outlive a connection; a token change clears them with the feed.
  const userNames = new Map<string, string>();
  const channels = new Map<string, { name: string; kind: SlackFeedMessage["kind"] }>();
  let cachedFor = "";

  const publish = (event: SlackFeedEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);
  const setStatus = (next: Partial<SlackConnectionStatus>) =>
    Effect.suspend(() => {
      status = { ...status, ...next };
      return publish({ _tag: "status", status });
    });
  // Muted conversations stay in the feed but never reach a client, so
  // unmuting shows their messages again without a refetch.
  let muted = new Set<string>();
  const snapshot = Clock.currentTimeMillis.pipe(
    Effect.map((now): SlackFeedEvent => ({
      _tag: "snapshot",
      status,
      messages: windowFeed(
        Array.from(feed.values()).filter((message) => !muted.has(message.channelId)),
        now,
        FEED_LIMIT,
      ),
    })),
  );

  const api = Effect.fn("SlackService.api")(function* (
    token: string,
    method: string,
    params: Record<string, string> = {},
  ) {
    const unreachable = (detail: string) => new SlackError({ kind: "unreachable", detail });
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(`${SLACK_API}${method}`).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.bodyUrlParams(params),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((error) =>
          unreachable(`Could not reach Slack (${method}): ${describe(error)}`),
        ),
      );
    if (response.status === 429) {
      return yield* unreachable(`Slack rate limited ${method}; retrying shortly.`);
    }
    const body = yield* response.json.pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(
        () =>
          new SlackError({ kind: "invalid-response", detail: `Slack ${method} returned no data.` }),
      ),
    );
    if (!isRecord(body)) {
      return yield* new SlackError({
        kind: "invalid-response",
        detail: `Slack ${method} returned no data.`,
      });
    }
    if (body.ok === true) return body;
    const code = typeof body.error === "string" ? body.error : "unknown_error";
    return yield* new SlackError({
      kind: REJECTED_ERRORS.has(code) ? "rejected" : "unreachable",
      detail: `Slack ${method} failed: ${code}`,
    });
  });

  const userName = (token: string, userId: string) =>
    Effect.suspend((): Effect.Effect<string> => {
      const cached = userNames.get(userId);
      if (cached !== undefined) return Effect.succeed(cached);
      return api(token, "users.info", { user: userId }).pipe(
        Effect.map((body) => {
          const user = isRecord(body.user) ? body.user : {};
          const profile = isRecord(user.profile) ? user.profile : {};
          const name =
            [profile.display_name, profile.real_name, user.real_name, user.name].find(
              (value): value is string => typeof value === "string" && value.trim().length > 0,
            ) ?? userId;
          userNames.set(userId, name);
          return name;
        }),
        // A missing name must not drop the message.
        Effect.orElseSucceed(() => userId),
      );
    });

  type ChannelInfo = { readonly name: string; readonly kind: SlackFeedMessage["kind"] };

  const lookupChannel = (token: string, self: Self, channelId: string) =>
    Effect.gen(function* () {
      const body = yield* api(token, "conversations.info", { channel: channelId });
      const channel = isRecord(body.channel) ? body.channel : {};
      const name = typeof channel.name === "string" ? channel.name : channelId;
      if (channel.is_im === true && typeof channel.user === "string") {
        return { name: yield* userName(token, channel.user), kind: "dm" } satisfies ChannelInfo;
      }
      if (channel.is_mpim === true) {
        return { name: groupDmName(name, self.handle), kind: "group_dm" } satisfies ChannelInfo;
      }
      return { name: `#${name}`, kind: "channel" } satisfies ChannelInfo;
    });

  const channelInfo = (token: string, self: Self, raw: SlackRawMessage) =>
    Effect.suspend((): Effect.Effect<ChannelInfo> => {
      const cached = channels.get(raw.channelId);
      if (cached !== undefined) return Effect.succeed(cached);
      return lookupChannel(token, self, raw.channelId).pipe(
        Effect.tap((info) => Effect.sync(() => channels.set(raw.channelId, info))),
        // A missing name must not drop the message.
        Effect.orElseSucceed((): ChannelInfo => ({
          name: raw.channelId,
          kind: raw.kind ?? "channel",
        })),
      );
    });

  const resolve = (token: string, self: Self, raw: SlackRawMessage) =>
    Effect.gen(function* () {
      const channel = yield* channelInfo(token, self, raw);
      const senderName =
        raw.userId !== null ? yield* userName(token, raw.userId) : (raw.botName ?? "Slack");
      yield* Effect.forEach(mentionedUserIds(raw.text), (id) => userName(token, id), {
        concurrency: 4,
        discard: true,
      });
      return {
        channelId: raw.channelId,
        channelName: channel.name,
        kind: raw.kind ?? channel.kind,
        isThreadReply: raw.threadTs !== null,
        ts: raw.ts,
        threadTs: raw.threadTs,
        senderName,
        text: slackMrkdwnToMarkdown(raw.text, (id) => userNames.get(id)),
        permalink: raw.permalink ?? buildPermalink(self.teamUrl, raw),
      } satisfies SlackFeedMessage;
    });

  /** Every message in the window, newest first, through search so thread replies come too. */
  const backfill = (token: string, self: Self) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // `after:` excludes the day it names, so start a day early and trim by ts.
      const after = DateTime.formatIsoDateUtc(
        DateTime.makeUnsafe(now - SLACK_FEED_WINDOW_MS - 24 * 60 * 60 * 1000),
      );
      const raws: SlackRawMessage[] = [];
      for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
        const body = yield* api(token, "search.messages", {
          query: `after:${after}`,
          sort: "timestamp",
          sort_dir: "desc",
          count: String(SEARCH_PAGE_SIZE),
          page: String(page),
        });
        const messages = isRecord(body.messages) ? body.messages : {};
        const matches = Array.isArray(messages.matches) ? messages.matches : [];
        for (const match of matches) {
          const raw = rawFromSearchMatch(match, self.userId);
          if (raw !== null && isInsideWindow(raw.ts, now)) raws.push(raw);
        }
        const paging = isRecord(messages.paging) ? messages.paging : {};
        const pages = typeof paging.pages === "number" ? paging.pages : page;
        if (page >= pages || matches.length === 0) break;
      }
      return yield* Effect.forEach(raws, (raw) => resolve(token, self, raw), { concurrency: 4 });
    });

  const applyEvent = (token: string, self: Self, event: unknown) =>
    Effect.gen(function* () {
      const change = feedChangeFromEvent(event, self.userId);
      if (change === null) return;
      if (change._tag === "remove") {
        if (feed.delete(feedKey(change.channelId, change.ts))) {
          yield* publish({ _tag: "remove", channelId: change.channelId, ts: change.ts });
        }
        return;
      }
      if (!isInsideWindow(change.message.ts, yield* Clock.currentTimeMillis)) return;
      const message = yield* resolve(token, self, change.message);
      feed.set(feedKey(message.channelId, message.ts), message);
      if (!muted.has(message.channelId)) yield* publish({ _tag: "upsert", message });
    });

  /** The answer to send now, and for `/eod` the agent's reply to send when it finishes. */
  const runRequest = (request: PriorityRequest): Effect.Effect<EodStart> =>
    request.command === "/eod"
      ? startEodAgent().pipe(
          Effect.provideService(ScheduledTaskService, scheduledTasks),
          Effect.provideService(ThreadManagementService, threadManagement),
        )
      : runPriorityCommand(request).pipe(
          Effect.provideService(Settings.ServerSettingsService, settingsService),
          Effect.provideService(LinearTickets, linearTickets),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.catch((error) =>
            Effect.succeed(`Could not update priorities: ${describe(error)}`),
          ),
          Effect.map((text) => ({ text, followUp: null })),
        );

  /**
   * Answers through the command's response URL, so a slow Linear call never
   * holds up the socket. The URL takes several answers, so an agent's reply
   * follows the first.
   */
  const answerCommand = (command: SlackSlashCommand) =>
    Effect.gen(function* () {
      const respond = (text: string) =>
        httpClient
          .execute(
            HttpClientRequest.post(command.responseUrl).pipe(
              HttpClientRequest.bodyJsonUnsafe({ response_type: "ephemeral", text }),
            ),
          )
          .pipe(Effect.timeout(REQUEST_TIMEOUT), Effect.ignore);
      const answer = yield* runRequest(command).pipe(Effect.timeout(REQUEST_TIMEOUT));
      yield* respond(answer.text);
      if (answer.followUp !== null) yield* respond(yield* answer.followUp);
    }).pipe(Effect.ignore);

  type ChannelRequest = PriorityRequest & { readonly ts: string; readonly channelId: string };
  // One at a time and in order, so the cursor only ever moves forward.
  const channelRequests = yield* Queue.unbounded<ChannelRequest>();

  const readSettings = settingsService.getSettings.pipe(
    Effect.mapError(
      () => new SlackError({ kind: "unreachable", detail: "Could not read Slack settings." }),
    ),
  );
  const saveCursor = (ts: string) =>
    settingsService.updateSettings({ slack: { priorityCursor: ts } }).pipe(Effect.ignore);

  /**
   * Handles one #priorities request, unless the cursor shows it was handled
   * already, and answers in its thread as Thund3rBot (as the user without a
   * bot token). The cursor moves even when the answer fails, so a broken
   * reply never repeats a change.
   */
  const handleChannelRequest = (request: ChannelRequest) =>
    Effect.gen(function* () {
      const settings = yield* readSettings;
      const cursor = settings.slack.priorityCursor;
      if (cursor.length > 0 && !isSlackTsAfter(request.ts, cursor)) return;
      const answer = yield* runRequest(request);
      yield* saveCursor(request.ts);
      const token = settings.slack.botToken || settings.slack.userToken;
      const reply = (text: string) =>
        api(token, "chat.postMessage", {
          channel: request.channelId,
          thread_ts: request.ts,
          text,
          unfurl_links: "false",
        });
      yield* reply(answer.text);
      // Off the queue, so the next request does not wait for the agent.
      if (answer.followUp !== null) {
        yield* Effect.forkIn(
          answer.followUp.pipe(Effect.flatMap(reply), Effect.ignore),
          serviceScope,
        );
      }
    }).pipe(Effect.ignore);

  /** #priorities by name among the user's conversations; null when they are not in it. */
  const findPriorityChannel = (token: string) =>
    api(token, "users.conversations", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "1000",
    }).pipe(
      Effect.map((body) => {
        const list = Array.isArray(body.channels) ? body.channels.filter(isRecord) : [];
        const channel = list.find((entry) => entry.name === PRIORITY_CHANNEL_NAME);
        return typeof channel?.id === "string" ? channel.id : null;
      }),
      // The feed must not depend on the channel existing.
      Effect.orElseSucceed(() => null),
    );

  /** Queues the requests posted since the cursor; the first connection only sets it. */
  const catchUpPriorityRequests = (token: string, channelId: string) =>
    Effect.gen(function* () {
      const cursor = (yield* readSettings).slack.priorityCursor;
      if (cursor.length === 0) {
        const now = yield* Clock.currentTimeMillis;
        return yield* saveCursor((now / 1000).toFixed(6));
      }
      const body = yield* api(token, "conversations.history", {
        channel: channelId,
        oldest: cursor,
        limit: String(PRIORITY_CATCH_UP_LIMIT),
      });
      const messages = Array.isArray(body.messages) ? body.messages : [];
      // Newest first from Slack; handled oldest first.
      for (const message of messages.toReversed()) {
        const request = readPriorityMessage(message);
        if (request !== null) yield* Queue.offer(channelRequests, { ...request, channelId });
      }
    }).pipe(Effect.ignore);

  /**
   * One Socket Mode connection: open it, backfill while its events buffer,
   * then apply events until Slack asks for a reconnect. Succeeds on that
   * request; fails when the socket or Slack does.
   */
  const runSession = (userToken: string, appToken: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const authed = yield* api(userToken, "auth.test");
        const self: Self = {
          userId: String(authed.user_id ?? ""),
          handle: String(authed.user ?? ""),
          teamName: String(authed.team ?? ""),
          teamUrl: String(authed.url ?? "https://slack.com/"),
        };
        const selfName = yield* userName(userToken, self.userId);
        yield* setStatus({ selfName, teamName: self.teamName });

        const opened = yield* api(appToken, "apps.connections.open");
        if (typeof opened.url !== "string") {
          return yield* new SlackError({
            kind: "invalid-response",
            detail: "Slack did not return a Socket Mode URL.",
          });
        }
        const socket = yield* Socket.makeWebSocket(opened.url, { openTimeout: "15 seconds" }).pipe(
          Effect.provideService(Socket.WebSocketConstructor, makeWebSocket),
        );
        const write = (yield* socket.writer).write;
        const { pull } = yield* socket.reader.pipe(
          Effect.mapError(
            (error) =>
              new SlackError({
                kind: "unreachable",
                detail: `Slack socket failed: ${describe(error)}`,
              }),
          ),
        );

        const messages = yield* backfill(userToken, self);
        const priorityChannel = yield* findPriorityChannel(userToken);
        if (priorityChannel !== null) yield* catchUpPriorityRequests(userToken, priorityChannel);
        feed.clear();
        for (const message of messages) feed.set(feedKey(message.channelId, message.ts), message);
        status = {
          ...status,
          state: "live",
          detail: null,
          fetchedAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* publish(yield* snapshot);

        const decoder = new TextDecoder();
        while (true) {
          const frames = yield* pull.pipe(
            Effect.mapError(
              (error) =>
                new SlackError({
                  kind: "unreachable",
                  detail: `Slack socket closed: ${describe(error)}`,
                }),
            ),
          );
          for (const frame of frames) {
            const envelope = Option.getOrNull(
              decodeJson(typeof frame === "string" ? frame : decoder.decode(frame)),
            );
            if (!isRecord(envelope)) continue;
            // Slack redelivers anything not acknowledged within three seconds.
            if (typeof envelope.envelope_id === "string") {
              yield* write(encodeJson({ envelope_id: envelope.envelope_id })).pipe(Effect.ignore);
            }
            if (envelope.type === "disconnect") return;
            if (envelope.type === "events_api" && isRecord(envelope.payload)) {
              const event = envelope.payload.event;
              const request =
                isRecord(event) && event.channel === priorityChannel
                  ? readPriorityMessage(event)
                  : null;
              if (request !== null && priorityChannel !== null) {
                yield* Queue.offer(channelRequests, { ...request, channelId: priorityChannel });
              }
              yield* applyEvent(userToken, self, event);
            }
            if (envelope.type === "slash_commands") {
              const command = readSlashCommand(envelope.payload);
              // Outlives a reconnect: Slack still takes the answer after the socket moves.
              if (command !== null) yield* Effect.forkIn(answerCommand(command), serviceScope);
            }
          }
        }
      }),
    );

  /** Keeps a session running for the current tokens, reconnecting with backoff. */
  const supervise = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        () => new SlackError({ kind: "unreachable", detail: "Could not read Slack settings." }),
      ),
    );
    const { userToken, appToken } = settings.slack;
    const tokens = `${userToken}\n${appToken}`;
    if (tokens !== cachedFor) {
      cachedFor = tokens;
      userNames.clear();
      channels.clear();
      feed.clear();
    }
    if (userToken.length === 0 || appToken.length === 0) {
      status = {
        state: "unconfigured",
        detail: null,
        selfName: null,
        teamName: null,
        fetchedAt: null,
      };
      yield* publish(yield* snapshot);
      return yield* Effect.never;
    }
    let attempt = 0;
    while (true) {
      yield* setStatus({ state: "connecting", detail: null });
      const result = yield* Effect.result(runSession(userToken, appToken));
      if (result._tag === "Success") {
        attempt = 0;
        continue;
      }
      const error = result.failure;
      yield* setStatus({ state: "error", detail: error.detail });
      // Wrong tokens stay wrong until they change or the user refetches.
      if (error.kind === "rejected") return yield* Effect.never;
      yield* Effect.sleep(Duration.millis(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)));
      attempt += 1;
    }
  }).pipe(Effect.catch((error) => setStatus({ state: "error", detail: error.detail })));

  const slackSettings = Stream.concat(
    Stream.fromEffect(settingsService.getSettings.pipe(Effect.orDie)),
    settingsService.streamChanges,
  ).pipe(Stream.map((settings) => settings.slack));

  /** Restarts the session whenever the Slack tokens change or a refetch is asked for. */
  const restarts = Stream.merge(
    slackSettings.pipe(
      Stream.map((slack) => `${slack.userToken}\n${slack.appToken}`),
      Stream.changes,
    ),
    Stream.fromPubSub(refetchRequests),
  );

  /** A changed mute list re-sends the feed; the Slack connection is untouched. */
  const followMutes = slackSettings.pipe(
    Stream.map((slack) => Object.keys(slack.mutedChannels).toSorted().join("\n")),
    Stream.changes,
    Stream.runForEach((ids) =>
      Effect.suspend(() => {
        muted = new Set(ids.length === 0 ? [] : ids.split("\n"));
        return Effect.flatMap(snapshot, publish);
      }),
    ),
  );

  // Started once settings are loaded, and held for the server's lifetime.
  yield* Effect.gen(function* () {
    yield* settingsService.ready.pipe(Effect.ignore);
    const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
    muted = new Set(Object.keys(settings.slack.mutedChannels));
    yield* Effect.all(
      [
        followMutes,
        Effect.forever(Queue.take(channelRequests).pipe(Effect.flatMap(handleChannelRequest))),
        restarts.pipe(
          Stream.switchMap(() => Stream.fromEffect(supervise)),
          Stream.runDrain,
        ),
      ],
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.forkScoped);

  const subscribe = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the snapshot; a delta it already contains applies twice harmlessly.
        const subscription = yield* PubSub.subscribe(events);
        return Stream.concat(Stream.fromEffect(snapshot), Stream.fromSubscription(subscription));
      }),
    );

  const refetch = () => PubSub.publish(refetchRequests, undefined).pipe(Effect.asVoid);

  const reply = Effect.fn("SlackService.reply")(function* (input: SlackReplyInput) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        () => new SlackError({ kind: "unreachable", detail: "Could not read Slack settings." }),
      ),
    );
    if (settings.slack.userToken.length === 0) {
      return yield* new SlackError({
        kind: "not-configured",
        detail: "Connect Slack in the Control tab first.",
      });
    }
    const body = yield* api(settings.slack.userToken, "chat.postMessage", {
      channel: input.channelId,
      text: escapeSlackText(input.text),
      ...(input.threadTs === null ? {} : { thread_ts: input.threadTs }),
    });
    return { ts: typeof body.ts === "string" ? body.ts : "" };
  });

  return SlackService.of({ subscribe, refetch, reply });
});

export const layer = Layer.effect(SlackService, make);
