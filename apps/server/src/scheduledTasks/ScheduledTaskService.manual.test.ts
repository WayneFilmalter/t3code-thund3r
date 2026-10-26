import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
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

it.effect("a timer runs an on-demand task once, then leaves it unscheduled", () =>
  withService(({ service, launched, launches }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(yield* taskInput());
      const runAt = new Date(NOW + 60_000).toISOString();
      const armed = yield* service.scheduleRun({ id: created.task.id, runAt });
      assert.equal(armed.task.nextRunAt, runAt);

      // Past the timer and the poller's first tick.
      yield* TestClock.adjust("70 seconds");
      yield* Deferred.await(launched);
      // The run is recorded after the launch returns; wait for the list to say so.
      const [task] = yield* service.subscribeList().pipe(
        Stream.map((list) => list.tasks[0]),
        Stream.filter((entry) => entry?.runCount === 1),
        Stream.take(1),
        Stream.runCollect,
      );
      assert.equal(task?.runCount, 1);
      assert.equal(task?.lastRunThreadId, "thread-1");
      assert.isNull(task?.nextRunAt);
      yield* TestClock.adjust("2 minutes");
      assert.equal(yield* Ref.get(launches), 1);
    }),
  ),
);

it.effect("cancelling a timer disarms it and a paused or webhook task cannot be armed", () =>
  withService(({ service, launches }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(yield* taskInput());
      yield* service.scheduleRun({
        id: created.task.id,
        runAt: new Date(NOW + 60_000).toISOString(),
      });
      const cancelled = yield* service.scheduleRun({ id: created.task.id, runAt: null });
      assert.isNull(cancelled.task.nextRunAt);
      yield* TestClock.adjust("2 minutes");
      assert.equal(yield* Ref.get(launches), 0);

      yield* service.setEnabled({ id: created.task.id, enabled: false });
      const paused = yield* service
        .scheduleRun({ id: created.task.id, runAt: new Date(NOW + 300_000).toISOString() })
        .pipe(Effect.flip);
      assert.equal(paused.message, "Resume the task to set a timer.");

      const webhook = yield* service.upsert(
        yield* taskInput({ title: "On push", schedule: { type: "webhook", signature: null } }),
      );
      const rejected = yield* service
        .scheduleRun({ id: webhook.task.id, runAt: new Date(NOW + 60_000).toISOString() })
        .pipe(Effect.flip);
      assert.equal(rejected.message, "Webhook tasks run when their URL receives a request.");
    }),
  ),
);

it.effect("cancelling a timer on a timed task puts it back on its schedule", () =>
  withService(({ service }) =>
    Effect.gen(function* () {
      const created = yield* service.upsert(
        yield* taskInput({ schedule: { type: "interval", everyMs: 3_600_000 } }),
      );
      const scheduled = created.task.nextRunAt;
      yield* service.scheduleRun({
        id: created.task.id,
        runAt: new Date(NOW + 60_000).toISOString(),
      });
      const reset = yield* service.scheduleRun({ id: created.task.id, runAt: null });
      assert.equal(reset.task.nextRunAt, scheduled);
    }),
  ),
);
