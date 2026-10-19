import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { NoteCategoryId, NoteId } from "@t3tools/contracts";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as NotesService from "./NotesService.ts";

const layer = NotesService.layer.pipe(
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(NodeCrypto.layer),
);

it.effect("creates, lists newest-first, updates and deletes notes", () =>
  Effect.gen(function* () {
    const notes = yield* NotesService.NotesService;
    yield* TestClock.setTime(Date.parse("2026-10-15T10:00:00.000Z"));
    const first = yield* notes.create({ title: "  Standup  ", body: "- [ ] ship" });
    assert.equal(first.title, "Standup");
    assert.isNull(first.createdByThreadId);

    yield* TestClock.setTime(Date.parse("2026-10-15T10:05:00.000Z"));
    const second = yield* notes.create({ title: "", body: "" });
    assert.equal(second.title, "Untitled note");

    let listed = yield* notes.list();
    assert.deepEqual(
      listed.notes.map((note) => note.id),
      [second.id, first.id],
    );

    yield* TestClock.setTime(Date.parse("2026-10-15T10:10:00.000Z"));
    const updated = yield* notes.update({ id: first.id, body: "- [x] ship" });
    assert.equal(updated.title, "Standup");
    assert.equal(updated.body, "- [x] ship");
    assert.equal(updated.updatedAt, "2026-10-15T10:10:00.000Z");
    assert.equal(updated.createdAt, first.createdAt);

    listed = yield* notes.list();
    assert.deepEqual(
      listed.notes.map((note) => note.id),
      [first.id, second.id],
    );

    yield* notes.delete({ id: second.id });
    listed = yield* notes.list();
    assert.deepEqual(
      listed.notes.map((note) => note.id),
      [first.id],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("files notes under categories, lists categories by name, and unfiles on delete", () =>
  Effect.gen(function* () {
    const notes = yield* NotesService.NotesService;
    yield* TestClock.setTime(Date.parse("2026-10-15T10:00:00.000Z"));
    const work = yield* notes.createCategory({ name: "  Work ", color: "blue" });
    assert.equal(work.name, "Work");
    const home = yield* notes.createCategory({ name: "home", color: "green" });

    const filed = yield* notes.create({ title: "Standup", body: "", categoryId: work.id });
    assert.equal(filed.categoryId, work.id);
    const loose = yield* notes.create({ title: "Loose", body: "" });
    assert.isNull(loose.categoryId);

    let listed = yield* notes.list();
    // Case-insensitive name order, not creation order.
    assert.deepEqual(
      listed.categories.map((category) => category.id),
      [home.id, work.id],
    );

    const moved = yield* notes.update({ id: loose.id, categoryId: home.id });
    assert.equal(moved.categoryId, home.id);
    const kept = yield* notes.update({ id: loose.id, title: "Still home" });
    assert.equal(kept.categoryId, home.id);
    const cleared = yield* notes.update({ id: loose.id, categoryId: null });
    assert.isNull(cleared.categoryId);

    const renamed = yield* notes.updateCategory({ id: work.id, name: "Office", color: "red" });
    assert.equal(renamed.name, "Office");
    assert.equal(renamed.color, "red");

    yield* notes.deleteCategory({ id: work.id });
    listed = yield* notes.list();
    assert.deepEqual(
      listed.categories.map((category) => category.id),
      [home.id],
    );
    const unfiled = listed.notes.find((note) => note.id === filed.id);
    assert.isNull(unfiled?.categoryId);
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects an unknown category on create, update, rename and delete", () =>
  Effect.gen(function* () {
    const notes = yield* NotesService.NotesService;
    const missing = NoteCategoryId.make("missing");
    const created = yield* notes
      .create({ title: "x", body: "", categoryId: missing })
      .pipe(Effect.flip);
    assert.equal(created.kind, "not-found");
    const note = yield* notes.create({ title: "x", body: "" });
    const updated = yield* notes.update({ id: note.id, categoryId: missing }).pipe(Effect.flip);
    assert.equal(updated.kind, "not-found");
    const renamed = yield* notes.updateCategory({ id: missing, name: "y" }).pipe(Effect.flip);
    assert.equal(renamed.kind, "not-found");
    const removed = yield* notes.deleteCategory({ id: missing }).pipe(Effect.flip);
    assert.equal(removed.kind, "not-found");
  }).pipe(Effect.provide(layer)),
);

it.effect("fails with not-found for unknown ids", () =>
  Effect.gen(function* () {
    const notes = yield* NotesService.NotesService;
    const missing = NoteId.make("missing");
    const update = yield* notes.update({ id: missing, title: "x" }).pipe(Effect.flip);
    assert.equal(update.kind, "not-found");
    const remove = yield* notes.delete({ id: missing }).pipe(Effect.flip);
    assert.equal(remove.kind, "not-found");
  }).pipe(Effect.provide(layer)),
);

it.effect("subscribers get a snapshot and a fresh list after every change", () =>
  Effect.gen(function* () {
    const notes = yield* NotesService.NotesService;
    const snapshotSeen = yield* Deferred.make<void>();
    const collected = yield* Effect.forkChild(
      notes.subscribeList().pipe(
        Stream.mapEffect((list) => Deferred.succeed(snapshotSeen, undefined).pipe(Effect.as(list))),
        Stream.take(2),
        Stream.runCollect,
      ),
    );
    yield* Deferred.await(snapshotSeen);
    yield* notes.create({ title: "Later", body: "" });
    const lists = yield* Fiber.join(collected);
    assert.deepEqual(
      lists.map((list) => list.notes.length),
      [0, 1],
    );
    assert.equal(lists[1]?.notes[0]?.title, "Later");
  }).pipe(Effect.provide(layer)),
);
