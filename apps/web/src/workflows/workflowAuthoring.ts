/**
 * "Describe it to an agent": one agent turn drafts a workflow definition from a plain-language
 * description, and the builder opens with the result for review. The prompt teaches the node
 * shapes, the parser is tolerant (unknown fields dropped, enums coerced, defaults filled through
 * the store's `create*Node` helpers) and leaves correctness to the builder's validation.
 */
import type { ScopedProjectRef } from "@t3tools/contracts";

import {
  createActionNode,
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createGateNode,
  createPromptBlockNode,
  createReviewNode,
  createStartNode,
  type WorkflowActionPreset,
  type WorkflowDefinitionInput,
  type WorkflowDoneWhen,
  type WorkflowEnvMode,
  type WorkflowGateOnFail,
  type WorkflowInstanceThread,
  type WorkflowInteractionMode,
  type WorkflowLinearPreset,
  type WorkflowNode,
  type WorkflowOutputKind,
  type WorkflowReportFormat,
  type WorkflowSessionMode,
  type WorkflowStepOutput,
} from "~/workflowsStore";

import { extractLastFencedJson } from "./workflowRunner.logic";
import type { RunnerPorts } from "./workflowRunner.ports";

export const WORKFLOW_DRAFT_THREAD_TITLE = "⟲ Draft workflow";

const NODE_REFERENCE = `Node kinds (every node is an object with "kind" and the fields listed; omit what you do not need, defaults apply):
- start: { "kind": "start", "mode": "once" | "loop", "maxIterations"?: number, "pauseSeconds"?: number, "doneWhen"?: "source-empty" | "gate-pass" | "max-only" } — exactly one, first.
- agent: { "kind": "agent", "title": string, "prompt": string, "interactionMode"?: "default" | "plan", "session"?: "new" | "continue", "envMode"?: "default" | "local" | "worktree", "output"?: { "kind": "none" | "list" | "object", "hint"?: string }, "skills"?: string[] } — one agent turn. "plan" plans only and hands the plan to the next step. "continue" runs on the same thread as the previous step.
- linear-agent: { "kind": "linear-agent", "title": string, "preset": "find" | "update" | "custom", "prompt": string, "output"?: {...} } — an agent with Linear instructions baked in; "find" returns a list.
- fan-out: { "kind": "fan-out", "maxParallel"?: number, "laneEnvMode"?: "default" | "local" | "worktree", "lane": Node[] } — runs the lane once per item of the previous step's list output. The step before it must have output.kind "list". Lanes cannot contain another fan-out, start or end.
- gate: { "kind": "gate", "question": string, "onFail"?: { "kind": "stop" } | { "kind": "retry", "times": number } | { "kind": "continue" } } — asks the previous agent a pass/fail question.
- review: { "kind": "review", "instructions"?: string } — pauses until a human approves.
- action: { "kind": "action", "preset": "commit-pr" | "commit" | "comment-ticket" | "custom", "prompt"?: string, "session"?: "new" | "continue" } — a preset follow-up on the previous agent.
- prompt-block: { "kind": "prompt-block", "text": string, "placement"?: "before" | "after" } — not a step: text injected into the next agent's prompt.
- end: { "kind": "end", "format": "detailed" | "summary" | "caveman", "reportPrompt"?: string } — exactly one, last. How the final report should read.

Prompts may reference {{item}}, {{item.field}}, {{prev}} and {{iteration}}; when a prompt does not mention them the item and the previous output are appended automatically.`;

/** The message sent to the drafting agent. */
export function buildWorkflowAuthoringPrompt(description: string): string {
  return `You are drafting a T3 Code workflow: a top-down chain of steps that coding agents run in this repository. Read the description below, look around the codebase if it helps you write precise prompts, and reply with the workflow as JSON. Do not change any files.

${NODE_REFERENCE}

Definition shape:
{ "name": string, "description"?: string, "color"?: "#rrggbb", "sharedContext"?: string (prepended to every agent prompt), "nodes": Node[] }

Rules: keep it as small as the description allows; one agent step with a clear prompt is a perfectly good workflow. Write prompts that stand on their own — the agent running a step sees nothing but its prompt, the shared context, and the previous step's output.

Workflow to draft:
${description.trim()}

End your reply with a single fenced \`\`\`json block containing the definition object. Put nothing after that block.`;
}

