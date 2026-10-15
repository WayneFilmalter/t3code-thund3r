/**
 * NotesService — the user's notes on this server: markdown documents outside
 * any project or thread. The right panel's Notes tab and the `t3_note_*` MCP
 * tools both write here, so the service is built once per server (see
 * server.ts) and every client reads the same change signal.
 *
 * @module notes/NotesService
 */
import {
  NotesError,
  type Note,
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

import { noteFromRow, normalizeNoteTitle, type NoteRow } from "./notes.logic.ts";

export class NotesService extends Context.Service<
  NotesService,
  {
    /** Every note, newest edit first. */
    readonly list: () => Effect.Effect<NotesListResult, NotesError>;
    /** The full list on subscribe, then again after every change. */
    readonly subscribeList: () => Stream.Stream<NotesListResult, NotesError>;
    readonly create: (input: NoteCreateInput) => Effect.Effect<Note, NotesError>;
    readonly update: (input: NoteUpdateInput) => Effect.Effect<Note, NotesError>;
    readonly delete: (input: NoteDeleteInput) => Effect.Effect<NoteDeleteResult, NotesError>;
  }
>()("t3/notes/NotesService") {}

const storageError = (detail: string) => (cause: unknown) =>
  new NotesError({ kind: "storage", detail, cause });

const notFound = (id: NoteId) =>
  new NotesError({ kind: "not-found", detail: `Note ${id} was not found.` });

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  // Sliding(1): every signal re-reads the whole list, so a slow subscriber
  // only ever needs the latest one.
  const changes = yield* PubSub.sliding<void>(1);
  const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  const list = Effect.fn("NotesService.list")(function* () {
    const rows = yield* sql<NoteRow>`
      SELECT note_id, title, body, created_at, updated_at, created_by_thread_id
      FROM notes
      ORDER BY updated_at DESC, note_id ASC
    `.pipe(Effect.mapError(storageError("Could not read notes.")));
    return { notes: rows.map(noteFromRow) } satisfies NotesListResult;
  });

  const findOne = (id: NoteId) =>
    sql<NoteRow>`
      SELECT note_id, title, body, created_at, updated_at, created_by_thread_id
      FROM notes WHERE note_id = ${id}
    `.pipe(
      Effect.mapError(storageError("Could not read the note.")),
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined ? Effect.fail(notFound(id)) : Effect.succeed(noteFromRow(row));
      }),
    );

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
    const id = (yield* crypto
      .randomUUIDv4()
      .pipe(Effect.mapError(storageError("Could not generate a note id.")))) as NoteId;
    const now = yield* nowIso;
    const title = normalizeNoteTitle(input.title);
    const createdBy = input.createdByThreadId ?? null;
    yield* sql`
      INSERT INTO notes (note_id, title, body, created_at, updated_at, created_by_thread_id)
      VALUES (${id}, ${title}, ${input.body}, ${now}, ${now}, ${createdBy})
    `.pipe(Effect.mapError(storageError("Could not save the note.")));
    yield* notifyChanged;
    return {
      id,
      title,
      body: input.body,
      createdAt: now,
      updatedAt: now,
      createdByThreadId: createdBy,
    } satisfies Note;
  });

  const update = Effect.fn("NotesService.update")(function* (input: NoteUpdateInput) {
    const current = yield* findOne(input.id);
    const now = yield* nowIso;
    const title = input.title === undefined ? current.title : normalizeNoteTitle(input.title);
    const body = input.body ?? current.body;
    yield* sql`
      UPDATE notes SET title = ${title}, body = ${body}, updated_at = ${now}
      WHERE note_id = ${input.id}
    `.pipe(Effect.mapError(storageError("Could not save the note.")));
    yield* notifyChanged;
    return { ...current, title, body, updatedAt: now } satisfies Note;
  });

  const remove = Effect.fn("NotesService.delete")(function* (input: NoteDeleteInput) {
    yield* findOne(input.id);
    yield* sql`DELETE FROM notes WHERE note_id = ${input.id}`.pipe(
      Effect.mapError(storageError("Could not delete the note.")),
    );
    yield* notifyChanged;
    return { id: input.id } satisfies NoteDeleteResult;
  });

  return NotesService.of({ list, subscribeList, create, update, delete: remove });
});

export const layer = Layer.effect(NotesService, make);
