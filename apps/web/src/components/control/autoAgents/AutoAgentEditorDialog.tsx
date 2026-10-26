import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  type ModelSelection,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProviderInstanceId,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
  type ScheduledTaskUpsertSchedule,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { useProjects } from "~/state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { ProviderModelPicker } from "../../chat/ProviderModelPicker";
import { WorktreeBaseBranchPicker } from "../../WorktreeBaseBranchPicker";
import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
} from "../../settings/ScheduledTasksSettings";
import { scheduledTaskDefaultModel } from "../../settings/scheduledTasksSettings.logic";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../../settings/settingsLayout";
import { DELAY_PRESETS_MS, formatDelay } from "./autoAgentsPanel.logic";

type Mode = "timer" | "schedule";
type ScheduleKind = "fixed" | "interval";
type WorkspaceMode = OrchestrationV2ThreadLaunchWorkspaceStrategy["type"];

const CUSTOM_DELAY = "custom";
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const WORKSPACE_LABELS: Record<WorkspaceMode, string> = {
  worktree: "Create a new worktree",
  root: "Use the project checkout",
  existing_worktree: "Use a specific checkout",
};

interface Draft {
  readonly title: string;
  readonly prompt: string;
  readonly mode: Mode;
  /** A preset's milliseconds as text, or `custom`. */
  readonly delayChoice: string;
  readonly customHours: string;
  readonly customMinutes: string;
  readonly scheduleKind: ScheduleKind;
  readonly timeOfDay: string;
  readonly weekdays: ReadonlySet<number>;
  readonly intervalMinutes: string;
  readonly projectId: string;
  readonly workspaceMode: WorkspaceMode;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly worktreePath: string;
  /** `${instanceId}:${model}`, empty for the default model. */
  readonly modelKey: string;
}

function presetChoice(ms: number): string {
  return ms === 0 || DELAY_PRESETS_MS.some((preset) => preset === ms) ? String(ms) : CUSTOM_DELAY;
}

function draftFromAgent(agent: ScheduledTask | null, projectId: string): Draft {
  const schedule = agent?.schedule;
  const delay = agent?.startDelayMs ?? 0;
  const workspace = agent?.workspaceStrategy;
  return {
    title: agent?.title ?? "",
    prompt: agent?.prompt ?? "",
    mode: schedule === undefined || schedule.type === "manual" ? "timer" : "schedule",
    delayChoice: presetChoice(delay),
    customHours: String(Math.floor(delay / HOUR_MS)),
    customMinutes: String(Math.round((delay % HOUR_MS) / MINUTE_MS)),
    scheduleKind: schedule?.type === "interval" ? "interval" : "fixed",
    timeOfDay: schedule?.type === "fixed_time" ? schedule.timeOfDay : "09:00",
    weekdays: new Set(
      schedule?.type === "fixed_time" && schedule.weekdays?.length
        ? schedule.weekdays
        : [1, 2, 3, 4, 5],
    ),
    intervalMinutes:
      schedule?.type === "interval" ? String(Math.max(1, schedule.everyMs / MINUTE_MS)) : "60",
    projectId: agent?.projectId ?? projectId,
    workspaceMode: workspace?.type ?? "worktree",
    baseRef: workspace?.type === "worktree" ? workspace.baseRef : "main",
    startFromOrigin: workspace?.type === "worktree" ? (workspace.startFromOrigin ?? false) : true,
    worktreePath: workspace?.type === "existing_worktree" ? workspace.worktreePath : "",
    modelKey: agent ? `${agent.modelSelection.instanceId}:${agent.modelSelection.model}` : "",
  };
}

/** The delay the draft saves, or null when the custom hours and minutes are not valid. */
function draftDelayMs(draft: Draft): number | null {
  if (draft.delayChoice !== CUSTOM_DELAY) return Number(draft.delayChoice);
  const hours = Number(draft.customHours || "0");
  const minutes = Number(draft.customMinutes || "0");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0) {
    return null;
  }
  return hours * HOUR_MS + minutes * MINUTE_MS;
}