export type WorkflowDraftParse =
  | { ok: true; input: WorkflowDefinitionInput }
  | { ok: false; error: string };

const ENV_MODES: readonly WorkflowEnvMode[] = ["default", "local", "worktree"];
const SESSION_MODES: readonly WorkflowSessionMode[] = ["new", "continue"];
const OUTPUT_KINDS: readonly WorkflowOutputKind[] = ["none", "list", "object"];
const INTERACTION_MODES: readonly WorkflowInteractionMode[] = ["default", "plan"];
const LINEAR_PRESETS: readonly WorkflowLinearPreset[] = ["find", "update", "custom"];
const ACTION_PRESETS: readonly WorkflowActionPreset[] = [
  "commit-pr",
  "commit",
  "comment-ticket",
  "custom",
];
const DONE_WHEN: readonly WorkflowDoneWhen[] = ["source-empty", "gate-pass", "max-only"];
const REPORT_FORMATS: readonly WorkflowReportFormat[] = ["detailed", "summary", "caveman"];

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
const defined = <T extends object>(partial: { [K in keyof T]?: T[K] | undefined }): Partial<T> =>
  Object.fromEntries(
    Object.entries(partial).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

function parseOutput(value: unknown) {
  if (!isRecord(value)) return undefined;
  const kind = oneOf(value.kind, OUTPUT_KINDS);
  if (!kind) return undefined;
  return { kind, hint: str(value.hint) };
}

function parseOnFail(value: unknown): WorkflowGateOnFail | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case "stop":
    case "continue":
      return { kind: value.kind };
    case "retry":
      return { kind: "retry", times: Math.max(1, Math.round(num(value.times) ?? 2)) };
    default:
      return undefined;
  }
}

/** One raw node to a store node, or the unknown kind it carried. */
function parseNode(raw: unknown, inLane: boolean): WorkflowNode | { unknownKind: string } {
  if (!isRecord(raw)) return { unknownKind: typeof raw };
  switch (raw.kind) {
    case "start":
      return createStartNode(
        defined({
          mode: oneOf(raw.mode, ["once", "loop"] as const),
          maxIterations: num(raw.maxIterations),
          pauseSeconds: num(raw.pauseSeconds),
          doneWhen: oneOf(raw.doneWhen, DONE_WHEN),
        }),
      );
    case "end":
      return createEndNode(
        defined({
          format: oneOf(raw.format, REPORT_FORMATS),
          reportPrompt: str(raw.reportPrompt ?? raw.prompt) || undefined,
        }),
      );
    case "agent":
    case "linear-agent":
      return createAgentNode(
        raw.kind,
        defined({
          title: str(raw.title) || undefined,
          prompt: str(raw.prompt),
          interactionMode: oneOf(raw.interactionMode, INTERACTION_MODES),
          preset: raw.kind === "linear-agent" ? oneOf(raw.preset, LINEAR_PRESETS) : undefined,
          session: oneOf(raw.session, SESSION_MODES),
          envMode: oneOf(raw.envMode, ENV_MODES),
          skills: Array.isArray(raw.skills)
            ? raw.skills.filter((skill): skill is string => typeof skill === "string")
            : undefined,
          output: parseOutput(raw.output),
        }),
      );
    case "fan-out": {
      if (inLane) return { unknownKind: "fan-out inside a lane" };
      const lane = Array.isArray(raw.lane) ? raw.lane : [];
      const parsed = lane.map((entry) => parseNode(entry, true));
      const bad = parsed.find((entry) => "unknownKind" in entry);
      if (bad && "unknownKind" in bad) return bad;
      return createFanOutNode(
        defined({
          maxParallel: num(raw.maxParallel),
          laneEnvMode: oneOf(raw.laneEnvMode, ENV_MODES),
          lane: parsed.filter((entry): entry is WorkflowNode => !("unknownKind" in entry)),
        }),
      );
    }
    case "gate":
      return createGateNode(
        defined({ question: str(raw.question ?? raw.prompt), onFail: parseOnFail(raw.onFail) }),
      );
    case "review":
      return createReviewNode(defined({ instructions: str(raw.instructions ?? raw.prompt) }));
    case "action":
      return createActionNode(
        defined({
          preset: oneOf(raw.preset, ACTION_PRESETS),
          prompt: str(raw.prompt),
          session: oneOf(raw.session, SESSION_MODES),
        }),
      );
    case "prompt-block":
    case "context":
      return createPromptBlockNode(
        defined({
          text: str(raw.text ?? raw.prompt),
          placement: oneOf(raw.placement, ["before", "after"] as const),
        }),
      );
    default:
      return { unknownKind: str(raw.kind, "missing kind") };
  }
}

