import type { DesktopPreviewFavicon, PreviewSessionSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { RightPanelTabs, type RightPanelKindTabId } from "./RightPanelTabs";

const previewSurface = {
  id: "browser:tab-1" as const,
  kind: "preview" as const,
  resourceId: "tab-1",
};
const secondSurface = {
  id: "browser:tab-2" as const,
  kind: "preview" as const,
  resourceId: "tab-2",
};
const sessions: Readonly<Record<string, PreviewSessionSnapshot>> = {
  "tab-1": {
    threadId: "thread-1",
    tabId: "tab-1",
    navStatus: { _tag: "Success", url: "http://24x.xf.local/", title: "Local site" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
  "tab-2": {
    threadId: "thread-1",
    tabId: "tab-2",
    navStatus: { _tag: "Success", url: "http://24x.xf.local/admin", title: "Admin" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
};

const favicon = (dataUrl: string, pageUrl: string): DesktopPreviewFavicon => ({
  dataUrl,
  pageUrl,
  capturedAt: 1,
});

function overlay(icon: DesktopPreviewFavicon | null) {
  return {
    hasWebContents: true,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system" as const,
    controller: "none" as const,
    favicon: icon,
  };
}

const KIND_TAB_IDS: readonly RightPanelKindTabId[] = [
  "workflows",
  "browser",
  "terminal",
  "files",
  "diff",
];

const allKindTabs = Object.fromEntries(
  KIND_TAB_IDS.map((id) => [id, { available: true, onSelect: () => undefined }]),
) as Record<RightPanelKindTabId, { available: boolean; onSelect: () => void }>;

function renderPanel(options: {
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  kindTabs?: typeof allKindTabs;
  desktopByTabId?: Record<string, ReturnType<typeof overlay>>;
}) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      {...(options.kindTabs ? { kindTabs: options.kindTabs } : {})}
      surfaces={options.surfaces}
      activeSurfaceId={options.activeSurfaceId}
      pendingSurfaceIds={new Set()}
      previewSessions={sessions}
      desktopByTabId={options.desktopByTabId ?? {}}
      terminalLabelsById={new Map()}
      onActivate={() => undefined}
      onCloseSurface={() => undefined}
      onCloseOtherSurfaces={() => undefined}
      onCloseSurfacesToRight={() => undefined}
      onCloseAllSurfaces={() => undefined}
      onCopyFilePath={() => undefined}
    >
      <div>content</div>
    </RightPanelTabs>,
  );
}

function renderTabs(first: DesktopPreviewFavicon | null, second?: DesktopPreviewFavicon) {
  return renderPanel({
    surfaces: second ? [previewSurface, secondSurface] : [previewSurface],
    activeSurfaceId: previewSurface.id,
    desktopByTabId: {
      "tab-1": overlay(first),
      ...(second ? { "tab-2": overlay(second) } : {}),
    },
  });
}

/** Text of every kind tab and surface tab in the order they render. */
function tabOrder(html: string): string[] {
  return [...html.matchAll(/aria-label="(?:Close )?([^"]+)"/g)].map((match) => match[1]!);
}

function pressedKindTabs(html: string): string[] {
  return [...html.matchAll(/aria-pressed="true"[^>]*aria-label="([^"]+)"/g)].map(
    (match) => match[1]!,
  );
}

describe("RightPanelTabs preview favicon", () => {
  it("prefers a live capture and never asks Google about a private hostname", () => {
    const captured = renderTabs(favicon("data:image/png;base64,AAAA", "http://24x.xf.local/"));
    expect(captured).toContain("data:image/png;base64,AAAA");
    expect(captured).not.toContain("s2/favicons");
    expect(renderTabs(null)).not.toContain("s2/favicons");
  });

  it("keeps route-specific captures isolated between live tabs on one origin", () => {
    const html = renderTabs(
      favicon("data:image/png;base64,AAAA", "http://24x.xf.local/"),
      favicon("data:image/png;base64,BBBB", "http://24x.xf.local/admin"),
    );
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("data:image/png;base64,BBBB");
  });

  it("hides a capture while the server session still describes another origin", () => {
    const html = renderTabs(favicon("data:image/png;base64,AAAA", "https://example.com/"));
    expect(html).not.toContain("data:image/png;base64,AAAA");
  });
});

describe("RightPanelTabs kind tabs", () => {
  const pullRequestSurface: RightPanelSurface = {
    id: "pull-request:project:repo:7",
    kind: "pull-request",
    projectId: "project",
    repository: "repo",
    number: 7,
  };

  it("renders every surface as a closable tab when no kind tabs are given", () => {
    const html = renderPanel({
      surfaces: [previewSurface, secondSurface],
      activeSurfaceId: previewSurface.id,
    });
    expect(tabOrder(html)).toEqual(["Local site", "Admin"]);
    expect(html).not.toContain("data-right-panel-surface-tabs");
  });

  it("lists the fixed kind tabs with Workflows first and moves owned surfaces to a second row", () => {
    const html = renderPanel({
      surfaces: [previewSurface, secondSurface],
      activeSurfaceId: previewSurface.id,
      kindTabs: allKindTabs,
      desktopByTabId: {
        "tab-1": overlay(favicon("data:image/png;base64,AAAA", "http://24x.xf.local/")),
        "tab-2": overlay(favicon("data:image/png;base64,BBBB", "http://24x.xf.local/admin")),
      },
    });
    expect(tabOrder(html)).toEqual([
      "Workflows",
      "Browser",
      "Terminal",
      "Files",
      "Diff",
      "Local site",
      "Admin",
    ]);
    expect(pressedKindTabs(html)).toEqual(["Browser"]);
    expect(html).toContain("data-right-panel-surface-tabs");
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("data:image/png;base64,BBBB");
  });

  it("appends surfaces no kind tab owns after the fixed tabs", () => {
    const html = renderPanel({
      surfaces: [{ id: "diff", kind: "diff" }, pullRequestSurface],
      activeSurfaceId: pullRequestSurface.id,
      kindTabs: allKindTabs,
    });
    expect(tabOrder(html)).toEqual(["Workflows", "Browser", "Terminal", "Files", "Diff", "#7"]);
    // A pull request is not a kind tab, so nothing in the fixed row is pressed.
    expect(pressedKindTabs(html)).toEqual([]);
    expect(html).not.toContain("data-right-panel-surface-tabs");
  });

  it("treats an empty panel as the Workflows tab", () => {
    const html = renderPanel({ surfaces: [], activeSurfaceId: null, kindTabs: allKindTabs });
    expect(pressedKindTabs(html)).toEqual(["Workflows"]);
    expect(html).not.toContain("data-right-panel-surface-tabs");
  });

  it("dims an unavailable kind tab instead of hiding it", () => {
    const html = renderPanel({
      surfaces: [],
      activeSurfaceId: null,
      kindTabs: { ...allKindTabs, diff: { available: false, onSelect: () => undefined } },
    });
    expect(tabOrder(html)).toEqual(["Workflows", "Browser", "Terminal", "Files", "Diff"]);
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-label="Diff"/);
  });
});
