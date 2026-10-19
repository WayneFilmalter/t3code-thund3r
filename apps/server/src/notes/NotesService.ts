/**
 * NotesService — the user's notes on this server: markdown documents outside
 * any project or thread, plus the categories they are filed under. The right
 * panel's Notes tab and the `t3_note_*` MCP tools both write here, so the
 * service is built once per server (see server.ts) and every client reads the
 * same change signal.
 *
 * @module notes/NotesService
 */
import {
  NotesError,
  type Note,
  type NoteCategory,
  type NoteCategoryCreateInput,
  type NoteCategoryDeleteInput,
  type NoteCategoryDeleteResult,
  type NoteCategoryId,
  type NoteCategoryUpdateInput,
  type NoteCreateInput,
  type NoteDeleteInput,
  type NoteDeleteResult,
  type NoteId,
  type NotesListResult,
  type NoteUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import {
  noteCategoryFromRow,
  noteFromRow,
  normalizeNoteCategoryName,
  normalizeNoteTitle,
  type NoteCategoryRow,
  type NoteRow,
} from "./notes.logic.ts";

export class NotesService extends Context.Service<
  NotesService,
  {
    /** Every note, newest edit first, with every category by name. */
    readonly list: () => Effect.Effect<NotesListResult, NotesError>;
    /** The full list on subscribe, then again after every change to a note or a category. */
    readonly subscribeList: () => Stream.Stream<NotesListResult, NotesError>;
    readonly create: (input: NoteCreateInput) => Effect.Effect<Note, NotesError>;
    readonly update: (input: NoteUpdateInput) => Effect.Effect<Note, NotesError>;
    readonly delete: (input: NoteDeleteInput) => Effect.Effect<NoteDeleteResult, NotesError>;
    readonly createCategory: (
      input: NoteCategoryCreateInput,
    ) => Effect.Effect<NoteCategory, NotesError>;
    readonly updateCategory: (
      input: NoteCategoryUpdateInput,
    ) => Effect.Effect<NoteCategory, NotesError>;
    /** Removes the category; its notes stay and become uncategorised. */
    readonly deleteCategory: (
      input: NoteCategoryDeleteInput,
    ) => Effect.Effect<NoteCategoryDeleteResult, NotesError>;
  }
>()("t3/notes/NotesService") {}

const storageError = (detail: string) => (cause: unknown) =>
  new NotesError({ kind: "storage", detail, cause });

const notFound = (id: NoteId) =>
  new NotesError({ kind: "not-found", detail: `Note ${id} was not found.` });

const categoryNotFound = (id: NoteCategoryId) =>
  new NotesError({ kind: "not-found", detail: `Note category ${id} was not found.` });

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  // Sliding(1): every signal re-reads the whole list, so a slow subscriber
  // only ever needs the latest one.
  const changes = yield* PubSub.sliding<void>(1);
  const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  const newId = (what: string) =>
    crypto.randomUUIDv4().pipe(Effect.mapError(storageError(`Could not generate a ${what} id.`)));

  const listCategories = sql<NoteCategoryRow>`
    SELECT category_id, name, color, created_at
    FROM note_categories
    ORDER BY name COLLATE NOCASE ASC, category_id ASC
  `.pipe(
    Effect.mapError(storageError("Could not read note categories.")),
    Effect.map((rows) => rows.map(noteCategoryFromRow)),
  );

  const list = Effect.fn("NotesService.list")(function* () {
    const rows = yield* sql<NoteRow>`
      SELECT note_id, title, body, created_at, updated_at, created_by_thread_id, category_id
      FROM notes
      ORDER BY updated_at DESC, note_id ASC
    `.pipe(Effect.mapError(storageError("Could not read notes.")));
    const categories = yield* listCategories;
    return { notes: rows.map(noteFromRow), categories } satisfies NotesListResult;
  });

  const findOne = (id: NoteId) =>
    sql<NoteRow>`
      SELECT note_id, title, body, created_at, updated_at, created_by_thread_id, category_id
      FROM notes WHERE note_id = ${id}
    `.pipe(
      Effect.mapError(storageError("Could not read the note.")),
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined ? Effect.fail(notFound(id)) : Effect.succeed(noteFromRow(row));
      }),
    );

  const findCategory = (id: NoteCategoryId) =>
    sql<NoteCategoryRow>`
      SELECT category_id, name, color, created_at
      FROM note_categories WHERE category_id = ${id}
    `.pipe(
      Effect.mapError(storageError("Could not read the note category.")),
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined
          ? Effect.fail(categoryNotFound(id))
          : Effect.succeed(noteCategoryFromRow(row));
      }),
    );

  /** A category id a note may point at: null, or one that exists. */
  const checkCategory = (id: NoteCategoryId | null) =>
    id === null ? Effect.void : findCategory(id).pipe(Effect.asVoid);

  const subscribeList = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the snapshot so a change landing between the two
        // is buffered rather than dropped.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list())),
        );
      }),
    );

  const create = Effect.fn("NotesService.create")(function* (input: NoteCreateInput) {
    const categoryId = input.categoryId ?? null;
    yield* checkCategory(categoryId);
    const id = (yield* newId("note")) as NoteId;
    const now = yield* nowIso;
    const title = normalizeNoteTitle(input.title);
    const createdBy = input.createdByThreadId ?? null;
    yield* sql`
      INSERT INTO notes (note_id, title, body, created_at, updated_at, created_by_thread_id, category_id)
      VALUES (${id}, ${title}, ${input.body}, ${now}, ${now}, ${createdBy}, ${categoryId})
    `.pipe(Effect.mapError(storageError("Could not save the note.")));
    yield* notifyChanged;
    return {
      id,
      title,
      body: input.body,
      createdAt: now,
      updatedAt: now,
      createdByThreadId: createdBy,
      categoryId,
    } satisfies Note;
  });

  const update = Effect.fn("NotesService.update")(function* (input: NoteUpdateInput) {
    const current = yield* findOne(input.id);
    const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;
    if (categoryId !== current.categoryId) yield* checkCategory(categoryId);
    const now = yield* nowIso;
    const title = input.title === undefined ? current.title : normalizeNoteTitle(input.title);
    const body = input.body ?? current.body;
    yield* sql`
      UPDATE notes
      SET title = ${title}, body = ${body}, updated_at = ${now}, category_id = ${categoryId}
      WHERE note_id = ${input.id}
    `.pipe(Effect.mapError(storageError("Could not save the note.")));
    yield* notifyChanged;
    return { ...current, title, body, updatedAt: now, categoryId } satisfies Note;
  });

  const remove = Effect.fn("NotesService.delete")(function* (input: NoteDeleteInput) {
    yield* findOne(input.id);
    yield* sql`DELETE FROM notes WHERE note_id = ${input.id}`.pipe(
      Effect.mapError(storageError("Could not delete the note.")),
    );
    yield* notifyChanged;
    return { id: input.id } satisfies NoteDeleteResult;
  });

  const createCategory = Effect.fn("NotesService.createCategory")(function* (
    input: NoteCategoryCreateInput,
  ) {
    const id = (yield* newId("note category")) as NoteCategoryId;
    const now = yield* nowIso;
    const name = normalizeNoteCategoryName(input.name);
    yield* sql`
      INSERT INTO note_categories (category_id, name, color, created_at)
      VALUES (${id}, ${name}, ${input.color}, ${now})
    `.pipe(Effect.mapError(storageError("Could not save the note category.")));
    yield* notifyChanged;
    return { id, name, color: input.color, createdAt: now } satisfies NoteCategory;
  });

  const updateCategory = Effect.fn("NotesService.updateCategory")(function* (
    input: NoteCategoryUpdateInput,
  ) {
    const current = yield* findCategory(input.id);
    const name = input.name === undefined ? current.name : normalizeNoteCategoryName(input.name);
    const color = input.color ?? current.color;
    yield* sql`
      UPDATE note_categories SET name = ${name}, color = ${color} WHERE category_id = ${input.id}
    `.pipe(Effect.mapError(storageError("Could not save the note category.")));
    yield* notifyChanged;
    return { ...current, name, color } satisfies NoteCategory;
  });

  const deleteCategory = Effect.fn("NotesService.deleteCategory")(function* (
    input: NoteCategoryDeleteInput,
  ) {
    yield* findCategory(input.id);
    // Notes outlive their category: unfile them in the same transaction.
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE notes SET category_id = NULL WHERE category_id = ${input.id}`;
          yield* sql`DELETE FROM note_categories WHERE category_id = ${input.id}`;
        }),
      )
      .pipe(Effect.mapError(storageError("Could not delete the note category.")));
    yield* notifyChanged;
    return { id: input.id } satisfies NoteCategoryDeleteResult;
  });

  return NotesService.of({
    list,
    subscribeList,
    create,
    update,
    delete: remove,
    createCategory,
    updateCategory,
    deleteCategory,
  });
});

export const layer = Layer.effect(NotesService, make);