/**
 * A definition input from the agent's final message. Start and Report are enforced at the
 * ends (added when missing, moved when misplaced); everything else is the builder's job.
 */
export function parseWorkflowDraft(output: WorkflowStepOutput): WorkflowDraftParse {
  if (output.kind !== "json") {
    return { ok: false, error: "The agent did not end with a fenced ```json block." };
  }
  const raw = output.value;
  if (!isRecord(raw)) return { ok: false, error: "The JSON block is not a workflow object." };
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const parsed = rawNodes.map((entry) => parseNode(entry, false));
  const unknown = parsed.filter(
    (entry): entry is { unknownKind: string } => "unknownKind" in entry,
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown step kind: ${[...new Set(unknown.map((entry) => entry.unknownKind))].join(", ")}.`,
    };
  }
  const nodes = parsed.filter((entry): entry is WorkflowNode => !("unknownKind" in entry));
  const start = nodes.find((node) => node.kind === "start") ?? createStartNode();
  const end = nodes.find((node) => node.kind === "end") ?? createEndNode();
  const middle = nodes.filter((node) => node.kind !== "start" && node.kind !== "end");
  return {
    ok: true,
    input: {
      name: str(raw.name).trim() || "New workflow",
      description: str(raw.description).trim() || null,
      ...(typeof raw.color === "string" ? { color: raw.color } : {}),
      sharedContext: str(raw.sharedContext),
      nodes: [start, ...middle, end],
    },
  };
}

export type WorkflowDraftResult =
  | { ok: true; input: WorkflowDefinitionInput }
  | { ok: false; error: string };

/**
 * Run the drafting turn on a fresh thread in the project and parse its reply. `onThread`
 * fires as soon as the thread exists so the UI can offer to open it. Aborting the signal stops
 * waiting and interrupts the turn; the thread itself stays.
 */
export async function draftWorkflowWithAgent(
  ports: RunnerPorts,
  projectRef: ScopedProjectRef,
  description: string,
  signal: AbortSignal,
  onThread: (thread: WorkflowInstanceThread) => void,
): Promise<WorkflowDraftResult> {
  const started = await ports.startAgent(
    {
      instanceKey: "draft",
      title: WORKFLOW_DRAFT_THREAD_TITLE,
      prompt: buildWorkflowAuthoringPrompt(description),
      modelSelection: null,
      interactionMode: "default",
      runtimeMode: "auto",
      envMode: "local",
      session: { kind: "new" },
    },
    projectRef,
  );
  if (!started.ok) return { ok: false, error: started.error };
  onThread(started.thread);
  const settled = await ports.waitForSettled(started.thread, signal);
  if (settled.kind === "aborted") {
    void ports.interrupt(started.thread);
    return { ok: false, error: "Cancelled." };
  }
  if (settled.kind === "deleted") return { ok: false, error: "The drafting thread was deleted." };
  if (settled.turnState !== "completed") {
    return {
      ok: false,
      error:
        settled.turnState === "interrupted" ? "The agent was interrupted." : "The agent errored.",
    };
  }
  const harvested = await ports.harvest(started.thread);
  return parseWorkflowDraft(extractLastFencedJson(harvested.text));
}
