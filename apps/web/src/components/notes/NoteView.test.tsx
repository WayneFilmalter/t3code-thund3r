// @vitest-environment jsdom

import {
  AuthStandardClientScopes,
  EnvironmentId,
  NoteId,
  type AuthEnvironmentScope,
  type Note,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

// ChatMarkdown reaches into app state for file links and shell actions; a note
// body needs none of that, so the same stubs ChatMarkdown.test.tsx uses apply.
vi.mock("~/hooks/useFileMetadata", () => ({ useFileMetadata: () => null }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("~/components/chat/MermaidDiagram", () => ({ MermaidDiagram: () => null }));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipPopup: () => null,
}));
vi.mock("~/components/ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuTrigger: () => null,
  MenuPopup: () => null,
  MenuItem: () => null,
  MenuSeparator: () => null,
  MenuSub: () => null,
  MenuSubTrigger: () => null,
  MenuSubPopup: () => null,
  MenuRadioGroup: () => null,
  MenuRadioItem: () => null,
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/state/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/state/session")>();
  const granted = new Set<AuthEnvironmentScope>(AuthStandardClientScopes);
  const hasScope = (environmentId: EnvironmentId | null, scope: AuthEnvironmentScope) =>
    environmentId !== null && granted.has(scope);
  return {
    ...actual,
    useEnvironmentScope: hasScope,
    readEnvironmentScope: hasScope,
    usePreparedConnection: () => ({ _tag: "Loading" }),
  };
});
vi.mock("~/state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("~/remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("~/editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectOnChangeRequestHost: () => undefined,
  parseChangeRequestUrl: () => null,
  resolvePullRequestPreviewTarget: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import { NoteView, shouldEditOnBodyClick } from "./NoteView";

const note: Note = {
  id: NoteId.make("n1"),
  title: "Priorities",
  body: "finish last priorities\nmove resend to use CC\n\n1743, make new demo",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  createdByThreadId: null,
  categoryId: null,
};

describe("NoteView", () => {
  it("keeps the editor's single newlines as line breaks", () => {
    const html = renderToStaticMarkup(
      <NoteView
        note={note}
        categories={[]}
        environmentId={EnvironmentId.make("env")}
        threadRef={null}
        canWrite
        pending={false}
        onBack={() => {}}
        onMenuAction={() => {}}
        onTaskListChange={() => {}}
      />,
    );
    // One `\n` is a hard break and a blank line is a new paragraph, as in the editor.
    expect(html).toMatch(/finish last priorities<br\s*\/?>/);
    expect(html.match(/<p[\s>]/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("shouldEditOnBodyClick", () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<p>text</p><a href="#">link</a><label><input type="checkbox" />task</label><button>copy</button><span data-no-edit><em>x</em></span>';
  const pick = (selector: string) => container.querySelector(selector);

  it("edits on plain text with no selection", () => {
    expect(shouldEditOnBodyClick(pick("p"), true)).toBe(true);
    expect(shouldEditOnBodyClick(null, true)).toBe(true);
  });

  it("leaves links, checkboxes, buttons and opted-out regions alone", () => {
    expect(shouldEditOnBodyClick(pick("a"), true)).toBe(false);
    expect(shouldEditOnBodyClick(pick("input"), true)).toBe(false);
    expect(shouldEditOnBodyClick(pick("button"), true)).toBe(false);
    expect(shouldEditOnBodyClick(pick("em"), true)).toBe(false);
  });

  it("does not edit while text is selected", () => {
    expect(shouldEditOnBodyClick(pick("p"), false)).toBe(false);
  });
});
