import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as NotesService from "../../../notes/NotesService.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as NotesHandlers from "./handlers.ts";
import { NotesToolkit } from "./tools.ts";

const threadId = ThreadId.make("note-writer");

const threadScope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("notes-env"),
  requestNamespace: "notes-session",
  thread: {
    threadId,
    providerSessionId: "notes-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

const readOnlyClientScope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("notes-env"),
  requestNamespace: "client:session-1",
  thread: undefined,
  client: { sessionId: "session-1", label: "Claude Code", access: "read-only" },
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

const layerFor = (scope: McpInvocationContext.McpInvocationScope) =>
  Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
    McpToolAccessTestkit.liveThreadsLayer,
    NotesService.layer.pipe(
      Layer.provide(SqlitePersistence.layerMemory),
      Layer.provide(NodeCrypto.layer),
    ),
  );

type NoteToolName = "t3_note_list" | "t3_note_read" | "t3_note_create" | "t3_note_update";

/** One built dependency set per test, so every call shares the same in-memory database. */
const withNotesTools = <A, E>(
  scope: McpInvocationContext.McpInvocationScope,
  use: (
    call: (name: NoteToolName, params: Record<string, unknown>) => Effect.Effect<unknown, never>,
  ) => Effect.Effect<A, E, NotesService.NotesService>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const dependencies = yield* Layer.build(layerFor(scope));
      const toolkit = yield* NotesToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(NotesHandlers.layer).pipe(
            Layer.provide(Layer.succeedContext(dependencies)),
          ),
        ),
      );
      // The test body may reach the service directly, e.g. to seed a category.
      return yield* use((name, params) =>
        toolkit.handle(name, params as never).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.provide(dependencies),
          Effect.map((results) => results.at(-1)?.result),
          Effect.orDie,
        ),
      ).pipe(Effect.provide(dependencies));
    }),
  );

it.effect("a thread caller creates a note stamped with its own thread id", () =>
  withNotesTools(threadScope, (call) =>
    Effect.gen(function* () {
      const note = (yield* call("t3_note_create", { title: "Research", body: "- [ ] read" })) as {
        createdByThreadId?: string;
        id?: string;
      };
      assert.equal(note.createdByThreadId, threadId);

      const list = (yield* call("t3_note_list", {})) as { notes: ReadonlyArray<{ id: string }> };
      assert.deepEqual(
        list.notes.map((entry) => entry.id),
        [note.id],
      );

      const read = (yield* call("t3_note_read", { noteId: note.id })) as { title?: string };
      assert.equal(read.title, "Research");
    }),
  ),
);

it.effect("a thread caller files a note under an existing category and can unfile it", () =>
  withNotesTools(threadScope, (call) =>
    Effect.gen(function* () {
      const notes = yield* NotesService.NotesService;
      const category = yield* notes.createCategory({ name: "Research", color: "teal" });
      const note = (yield* call("t3_note_create", {
        title: "Paper",
        body: "",
        categoryId: category.id,
      })) as { id: string; categoryId: string | null };
      assert.equal(note.categoryId, category.id);

      const list = (yield* call("t3_note_list", {})) as {
        categories: ReadonlyArray<{ id: string }>;
      };
      assert.deepEqual(
        list.categories.map((entry) => entry.id),
        [category.id],
      );

      const unfiled = (yield* call("t3_note_update", { noteId: note.id, categoryId: null })) as {
        categoryId: string | null;
      };
      assert.isNull(unfiled.categoryId);

      const refused = (yield* call("t3_note_update", {
        noteId: note.id,
        categoryId: "missing",
      })) as { code?: string };
      assert.equal(refused.code, "invalid_request");
    }),
  ),
);

it.effect("a read-only client lists notes but is refused a write", () =>
  withNotesTools(readOnlyClientScope, (call) =>
    Effect.gen(function* () {
      assert.deepEqual(yield* call("t3_note_list", {}), { notes: [], categories: [] });
      const outcome = (yield* call("t3_note_create", { title: "Nope", body: "" })) as {
        code?: string;
      };
      assert.equal(outcome.code, "capability_denied");
    }),
  ),
);
