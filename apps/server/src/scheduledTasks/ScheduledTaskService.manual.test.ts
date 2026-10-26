import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
/** An instant `offsetMs` after the test's frozen start, as the server stores it. */
const at = (offsetMs: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + offsetMs));

const taskInput = (overrides: Record<string, unknown> = {}) =>
  decodeUpsertInput({
    title: "Sweep the backlog",
    prompt: "Triage ten backlog tickets.",
    enabled: true,
    schedule: { type: "manual" },
    projectId: "project-manual",
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...overrides,
  });

/**
 * The service with a launcher that names each run's thread `thread-<n>` and
 * signals every launch, so a test can wait for the poller's run, never sleep.
 */
const withService = <A, E, R>(
  body: (input: {
    readonly service: ScheduledTaskService.ScheduledTaskService["Service"];
    readonly launched: Deferred.Deferred<void>;
    readonly launches: Ref.Ref<number>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const launches = yield* Ref.make(0);
    const launched = yield* Deferred.make<void>();
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({
        launch: () =>
          Ref.updateAndGet(launches, (count) => count + 1).pipe(
            Effect.map((count) => ({ threadId: `thread-${count}`, resumed: false }) as never),
            Effect.tap(() => Deferred.succeed(launched, undefined)),
          ),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        return yield* body({ service, launched, launches });
      }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies)))),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory));

it.effect("an on-demand task never schedules itself and records its run's thread", () =>
  withService(({ service }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(yield* taskInput());
      assert.isNull(created.task.nextRunAt);

      const ran = yield* service.runNow({ id: created.task.id });
      assert.equal(ran.task.lastRunStatus, "succeeded");
      assert.equal(ran.task.lastRunThreadId, "thread-1");
      assert.isNull(ran.task.nextRunAt);

      const listed = (yield* service.list()).tasks[0];
      assert.equal(listed?.lastRunThreadId, "thread-1");
      assert.isNull(listed?.nextRunAt);
    }),
  ),
);

it.effect("a timer runs an on-demand Auto Agent once, then clears itself", () =>
  withService(({ service, launched, launches }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(yield* taskInput({ kind: "auto_agent" }));
      const armed = yield* service.setTimer({ id: created.task.id, runAt: at(60_000) });
      assert.equal(armed.task.timerAt, at(60_000));
      assert.isNull(armed.task.nextRunAt);

      // Past the timer and the poller's next tick.
      yield* TestClock.adjust("70 seconds");
      yield* Deferred.await(launched);
      // The run is recorded after the launch returns; wait for the list to say so.
      const [task] = yield* service.subscribeList().pipe(
        Stream.map((list) => list.tasks[0]),
        Stream.filter((entry) => entry?.runCount === 1),
        Stream.take(1),
        Stream.runCollect,
      );
      assert.equal(task?.lastRunThreadId, "thread-1");
      assert.isNull(task?.timerAt);
      assert.isNull(task?.nextRunAt);
      yield* TestClock.adjust("2 minutes");
      assert.equal(yield* Ref.get(launches), 1);
    }),
  ),
);

it.effect("a timer sits beside a schedule, and cancelling it leaves the schedule alone", () =>
  withService(({ service, launches }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(
        yield* taskInput({
          kind: "auto_agent",
          schedule: { type: "interval", everyMs: 3_600_000 },
        }),
      );
      const scheduled = created.task.nextRunAt;
      assert.isNotNull(scheduled);

      const armed = yield* service.setTimer({ id: created.task.id, runAt: at(600_000) });
      assert.equal(armed.task.nextRunAt, scheduled);
      const cancelled = yield* service.setTimer({ id: created.task.id, runAt: null });
      assert.isNull(cancelled.task.timerAt);
      assert.equal(cancelled.task.nextRunAt, scheduled);

      const listed = (yield* service.list()).tasks[0];
      assert.isNull(listed?.timerAt);
      assert.equal(listed?.nextRunAt, scheduled);
      yield* TestClock.adjust("15 minutes");
      assert.equal(yield* Ref.get(launches), 0);
    }),
  ),
);

it.effect("keeps an Auto Agent's kind and saved delay, and its kind across edits", () =>
  withService(({ service }) =>
    Effect.gen(function* () {
      const input = yield* taskInput({ kind: "auto_agent", startDelayMs: 7_200_000 });
      const created = yield* service.upsert(input);
      assert.equal(created.task.kind, "auto_agent");
      assert.equal(created.task.startDelayMs, 7_200_000);

      // An edit that omits both keeps the stored kind and delay.
      const { kind: _kind, startDelayMs: _delay, ...edit } = input;
      const edited = yield* service.upsert({ ...edit, id: created.task.id, title: "Renamed" });
      assert.equal(edited.task.kind, "auto_agent");
      assert.equal(edited.task.startDelayMs, 7_200_000);

      const plain = yield* service.upsert(yield* taskInput({ title: "Plain task" }));
      assert.equal(plain.task.kind, "task");
      const listed = new Map((yield* service.list()).tasks.map((task) => [task.title, task]));
      assert.equal(listed.get("Renamed")?.kind, "auto_agent");
      assert.equal(listed.get("Renamed")?.startDelayMs, 7_200_000);
      assert.equal(listed.get("Plain task")?.kind, "task");
    }),
  ),
);

it.effect("pausing disarms a timer, and a paused or webhook task cannot be armed", () =>
  withService(({ service }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(yield* taskInput({ kind: "auto_agent" }));
      yield* service.setTimer({ id: created.task.id, runAt: at(60_000) });
      const paused = yield* service.setEnabled({ id: created.task.id, enabled: false });
      assert.isNull(paused.task.timerAt);
      assert.isNull((yield* service.list()).tasks[0]?.timerAt);

      const refused = yield* service
        .setTimer({ id: created.task.id, runAt: at(300_000) })
        .pipe(Effect.flip);
      assert.equal(refused.message, "Resume the task to set a timer.");

      const webhook = yield* service.upsert(
        yield* taskInput({ title: "On push", schedule: { type: "webhook", signature: null } }),
      );
      const rejected = yield* service
        .setTimer({ id: webhook.task.id, runAt: at(60_000) })
        .pipe(Effect.flip);
      assert.equal(rejected.message, "Webhook tasks run when their URL receives a request.");
    }),
  ),
);
