import type { ContextMenuItem, PreviewSessionSnapshot, PullRequestState } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  Bot,
  FileDiff,
  Files,
  GitPullRequest,
  Globe2,
  TerminalSquare,
  Workflow,
  X,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelKind, RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ScrollArea } from "~/components/ui/scroll-area";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";

export type RightPanelKindTabId = "workflows" | "browser" | "terminal" | "files" | "diff";

export interface RightPanelKindTabState {
  available: boolean;
  /** Activate an existing surface of this kind, or create one. Owned by the host. */
  onSelect: () => void;
}

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  /** Forwarded to PreviewPanelShell so this surface persists its own width. */
  widthStorageKey?: string;
  /** Forwarded to PreviewPanelShell as the initial width before a user resize. */
  defaultWidth?: number;
  layoutControls?: ReactNode;
  /**
   * Fixed kind tabs (Workflows, Browser, Terminal, Files, Diff) shown first. Surfaces those
   * tabs own move to a second row; every other open surface stays a closable tab in the first.
   * Omitted on the pull-requests page, which only lists its open pull requests.
   */
  kindTabs?: Readonly<Record<RightPanelKindTabId, RightPanelKindTabState>>;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  pullRequestStatuses?: Readonly<Record<string, PullRequestTabStatus>>;
  children: ReactNode;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the T3 Code desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
} as const;

interface KindTabDefinition {
  id: RightPanelKindTabId;
  label: string;
  icon: typeof Workflow;
  /** Surface kinds this tab owns; the tab is active while one of them is the active surface. */
  kinds: readonly RightPanelKind[];
  /** Kinds that can have several instances open at once get a second row of surface tabs. */
  multiInstance: boolean;
  disabledReason: string | null;
}

/** Ordered as rendered: Workflows first, and the default when nothing is open. */
const KIND_TABS: readonly KindTabDefinition[] = [
  {
    id: "workflows",
    label: "Workflows",
    icon: Workflow,
    kinds: ["workflows"],
    multiInstance: false,
    disabledReason: null,
  },
  {
    id: "browser",
    label: "Browser",
    icon: Globe2,
    kinds: ["preview"],
    multiInstance: true,
    disabledReason: SURFACE_DISABLED_REASONS.browser,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: TerminalSquare,
    kinds: ["terminal"],
    multiInstance: true,
    disabledReason: SURFACE_DISABLED_REASONS.terminal,
  },
  {
    id: "files",
    label: "Files",
    icon: Files,
    kinds: ["files", "file"],
    multiInstance: true,
    disabledReason: SURFACE_DISABLED_REASONS.files,
  },
  {
    id: "diff",
    label: "Diff",
    icon: FileDiff,
    kinds: ["diff"],
    multiInstance: false,
    disabledReason: SURFACE_DISABLED_REASONS.diff,
  },
];

const KIND_TAB_OWNED_KINDS: ReadonlySet<RightPanelKind> = new Set(
  KIND_TABS.flatMap((tab) => tab.kinds),
);

/**
 * The kind tab that owns the active surface: Workflows while nothing is open,
 * none while an unowned surface (pull request, agents) is showing.
 */
function activeKindTab(activeSurface: RightPanelSurface | null): KindTabDefinition | null {
  if (!activeSurface) return KIND_TABS[0]!;
  return KIND_TABS.find((tab) => tab.kinds.includes(activeSurface.kind)) ?? null;
}

type TabContextMenuAction = "copy-path" | "close" | "close-others" | "close-to-right" | "close-all";

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "agents":
      return "Agents";
    case "workflows":
      return "Workflows";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3 shrink-0" />}
      className="size-3 shrink-0 rounded-sm object-contain"
    />
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function SurfaceIcon({
  surface,
  sessions,
  desktopByTabId,
  theme,
  pullRequestStatuses,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  theme: "light" | "dark";
  pullRequestStatuses: Readonly<Record<string, PullRequestTabStatus>> | undefined;
}) {
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      const favicon = snapshot ? (desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
      const capturedUrl =
        favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
      return <PreviewFavicon capturedUrl={capturedUrl} url={url} />;
    }
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request": {
      const status = pullRequestStatuses?.[surface.id] ?? null;
      const toneClassName =
        status?.state === "merged"
          ? "text-violet-600 dark:text-violet-300/90"
          : status?.state === "closed"
            ? "text-red-600 dark:text-red-300/90"
            : status?.isDraft
              ? "text-zinc-500 dark:text-zinc-400/80"
              : status?.state === "open"
                ? "text-emerald-600 dark:text-emerald-300/90"
                : "text-muted-foreground";
      return <GitPullRequest className={cn("size-3 shrink-0", toneClassName)} />;
    }
    case "agents":
      return <Bot className="size-3 shrink-0" />;
    case "workflows":
      return <Workflow className="size-3 shrink-0" />;
  }
}

