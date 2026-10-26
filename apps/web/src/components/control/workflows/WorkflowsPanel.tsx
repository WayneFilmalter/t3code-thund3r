import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";
import {
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { requestConfirmDialog } from "~/confirmDialog";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useThreadShells, useThreadVisibleTurnItems } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  relativeLabel,
  scheduleLabel,
  ScheduledTaskEditorDialog,
} from "../../settings/ScheduledTasksSettings";
import { SettingsScopeProvider } from "../../settings/SettingsScopeContext";
import { WorkflowsSubheader } from "../../workflows/WorkflowsSubheader";
import {
  compareWorkflows,
  deriveWorkflowStatus,
  formatElapsed,
  START_DELAYS,
  type StartDelay,
  type WorkflowStatus,
  workflowSummary,
} from "./workflowsPanel.logic";

const NO_SHELLS = new Map<string, EnvironmentThreadShell>();

let secondNow = Date.now();
let secondTimer: number | null = null;
const secondListeners = new Set<() => void>();

function subscribeSecond(listener: () => void): () => void {
  secondListeners.add(listener);
  if (secondTimer === null) {
    secondNow = Date.now();
    secondTimer = window.setInterval(() => {
      secondNow = Date.now();
      for (const notify of secondListeners) notify();
    }, 1000);
  }
  return () => {
    secondListeners.delete(listener);
    if (secondListeners.size === 0 && secondTimer !== null) {
      window.clearInterval(secondTimer);
      secondTimer = null;
    }
  };
}

const subscribeNever = () => () => {};
const readSecond = () => secondNow;

/** The time, moving once a second while `active` so running times count up; idle panels stay still. */
function useNowSecond(active: boolean): number {
  return useSyncExternalStore(active ? subscribeSecond : subscribeNever, readSecond, readSecond);
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const failure = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: failure instanceof Error ? failure.message : String(failure),
  });
}

/**
 * Panel 3 of the Control window: saved prompts to run whenever you like. Each
 * is a scheduled task, so it runs on the server, starts a new thread per run,
 * and also shows in Settings → Scheduled tasks. Webhook tasks are left out;
 * they only run when their URL is called.
 */
export function WorkflowsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  const [editor, setEditor] = useState<{ task: ScheduledTask | null } | null>(null);
  const canEdit = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowsSubheader>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-foreground">
          Workflows
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={environmentId === null || !canEdit}
          onClick={() => setEditor({ task: null })}
        >
          <PlusIcon />
          New
        </Button>
      </WorkflowsSubheader>
      {environmentId === null ? (
        <p className="p-3 text-xs text-muted-foreground">No local server.</p>
      ) : (
        <WorkflowList
          environmentId={environmentId}
          onEdit={(task) => setEditor({ task })}
          onCreate={() => setEditor({ task: null })}
        />
      )}
      {editor !== null && environmentId !== null ? (
        <SettingsScopeProvider search={{}} onChange={() => {}} singleEnvironment>
          <ScheduledTaskEditorDialog
            key={editor.task?.id ?? "new"}
            initialEnvironmentId={environmentId}
            task={editor.task}
            initialScheduleMode="manual"
            onClose={() => setEditor(null)}
          />
        </SettingsScopeProvider>
      ) : null}
    </div>
  );
}