function draftSchedule(draft: Draft): ScheduledTaskUpsertSchedule | null {
  if (draft.mode === "timer") return { type: "manual" };
  if (draft.scheduleKind === "interval") {
    const everyMs = Math.round(Number(draft.intervalMinutes) * MINUTE_MS);
    return Number.isSafeInteger(everyMs) && everyMs >= MIN_SCHEDULED_TASK_INTERVAL_MS
      ? { type: "interval", everyMs }
      : null;
  }
  if (draft.weekdays.size === 0 || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(draft.timeOfDay)) {
    return null;
  }
  return {
    type: "fixed_time",
    timeOfDay: draft.timeOfDay,
    ...(draft.weekdays.size === 7 ? {} : { weekdays: [...draft.weekdays].toSorted() }),
  };
}

function splitModelKey(value: string): ModelSelection | null {
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) return null;
  return {
    instanceId: ProviderInstanceId.make(value.slice(0, index)),
    model: value.slice(index + 1),
  };
}

function Field(props: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
    </div>
  );
}

/**
 * Creates or edits an Auto Agent: a name and a prompt that run on a timer
 * from ▶, or on a schedule. Project, model and checkout start from the
 * defaults and sit under More options.
 */
export function AutoAgentEditorDialog(props: {
  environmentId: EnvironmentId;
  agent: ScheduledTask | null;
  onClose: () => void;
}) {
  const { environmentId, agent } = props;
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const [draft, setDraft] = useState(() => draftFromAgent(agent, projects[0]?.id ?? ""));
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const canSave = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "auto agent save",
  });

  const projectId = draft.projectId || projects[0]?.id || "";
  const project = projects.find((candidate) => candidate.id === projectId);
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(providers),
          settings,
          project?.id ?? null,
        ),
      ),
    [providers, settings, project?.id],
  );
  const picked = draft.modelKey ? splitModelKey(draft.modelKey) : null;
  const selection =
    picked &&
    instanceEntries.some((entry) => entry.instanceId === picked.instanceId && entry.enabled)
      ? picked
      : scheduledTaskDefaultModel(settings, project ?? null, instanceEntries);
  const activeInstanceId =
    selection?.instanceId ?? instanceEntries[0]?.instanceId ?? ProviderInstanceId.make("");
  const activeModel = selection?.model ?? "";
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers, activeInstanceId, activeModel),
    [settings, providers, activeInstanceId, activeModel],
  );

  const delayMs = draftDelayMs(draft);
  const schedule = draftSchedule(draft);
  const problem = !draft.title.trim()
    ? "Give the Auto Agent a name."
    : !draft.prompt.trim()
      ? "Write the prompt it runs."
      : project === undefined
        ? "Pick a project under More options."
        : selection === null
          ? "No model is available; pick one under More options."
          : delayMs === null
            ? "Enter whole hours and minutes for the delay."
            : schedule === null
              ? draft.scheduleKind === "interval"
                ? "Run it at most once a minute."
                : "Pick a time and at least one day."
              : draft.workspaceMode === "existing_worktree" && !draft.worktreePath.trim()
                ? "Enter the checkout path under More options."
                : null;

  const save = async () => {
    if (problem !== null || saving || selection === null || schedule === null || !project) return;
    // Keep the saved selection, with its provider options, while the model is unchanged.
    const modelSelection =
      agent &&
      agent.modelSelection.instanceId === selection.instanceId &&
      agent.modelSelection.model === selection.model
        ? agent.modelSelection
        : selection;
    const workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy =
      draft.workspaceMode === "root"
        ? { type: "root" }
        : draft.workspaceMode === "existing_worktree"
          ? { type: "existing_worktree", worktreePath: draft.worktreePath.trim() }
          : {
              type: "worktree",
              baseRef: draft.baseRef.trim() || "main",
              startFromOrigin: draft.startFromOrigin,
            };
    const input: ScheduledTaskUpsertInput = {
      ...(agent ? { id: agent.id, requireExisting: true } : { kind: "auto_agent" }),
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      enabled: agent?.enabled ?? true,
      schedule,
      startDelayMs: delayMs,
      projectId: project.id,
      threadId: null,
      workspaceStrategy,
      modelSelection,
      runtimeMode: agent?.runtimeMode ?? "full-access",
      interactionMode: agent?.interactionMode ?? "default",
      creationSource: "web",
    };
    setSaving(true);
    const result = await upsert({ environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not save the Auto Agent",
          description: failure instanceof Error ? failure.message : String(failure),
        });
      }
      return;
    }
    props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit Auto Agent" : "New Auto Agent"}</DialogTitle>
          <DialogDescription>
            A prompt you run when you like. Each run starts a new thread.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <fieldset disabled={saving} className="space-y-4">
            <Field label="Name" htmlFor="auto-agent-title">
              <Input
                id="auto-agent-title"
                placeholder="e.g. Sweep the backlog"
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
            <Field label="Prompt" htmlFor="auto-agent-prompt">
              <Textarea
                id="auto-agent-prompt"
                className="max-h-64 overflow-y-auto"
                rows={6}
                placeholder="What should the agent do each time it runs?"
                value={draft.prompt}
                onChange={(event) => update({ prompt: event.target.value })}
              />
            </Field>

            <div className="space-y-3">
              <ToggleGroup
                aria-label="When it runs"
                value={[draft.mode]}
                onValueChange={(values) => {
                  const mode = values[0];
                  if (mode === "timer" || mode === "schedule") update({ mode });
                }}
              >
                <Toggle value="timer">Timer</Toggle>
                <Toggle value="schedule">Schedule</Toggle>
              </ToggleGroup>
              <TimerFields draft={draft} update={update} />
              {draft.mode === "schedule" ? <ScheduleFields draft={draft} update={update} /> : null}
            </div>

            <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
              <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                <ChevronRightIcon className={cn(moreOpen && "rotate-90")} />
                More options
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="space-y-4 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Project" htmlFor="auto-agent-project">
                      <Select
                        value={projectId}
                        onValueChange={(value) => update({ projectId: value ?? "" })}
                      >
                        <SelectTrigger size="sm" id="auto-agent-project">
                          <SelectValue placeholder="Select a project">{project?.title}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {projects.map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.title}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </Field>
                    <Field label="Workspace" htmlFor="auto-agent-workspace">
                      <Select
                        value={draft.workspaceMode}
                        onValueChange={(value) => {
                          if (
                            value === "worktree" ||
                            value === "root" ||
                            value === "existing_worktree"
                          )
                            update({ workspaceMode: value });
                        }}
                      >
                        <SelectTrigger size="sm" id="auto-agent-workspace">
                          <SelectValue>{WORKSPACE_LABELS[draft.workspaceMode]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {(Object.keys(WORKSPACE_LABELS) as WorkspaceMode[]).map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {WORKSPACE_LABELS[mode]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </Field>
                  </div>
                  {draft.workspaceMode === "worktree" ? (
                    <Field label="Base branch" htmlFor="auto-agent-base-ref">
                      <WorktreeBaseBranchPicker
                        key={projectId}
                        id="auto-agent-base-ref"
                        environmentId={environmentId}
                        cwd={project?.workspaceRoot ?? null}
                        value={draft.baseRef}
                        onValueChange={(baseRef) => update({ baseRef })}
                        startFromOrigin={draft.startFromOrigin}
                        onStartFromOriginChange={(startFromOrigin) => update({ startFromOrigin })}
                        disabled={saving}
                      />
                    </Field>
                  ) : draft.workspaceMode === "existing_worktree" ? (
                    <Field label="Checkout path" htmlFor="auto-agent-checkout">
                      <Input
                        id="auto-agent-checkout"
                        placeholder="/path/to/checkout"
                        value={draft.worktreePath}
                        onChange={(event) => update({ worktreePath: event.target.value })}
                      />
                    </Field>
                  ) : null}
                  <Field label="Model">
                    <div>
                      <ProviderModelPicker
                        environmentId={environmentId}
                        disabled={saving}
                        activeInstanceId={activeInstanceId}
                        model={activeModel}
                        lockedProvider={null}
                        instanceEntries={instanceEntries}
                        modelOptionsByInstance={modelOptionsByInstance}
                        isComposerOwned={false}
                        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                        onInstanceModelChange={(instanceId, model) =>
                          update({ modelKey: `${instanceId}:${model}` })
                        }
                      />
                    </div>
                  </Field>
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </fieldset>
        </DialogPanel>
        <DialogFooter>
          {problem !== null && (draft.title || draft.prompt) ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">{problem}</p>
          ) : null}
          <DialogClose render={<Button variant="outline" size="sm" disabled={saving} />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            disabled={!canSave || saving || problem !== null}
            onClick={() => void save()}
          >
            {agent ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function TimerFields(props: { draft: Draft; update: (patch: Partial<Draft>) => void }) {
  const { draft, update } = props;
  const timer = draft.mode === "timer";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="auto-agent-delay">{timer ? "Runs" : "▶ runs it"}</Label>
        <Select
          value={draft.delayChoice}
          onValueChange={(value) => {
            if (value) update({ delayChoice: value });
          }}
        >
          <SelectTrigger size="sm" id="auto-agent-delay" className="w-auto">
            <SelectValue>
              {draft.delayChoice === CUSTOM_DELAY
                ? "After a custom time"
                : draft.delayChoice === "0"
                  ? "Straight away"
                  : `${formatDelay(Number(draft.delayChoice))} after ▶`}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="0">Straight away</SelectItem>
            {DELAY_PRESETS_MS.map((ms) => (
              <SelectItem key={ms} value={String(ms)}>
                {formatDelay(ms)} after ▶
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_DELAY}>After a custom time</SelectItem>
          </SelectPopup>
        </Select>
        {draft.delayChoice === CUSTOM_DELAY ? (
          <span className="flex items-center gap-1.5">
            <Input
              type="number"
              nativeInput
              min={0}
              aria-label="Hours"
              className="w-16"
              value={draft.customHours}
              onChange={(event) => update({ customHours: event.target.value })}
            />
            <span className="text-xs text-muted-foreground">h</span>
            <Input
              type="number"
              nativeInput
              min={0}
              max={59}
              aria-label="Minutes"
              className="w-16"
              value={draft.customMinutes}
              onChange={(event) => update({ customMinutes: event.target.value })}
            />
            <span className="text-xs text-muted-foreground">min</span>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {timer
          ? "Press ▶ to start the timer. You can change it on the Auto Agent before each run."
          : "Besides its schedule, ▶ runs it on this timer."}
      </p>
    </div>
  );
}

function ScheduleFields(props: { draft: Draft; update: (patch: Partial<Draft>) => void }) {
  const { draft, update } = props;
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <ToggleGroup
        variant="outline"
        size="sm"
        aria-label="Schedule type"
        value={[draft.scheduleKind]}
        onValueChange={(values) => {
          const kind = values[0];
          if (kind === "fixed" || kind === "interval") update({ scheduleKind: kind });
        }}
      >
        <Toggle value="fixed">At a time</Toggle>
        <Toggle value="interval">Every interval</Toggle>
      </ToggleGroup>
      {draft.scheduleKind === "fixed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="auto-agent-time">At</Label>
            <Input
              type="time"
              id="auto-agent-time"
              nativeInput
              className="w-32"
              value={draft.timeOfDay}
              onChange={(event) => update({ timeOfDay: event.target.value })}
            />
            <span className="text-xs text-muted-foreground">on</span>
          </div>
          <ToggleGroup
            multiple
            variant="outline"
            size="sm"
            aria-label="Days to run"
            value={[...draft.weekdays].map(String)}
            onValueChange={(values) => {
              if (values.length > 0) update({ weekdays: new Set(values.map(Number)) });
            }}
          >
            {WEEKDAY_ORDER.map((day) => (
              <Toggle key={day} value={String(day)} aria-label={WEEKDAY_LABELS[day]}>
                {WEEKDAY_SHORT[day]}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Label htmlFor="auto-agent-interval">Every</Label>
          <Input
            type="number"
            id="auto-agent-interval"
            nativeInput
            min={1}
            className="w-24"
            value={draft.intervalMinutes}
            onChange={(event) => update({ intervalMinutes: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">minutes</span>
        </div>
      )}
    </div>
  );
}