/** One closable surface tab: icon that turns into an X on hover, then the title. */
function SurfaceTab(props: {
  surface: RightPanelSurface;
  active: boolean;
  pending: boolean;
  title: string;
  icon: ReactNode;
  onActivate: () => void;
  onClose: () => void;
  onAuxClick: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const handleMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  return (
    <div
      data-active-tab={props.active}
      onMouseDown={handleMouseDown}
      onAuxClick={props.onAuxClick}
      onContextMenu={props.onContextMenu}
      className={cn(
        "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        className="cursor-pointer group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
        aria-label={`Close ${props.title}`}
        onClick={props.onClose}
      >
        <span className="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
          {props.icon}
          {props.pending ? (
            <span
              className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
              aria-hidden
            />
          ) : null}
        </span>
        <X className="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="cursor-pointer flex min-w-0 items-center"
              onClick={props.onActivate}
            >
              <span className="truncate">{props.title}</span>
            </button>
          }
        />
        <TooltipPopup>{props.title}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function KindTab(props: {
  definition: KindTabDefinition;
  active: boolean;
  available: boolean;
  onSelect: () => void;
}) {
  const Icon = props.definition.icon;
  const content = (
    <>
      <Icon className="size-3.5 shrink-0" />
      {/* Labels only once the panel is wide enough for all five to sit on one row. */}
      <span className="hidden @[26rem]/right-panel-tabs:inline">{props.definition.label}</span>
    </>
  );
  if (!props.available) {
    return (
      <DisabledReasonTooltip
        reason={props.definition.disabledReason ?? props.definition.label}
        trigger={
          <button
            type="button"
            aria-pressed={false}
            aria-disabled
            aria-label={props.definition.label}
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground opacity-40"
          >
            {content}
          </button>
        }
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={props.active}
            aria-label={props.definition.label}
            onClick={props.onSelect}
            className={cn(
              "cursor-pointer flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
              props.active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {content}
          </button>
        }
      />
      <TooltipPopup side="bottom">{props.definition.label}</TooltipPopup>
    </Tooltip>
  );
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const { resolvedTheme } = useTheme();
  const tabBarRef = useRef<HTMLDivElement>(null);
  const kindTabs = props.kindTabs ?? null;

  const activeSurface =
    props.surfaces.find((surface) => surface.id === props.activeSurfaceId) ?? null;
  const activeTab = kindTabs ? activeKindTab(activeSurface) : null;
  // Surfaces the kind tabs do not own (pull requests, agents) stay in the first row.
  const looseSurfaces = kindTabs
    ? props.surfaces.filter((surface) => !KIND_TAB_OWNED_KINDS.has(surface.kind))
    : props.surfaces;
  const instanceSurfaces =
    activeTab?.multiInstance === true
      ? props.surfaces.filter((surface) => activeTab.kinds.includes(surface.kind))
      : [];

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file") {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      items.push({ id: "close", label: "Close" });
      // With kind tabs, most open surfaces are not on screen, so the bulk
      // actions would close tabs the user cannot see.
      if (!props.kindTabs) {
        items.push(
          {
            id: "close-others",
            label: "Close others",
            disabled: props.surfaces.length <= 1,
          },
          {
            id: "close-to-right",
            label: "Close to the right",
            disabled: surfaceIndex >= props.surfaces.length - 1,
          },
          {
            id: "close-all",
            label: "Close all",
            disabled: props.surfaces.length === 0,
          },
        );
      }

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "copy-path":
          if (surface.kind === "file") props.onCopyFilePath(surface.relativePath);
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseSurface(surface);
    },
    [props],
  );

  useEffect(() => {
    const activeTabElement = tabBarRef.current?.querySelector<HTMLElement>(
      "[data-active-tab='true']",
    );
    activeTabElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId]);

  const renderSurfaceTab = (surface: RightPanelSurface) => (
    <SurfaceTab
      key={surface.id}
      surface={surface}
      active={surface.id === props.activeSurfaceId}
      pending={props.pendingSurfaceIds.has(surface.id)}
      title={surfaceTitle(surface, props.previewSessions, props.terminalLabelsById)}
      icon={
        <SurfaceIcon
          surface={surface}
          sessions={props.previewSessions}
          desktopByTabId={props.desktopByTabId}
          theme={resolvedTheme}
          pullRequestStatuses={props.pullRequestStatuses}
        />
      }
      onActivate={() => props.onActivate(surface)}
      onClose={() => props.onCloseSurface(surface)}
      onAuxClick={(event) => handleTabAuxClick(event, surface)}
      onContextMenu={(event) => void handleTabContextMenu(event, surface)}
    />
  );

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div ref={tabBarRef} className="flex shrink-0 flex-col" data-right-panel-tabbar>
        <div
          className={cn(
            "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
            // The sheet overlays from the viewport top, so its tab bar keeps
            // the titlebar's height: a compact row re-centers the layout
            // controls a few pixels higher and the cluster jumps on open.
            props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
            ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
            props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <ScrollArea
            hideScrollbars
            scrollFade
            className={cn(
              "@container/right-panel-tabs min-w-0 flex-1 rounded-none",
              ownsDesktopTitleBar && "drag-region",
            )}
            data-right-panel-tab-list
          >
            <div className="flex h-full w-max min-w-full items-center gap-1">
              {kindTabs
                ? KIND_TABS.map((definition) => (
                    <KindTab
                      key={definition.id}
                      definition={definition}
                      active={definition.id === activeTab?.id}
                      available={kindTabs[definition.id].available}
                      onSelect={kindTabs[definition.id].onSelect}
                    />
                  ))
                : null}
              {kindTabs && looseSurfaces.length > 0 ? (
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
              ) : null}
              {looseSurfaces.map(renderSurfaceTab)}
            </div>
          </ScrollArea>
          {props.layoutControls}
        </div>
        {instanceSurfaces.length > 0 ? (
          <ScrollArea
            hideScrollbars
            scrollFade
            className="h-7 min-h-7 shrink-0 rounded-none border-b border-border/60"
            data-right-panel-surface-tabs
          >
            <div className="flex h-full w-max min-w-full items-center gap-1 px-2">
              {instanceSurfaces.map(renderSurfaceTab)}
            </div>
          </ScrollArea>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.children}
      </div>
    </PreviewPanelShell>
  );
}