function WorkflowList(props: {
  environmentId: EnvironmentId;
  onEdit: (task: ScheduledTask) => void;
  onCreate: () => void;
}) {
  const { environmentId } = props;
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const runnable = useMemo(
    () => (tasks.data?.tasks ?? []).filter((task) => task.schedule.type !== "webhook"),
    [tasks.data],
  );
  const hasRuns = runnable.some((task) => task.lastRunThreadId != null);
  const shells = useThreadShells(hasRuns);
  const shellsById = useMemo(() => {
    if (!hasRuns) return NO_SHELLS;
    const byId = new Map<string, EnvironmentThreadShell>();
    for (const shell of shells) {
      if (shell.environmentId === environmentId) byId.set(shell.id, shell);
    }
    return byId;
  }, [environmentId, hasRuns, shells]);

  const entries = useMemo(
    () =>
      runnable
        .map((task) => {
          const shell =
            task.lastRunThreadId == null ? null : (shellsById.get(task.lastRunThreadId) ?? null);
          return { task, shell, status: deriveWorkflowStatus(task, shell) };
        })
        .sort(compareWorkflows),
    [runnable, shellsById],
  );

  // Timers and "last ran" move on with the shared minute clock; running times by the second.
  useNowMinute();
  const now = useNowSecond(entries.some((entry) => entry.status.active));

  if (tasks.data === null) {
    return (
      <p className="p-3 text-xs text-muted-foreground">{tasks.error ?? "Loading workflows…"}</p>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Save a prompt here and run it whenever you like, now or on a timer.
        </p>
        <Button size="sm" variant="outline" onClick={props.onCreate}>
          <PlusIcon />
          New workflow
        </Button>
      </div>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {entries.map(({ task, status }) => (
        <WorkflowItem
          key={task.id}
          environmentId={environmentId}
          task={task}
          status={status}
          now={now}
          onEdit={() => props.onEdit(task)}
        />
      ))}
    </ul>
  );
}

/**
 * The agent's latest line while a run is busy. It subscribes to the run's
 * thread only while the agent works, and keeps the last line it saw after.
 */
function useRunSummary(
  environmentId: EnvironmentId,
  task: ScheduledTask,
  status: WorkflowStatus,
): string | null {
  const threadId = task.lastRunThreadId ?? null;
  // While dispatching, the recorded thread is still the previous run's.
  const live = status.active && status.state !== "dispatching" && threadId !== null;
  const items = useThreadVisibleTurnItems(live ? { environmentId, threadId } : null);
  const current = useMemo(() => workflowSummary(items.map((row) => row.item)), [items]);
  const [kept, setKept] = useState<{ threadId: string; text: string } | null>(null);
  // Remembered during render, React's pattern for state that follows a changing value.
  if (
    current !== null &&
    threadId !== null &&
    (kept?.text !== current || kept.threadId !== threadId)
  ) {
    setKept({ threadId, text: current });
  }
  if (live) return current;
  return kept !== null && kept.threadId === threadId && status.state !== "dispatching"
    ? kept.text
    : null;
}

function statusLine(status: WorkflowStatus, now: number): { text: string; tone: string } | null {
  const elapsed = (to: number) =>
    status.startedAt === null ? "" : ` · ${formatElapsed(to - Date.parse(status.startedAt))}`;
  const finished = status.finishedAt === null ? now : Date.parse(status.finishedAt);
  switch (status.state) {
    case "idle":
      return null;
    case "dispatching":
      return { text: `Starting${elapsed(now)}`, tone: "text-info" };
    case "running":
      return { text: `Running${elapsed(now)}`, tone: "text-info" };
    case "waiting":
      return { text: `Waiting for you${elapsed(now)}`, tone: "text-warning" };
    case "done":
      return { text: `Finished${elapsed(finished)}`, tone: "text-success" };
    case "stopped":
      return { text: `Stopped${elapsed(finished)}`, tone: "text-muted-foreground" };
    case "failed":
      return { text: "Failed", tone: "text-destructive" };
  }
}

function WorkflowItem(props: {
  environmentId: EnvironmentId;
  task: ScheduledTask;
  status: WorkflowStatus;
  now: number;
  onEdit: () => void;
}) {
  const { environmentId, task, status, now } = props;
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "workflow run now",
  });
  const scheduleRun = useAtomCommand(serverEnvironment.scheduleScheduledTaskRun, {
    label: "workflow timer",
  });
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "workflow pause",
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "workflow delete",
  });
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, {
    label: "workflow stop",
  });
  const [delay, setDelay] = useState<StartDelay>("now");
  const [busy, setBusy] = useState(false);
  const summary = useRunSummary(environmentId, task, status);

  const id: ScheduledTaskId = task.id;
  const threadId = task.lastRunThreadId ?? null;
  const openThread = window.desktopBridge?.controlWindow?.openThread;
  const mode = status.active ? "stop" : status.timerAt !== null ? "cancel" : "start";
  const chosen = START_DELAYS.find((option) => option.value === delay) ?? START_DELAYS[0];

  const act = async (run: () => Promise<AtomCommandResult<unknown, unknown>>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {
      reportFailure(failure, await run());
    } finally {
      setBusy(false);
    }
  };

  const onPrimary = () => {
    if (mode === "stop") {
      if (threadId === null) return;
      void act(
        () => interrupt({ environmentId, input: { threadId } }),
        "Could not stop the workflow",
      );
    } else if (mode === "cancel") {
      void act(
        () => scheduleRun({ environmentId, input: { id, runAt: null } }),
        "Could not cancel the timer",
      );
    } else if (chosen.ms === 0) {
      void act(() => runNow({ environmentId, input: { id } }), "Could not start the workflow");
    } else {
      const runAt = new Date(Date.now() + chosen.ms).toISOString();
      // The timer counts from this press; the next start is "Now" again unless picked.
      setDelay("now");
      void act(
        () => scheduleRun({ environmentId, input: { id, runAt } }),
        "Could not set the timer",
      );
    }
  };

  const onDelete = async () => {
    const message = `Delete "${task.title}"?`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) {
      void act(() => remove({ environmentId, input: { id } }), "Could not delete the workflow");
    }
  };

  const meta = [
    task.lastRunAt ? `Last ran ${formatRelativeTimeLabel(task.lastRunAt)}` : "Never run",
    task.schedule.type === "manual" ? null : scheduleLabel(task.schedule),
    !task.enabled
      ? "Paused"
      : status.timerAt !== null
        ? `Runs ${relativeLabel(status.timerAt)}`
        : task.schedule.type !== "manual" && task.nextRunAt
          ? `Next ${relativeLabel(task.nextRunAt)}`
          : null,
  ].filter((part) => part !== null);
  const line = statusLine(status, now);
  const clickable = openThread !== undefined && threadId !== null;

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 py-2 pr-2 pl-3 transition-colors",
        clickable && "hover:bg-card",
        status.active && "border-info/50",
      )}
    >
      <button
        type="button"
        disabled={!clickable}
        aria-label={clickable ? `Open the last run of ${task.title}` : undefined}
        onClick={() => {
          if (openThread && threadId !== null) {
            void openThread({ environmentId, threadId }).catch(() => undefined);
          }
        }}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left enabled:cursor-pointer"
      >
        <span className="truncate text-sm leading-snug font-medium text-foreground">
          {task.title}
        </span>
        <span className="truncate text-2xs text-muted-foreground">{meta.join(" · ")}</span>
        {line !== null ? (
          <span className={cn("text-xs tabular-nums font-medium", line.tone)}>{line.text}</span>
        ) : null}
        {status.state === "failed" && task.lastRunError ? (
          <span className="line-clamp-2 text-xs text-destructive">{task.lastRunError}</span>
        ) : summary !== null ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span>
        ) : status.active ? (
          <span className="text-xs text-muted-foreground">Starting…</span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        {mode === "start" ? (
          <Select
            value={delay}
            onValueChange={(value) => {
              const next = START_DELAYS.find((option) => option.value === value);
              if (next) setDelay(next.value);
            }}
          >
            <SelectTrigger size="xs" aria-label={`When to run ${task.title}`}>
              <SelectValue>{chosen.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {START_DELAYS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.ms > 0 && !task.enabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <PrimaryButton
          mode={mode}
          disabled={
            !canOperate ||
            busy ||
            // Until the server has dispatched, the recorded thread is the previous run's.
            (mode === "stop" && (threadId === null || status.state === "dispatching"))
          }
          label={
            mode === "stop"
              ? `Stop ${task.title}`
              : mode === "cancel"
                ? `Cancel the timer for ${task.title}`
                : chosen.ms === 0
                  ? `Run ${task.title} now`
                  : `Run ${task.title} ${chosen.label.toLowerCase()}`
          }
          onClick={onPrimary}
        />
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={!canOperate || busy}
                aria-label={`Actions for ${task.title}`}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={props.onEdit}>
              <PencilIcon />
              Edit
            </MenuItem>
            <MenuItem
              onClick={() =>
                void act(
                  () => setEnabled({ environmentId, input: { id, enabled: !task.enabled } }),
                  task.enabled ? "Could not pause the workflow" : "Could not resume the workflow",
                )
              }
            >
              {task.enabled ? <PauseIcon /> : <PlayIcon />}
              {task.enabled ? "Pause" : "Resume"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => void onDelete()}>
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </li>
  );
}

const PRIMARY_TONES = {
  start: "bg-primary text-primary-foreground hover:bg-primary/90",
  stop: "bg-destructive text-white hover:bg-destructive/90",
  cancel: "border border-border bg-background text-foreground hover:bg-accent",
} as const;

/** The big round control at the item's right: ▶ start, ■ stop, ✕ cancel a timer. */
function PrimaryButton(props: {
  mode: keyof typeof PRIMARY_TONES;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = props.mode === "stop" ? SquareIcon : props.mode === "cancel" ? XIcon : PlayIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full shadow-xs transition-colors disabled:opacity-50",
              PRIMARY_TONES[props.mode],
            )}
          />
        }
      >
        <Icon className={cn("size-4", props.mode !== "cancel" && "fill-current")} />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{props.label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
