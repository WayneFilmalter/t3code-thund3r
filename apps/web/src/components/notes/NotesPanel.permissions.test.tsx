import { EnvironmentId, NoteId, type Note } from "@t3tools/contracts";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: true,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  taskChange: undefined as
    | ((input: { markerOffset: number; checked: boolean }) => void)
    | undefined,
}));
vi.mock("~/state/session", () => ({ readEnvironmentScope: () => state.allowed }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.allowed }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/state/server", () => ({
  serverEnvironment: {
    notesLive: () => null,
    createNote: { permissionAtom: () => null },
    updateNote: "update",
    deleteNote: "delete",
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === "update" ? state.update : command === "delete" ? state.remove : state.create,
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: { notes: [note] }, error: null }),
}));
vi.mock("~/hooks/useScratchProject", () => ({
  useScratchProject: () => ({ openScratchProject: vi.fn() }),
}));
vi.mock("~/workflows/workflowRunnerSingleton", () => ({ getWorkflowRunnerPorts: () => ({}) }));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => null, subscribe: () => () => undefined },
}));
vi.mock("~/confirmDialog", () => ({ requestConfirmDialog: () => Promise.resolve(true) }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children?: ReactNode }) =>
    children === undefined ? render : cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));
vi.mock("~/components/ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuTrigger: ({ render }: { render: ReactElement }) => render,
  MenuPopup: ({ children }: { children: ReactNode }) => children,
  MenuItem: (props: Record<string, unknown>) => <button type="button" {...props} />,
  MenuSeparator: () => null,
}));
vi.mock("~/components/ChatMarkdown", () => ({
  default: (props: { onTaskListChange?: typeof state.taskChange }) => {
    state.taskChange = props.onTaskListChange;
    return null;
  },
}));

import { NotesPanel } from "./NotesPanel";
import { useNotesPanelStore } from "./notesPanelStore";

const environmentId = EnvironmentId.make("remote");
const note: Note = {
  id: NoteId.make("note-1"),
  title: "Standup",
  body: "- [ ] ship",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  createdByThreadId: null,
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  state.allowed = true;
  state.taskChange = undefined;
  state.create.mockReset().mockResolvedValue({ _tag: "Success", value: note });
  state.update.mockReset().mockResolvedValue({ _tag: "Success", value: note });
  state.remove.mockReset().mockResolvedValue({ _tag: "Success", value: { id: note.id } });
  useNotesPanelStore.getState().setMode(environmentId, { kind: "view", noteId: note.id });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});

const render = async () => {
  await act(async () => {
    renderer = create(
      <NotesPanel environmentId={environmentId} projectRef={null} threadRef={null} />,
    );
  });
};

it.each([true, false])("ticks a checkbox only with note permission (%s)", async (allowed) => {
  state.allowed = allowed;
  await render();
  if (!allowed) {
    // Without the grant the markdown gets no toggle handler at all.
    expect(state.taskChange).toBeUndefined();
    return;
  }
  await act(async () => {
    state.taskChange?.({ markerOffset: 2, checked: true });
  });
  expect(state.update).toHaveBeenCalledWith({
    environmentId,
    input: { id: note.id, body: "- [x] ship" },
  });
});

it("refuses a delete whose grant was revoked after the menu opened", async () => {
  await render();
  const remove = renderer.root
    .findAllByProps({ variant: "destructive" })
    .find((node) => typeof node.props.onClick === "function")!;
  state.allowed = false;
  await act(async () => {
    await remove.props.onClick();
  });
  expect(state.remove).not.toHaveBeenCalled();
});

it("deletes with the grant in place", async () => {
  await render();
  const remove = renderer.root
    .findAllByProps({ variant: "destructive" })
    .find((node) => typeof node.props.onClick === "function")!;
  await act(async () => {
    await remove.props.onClick();
  });
  expect(state.remove).toHaveBeenCalledWith({ environmentId, input: { id: note.id } });
});
