/**
 * Pure stepping engine for workflow runs. `planRun` takes a run and returns the run with every
 * state change that needs no I/O already applied (start/context nodes done, fan-out lanes
 * scheduled or collected, review requested, iteration advanced) plus the side effects the
 * runner must perform (start an agent turn, arm a timer). Applying the effects and feeding
 * their results back through `completeInstance` / `failInstance` drives the run to a fixpoint.
 *
 * Nothing here touches atoms, timers, or the store, so every path is unit-testable.
 */
import type { ModelSelection, RuntimeMode } from "@t3tools/contracts";

import type {
  WorkflowActionNode,
  WorkflowAgentNode,
  WorkflowEndNode,
  WorkflowEnvMode,
  WorkflowFanOutNode,
  WorkflowGateNode,
  WorkflowInstanceThread,
  WorkflowNode,
  WorkflowNodeInstance,
  WorkflowOutputSpec,
  WorkflowRun,
  WorkflowStartNode,
  WorkflowStepOutput,
} from "~/workflowsStore";

import { workflowNodeTitle } from "./workflowNodeMeta";

export const OUTPUT_TEXT_CAP = 4_000;
export const RESULT_TEXT_CAP = 8_000;
export const FILES_CAP = 50;
export const THREAD_TITLE_CAP = 80;

export interface StartAgentRequest {
  instanceKey: string;
  title: string;
  prompt: string;
  /** `null` runs on the project's default model. */
  modelSelection: ModelSelection | null;
  runtimeMode: RuntimeMode;
  envMode: WorkflowEnvMode;
  session: { kind: "new" } | { kind: "continue"; thread: WorkflowInstanceThread };
}

export type RunnerEffect =
  | { type: "start-agent"; request: StartAgentRequest }
  | { type: "schedule-iteration"; at: string }
  | { type: "review-requested"; instanceKey: string }
  | { type: "run-finished"; status: "done" | "failed" };

export interface PlanResult {
  run: WorkflowRun;
  effects: RunnerEffect[];
}

export type AgentTurnNode =
  | WorkflowAgentNode
  | WorkflowActionNode
  | WorkflowGateNode
  | WorkflowEndNode;

interface ChainScope {
  keyOf: (nodeId: string) => string;
  item?: unknown;
  laneIndex?: number;
  envModeOverride?: WorkflowEnvMode;
}

type ChainState = "running" | "complete" | "failed";

interface ChainResult {
  state: ChainState;
  error?: string;
}

interface Planner {
  run: WorkflowRun;
  instances: Record<string, WorkflowNodeInstance>;
  effects: RunnerEffect[];
  now: string;
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Keys and lookups

export const instanceKeyFor = (nodeId: string, iteration: number, laneIndex?: number): string =>
  laneIndex === undefined ? `${nodeId}:${iteration}` : `${nodeId}:${iteration}:${laneIndex}`;

export function findStartNode(nodes: readonly WorkflowNode[]): WorkflowStartNode | null {
  return (nodes.find((node) => node.kind === "start") as WorkflowStartNode | undefined) ?? null;
}

export function findNode(nodes: readonly WorkflowNode[], nodeId: string): WorkflowNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.kind === "fan-out") {
      const inner = findNode(node.lane, nodeId);
      if (inner) return inner;
    }
  }
  return null;
}

/** Instances of the run's current iteration, in chain order (lanes flattened after their fan-out). */
export function currentIterationInstances(run: WorkflowRun): WorkflowNodeInstance[] {
  return Object.values(run.instances)
    .filter((instance) => instance.iteration === run.iteration)
    .sort((left, right) => (left.startedAt ?? "").localeCompare(right.startedAt ?? ""));
}

// ---------------------------------------------------------------------------
// Output parsing

const FENCED_JSON = /```(?:json|JSON)?[^\n]*\n([\s\S]*?)```/g;

/** The last fenced ```json block parsed, else the raw text (trimmed and capped). */
export function extractLastFencedJson(text: string): WorkflowStepOutput {
  let last: string | null = null;
  for (const match of text.matchAll(FENCED_JSON)) {
    last = match[1] ?? null;
  }
  if (last !== null) {
    try {
      return { kind: "json", value: JSON.parse(last.trim()) };
    } catch {
      // fall through to text
    }
  }
  const trimmed = text.trim();
  return {
    kind: "text",
    text: trimmed.length > OUTPUT_TEXT_CAP ? trimmed.slice(0, OUTPUT_TEXT_CAP) : trimmed,
  };
}

/** Null when the output satisfies the spec, else a message the instance fails with. */
export function validateExpected(
  output: WorkflowStepOutput,
  spec: WorkflowOutputSpec,
): string | null {
  if (spec.kind === "none") return null;
  if (output.kind !== "json") {
    return "The agent did not end with a fenced ```json block.";
  }
  if (spec.kind === "list" && !Array.isArray(output.value)) {
    return "Expected a JSON list, got something else.";
  }
  if (
    spec.kind === "object" &&
    (output.value === null || typeof output.value !== "object" || Array.isArray(output.value))
  ) {
    return "Expected a JSON object, got something else.";
  }
  return null;
}

export function outputAsText(output: WorkflowStepOutput | undefined): string {
  if (!output) return "";
  if (output.kind === "text") return output.text;
  if (typeof output.value === "string") return output.value;
  try {
    return JSON.stringify(output.value, null, 2);
  } catch {
    return String(output.value);
  }
}

export function outputAsList(output: WorkflowStepOutput | undefined): unknown[] | null {
  if (!output || output.kind !== "json" || !Array.isArray(output.value)) return null;
  return output.value;
}

/** A short handle for an item: identifier/title/name/id fields first, else its JSON. */
export function shortItemLabel(item: unknown, max = 40): string {
  let label: string;
  if (typeof item === "string") label = item;
  else if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const candidate = [record.identifier, record.key, record.title, record.name, record.id].find(
      (value) => (typeof value === "string" && value.trim()) || typeof value === "number",
    );
    label = candidate !== undefined ? String(candidate) : JSON.stringify(item);
  } else label = String(item);
  label = label.replace(/\s+/g, " ").trim();
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// ---------------------------------------------------------------------------
// Prompt compilation

export interface PromptVars {
  item?: unknown;
  prev?: WorkflowStepOutput | undefined;
  iteration: number;
  /** Set on gate retries: why the previous check failed. */
  previousFailure?: string;
}

const TEMPLATE_VAR = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;

function lookupPath(root: unknown, path: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function stringifyVar(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Replaces `{{item}}`, `{{item.field.sub}}`, `{{prev}}`, `{{iteration}}` in a template. */
export function renderTemplate(template: string, vars: PromptVars): string {
  const prevValue = vars.prev
    ? vars.prev.kind === "json"
      ? vars.prev.value
      : vars.prev.text
    : undefined;
  return template.replace(TEMPLATE_VAR, (whole, name: string) => {
    const [head, ...rest] = name.split(".");
    switch (head) {
      case "item":
        return stringifyVar(rest.length ? lookupPath(vars.item, rest) : vars.item);
      case "prev":
      case "previous":
      case "input":
        return stringifyVar(rest.length ? lookupPath(prevValue, rest) : prevValue);
      case "iteration":
        return String(vars.iteration + 1);
      default:
        return whole;
    }
  });
}

export function templateReferences(template: string, name: string): boolean {
  for (const match of template.matchAll(TEMPLATE_VAR)) {
    const head = (match[1] ?? "").split(".")[0];
    if (head === name) return true;
    if (name === "prev" && (head === "previous" || head === "input")) return true;
  }
  return false;
}

const LINEAR_FIND_INSTRUCTIONS = `You are working with Linear through the tools available to you (the Linear MCP server or CLI). Search for the tickets described below. For each ticket collect its id, identifier (like ABC-123), title, and URL. Do not modify any ticket in this step.`;

const LINEAR_UPDATE_INSTRUCTIONS = `You are working with Linear through the tools available to you (the Linear MCP server or CLI). Apply the changes described below to the ticket(s) involved — labels, comments, status, or assignee — and confirm exactly what you changed.`;

const ACTION_INSTRUCTIONS = {
  "commit-pr": `Commit the work in this thread's checkout with a clear conventional-commit style message, push the branch, and open a pull request against the repository's default branch. The PR body should describe the problem and the fix in a few sentences. Report the PR URL.`,
  commit: `Commit the work in this thread's checkout with a clear conventional-commit style message. Do not push. Report the commit subject.`,
  "comment-ticket": `Using Linear (MCP server or CLI), leave a concise comment on the ticket this work is for. Report which ticket you commented on.`,
  custom: "",
} as const;

export const GATE_SCHEMA_HINT = '{ "verdict": "pass" | "fail", "reason": string }';

export function outputInstructions(spec: WorkflowOutputSpec): string {
  if (spec.kind === "none") return "";
  const shape =
    spec.kind === "list"
      ? `a JSON array${spec.hint.trim() ? ` matching ${spec.hint.trim()}` : ""}`
      : `a JSON object${spec.hint.trim() ? ` matching ${spec.hint.trim()}` : ""}`;
  return `When you are completely finished, end your reply with a single fenced \`\`\`json block containing ${shape}. Put nothing after that block.`;
}

export interface CompilePromptInput {
  node: AgentTurnNode;
  sharedContext: string;
  promptBlocks: { before: string[]; after: string[] };
  vars: PromptVars;
  /** Skill names to invoke, rendered as `/name` on the first lines. */
  skills: readonly string[];
}

/** The full message text for an agent turn. Sections are joined by blank lines. */
export function compileAgentPrompt(input: CompilePromptInput): string {
  const { node, vars } = input;
  const parts: string[] = [];
  const skillLines = input.skills.map((skill) => `/${skill.replace(/^\//, "")}`);
  if (skillLines.length) parts.push(skillLines.join("\n"));
  if (input.sharedContext.trim()) parts.push(input.sharedContext.trim());
  for (const block of input.promptBlocks.before) if (block.trim()) parts.push(block.trim());

  let body = "";
  let output: WorkflowOutputSpec = { kind: "none", hint: "" };
  switch (node.kind) {
    case "agent":
      body = node.prompt;
      output = node.output;
      break;
    case "linear-agent":
      if (node.preset === "find") parts.push(LINEAR_FIND_INSTRUCTIONS);
      else if (node.preset === "update") parts.push(LINEAR_UPDATE_INSTRUCTIONS);
      body = node.prompt;
      output = node.output;
      break;
    case "action":
      if (ACTION_INSTRUCTIONS[node.preset]) parts.push(ACTION_INSTRUCTIONS[node.preset]);
      body = node.prompt;
      break;
    case "gate":
      parts.push(
        vars.previousFailure
          ? `The previous check failed: ${vars.previousFailure}\nFix what is wrong in this thread's work, then re-evaluate the check below honestly.`
          : `Evaluate the following check against the work and output before it. Be strict and honest.`,
      );
      body = `Check: ${node.question}`;
      output = { kind: "object", hint: GATE_SCHEMA_HINT };
      break;
    case "end":
      parts.push(
        `Write the final report for this workflow run. Do not make further changes; summarise.`,
      );
      body = node.reportPrompt;
      break;
  }

  const rendered = renderTemplate(body, vars).trim();
  if (rendered) parts.push(rendered);

  if (vars.item !== undefined && !templateReferences(body, "item")) {
    parts.push(`Item for this step:\n${stringifyVar(vars.item)}`);
  }
  if (vars.prev !== undefined && !templateReferences(body, "prev")) {
    const text = outputAsText(vars.prev).trim();
    if (text) parts.push(`Input from the previous step:\n${text}`);
  }
  for (const block of input.promptBlocks.after) if (block.trim()) parts.push(block.trim());
  const outputText = outputInstructions(output);
  if (outputText) parts.push(outputText);
  return parts.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Planning

/** Prompt blocks between the previous executing node and `index` in the chain. */
function collectPromptBlocks(chain: readonly WorkflowNode[], index: number) {
  const before: string[] = [];
  const after: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = chain[cursor]!;
    if (candidate.kind !== "prompt-block") break;
    if (candidate.placement === "before") before.unshift(candidate.text);
    else after.unshift(candidate.text);
  }
  return { before, after };
}

/** The nearest previous node in the chain that has run, with its instance. */
function previousDone(
  planner: Planner,
  chain: readonly WorkflowNode[],
  index: number,
  scope: ChainScope,
): { node: WorkflowNode; instance: WorkflowNodeInstance } | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = chain[cursor]!;
    if (candidate.kind === "prompt-block" || candidate.kind === "start") continue;
    const instance = planner.instances[scope.keyOf(candidate.id)];
    if (instance && (instance.status === "done" || instance.status === "skipped")) {
      return { node: candidate, instance };
    }
    return null;
  }
  return null;
}

/** The nearest previous instance in the chain that owns a thread the next node can continue. */
function previousThread(
  planner: Planner,
  chain: readonly WorkflowNode[],
  index: number,
  scope: ChainScope,
): WorkflowInstanceThread | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = chain[cursor]!;
    if (candidate.kind === "prompt-block" || candidate.kind === "start") continue;
    if (candidate.kind === "fan-out" || candidate.kind === "review") return null;
    const instance = planner.instances[scope.keyOf(candidate.id)];
    if (instance?.thread) return instance.thread;
  }
  return null;
}

function setInstance(planner: Planner, instance: WorkflowNodeInstance): void {
  planner.instances[instance.key] = instance;
  planner.changed = true;
}

function baseInstance(
  planner: Planner,
  node: WorkflowNode,
  scope: ChainScope,
): WorkflowNodeInstance {
  return {
    key: scope.keyOf(node.id),
    nodeId: node.id,
    iteration: planner.run.iteration,
    ...(scope.laneIndex !== undefined ? { index: scope.laneIndex } : {}),
    status: "pending",
    startedAt: planner.now,
  };
}

function agentRequestFor(
  planner: Planner,
  node: AgentTurnNode,
  chain: readonly WorkflowNode[],
  index: number,
  scope: ChainScope,
  attempt: number,
): StartAgentRequest {
  const key = scope.keyOf(node.id);
  const prev = previousDone(planner, chain, index, scope);
  const previousFailure =
    node.kind === "gate" && attempt > 0
      ? (planner.instances[key]?.error ?? "the check did not pass")
      : undefined;
  const vars: PromptVars = {
    ...(scope.item !== undefined ? { item: scope.item } : {}),
    prev: prev?.instance.output,
    iteration: planner.run.iteration,
    ...(previousFailure ? { previousFailure } : {}),
  };
  const skills = node.kind === "agent" || node.kind === "linear-agent" ? node.skills : [];
  const prompt = compileAgentPrompt({
    node,
    sharedContext: planner.run.snapshot.sharedContext,
    promptBlocks: collectPromptBlocks(chain, index),
    vars,
    skills,
  });
  const wantsContinue =
    node.kind === "gate" || node.kind === "end" ? true : node.session === "continue";
  const thread = wantsContinue ? previousThread(planner, chain, index, scope) : null;
  const modelSelection =
    node.kind === "agent" || node.kind === "linear-agent" || node.kind === "gate"
      ? node.modelSelection
      : null;
  const runtimeMode: RuntimeMode =
    node.kind === "agent" || node.kind === "linear-agent" ? node.runtimeMode : "full-access";
  const envMode: WorkflowEnvMode =
    scope.envModeOverride ??
    (node.kind === "agent" || node.kind === "linear-agent" ? node.envMode : "default");
  const itemLabel = scope.item !== undefined ? shortItemLabel(scope.item) : "";
  const title = truncate(
    `⟲ ${planner.run.name} · ${workflowNodeTitle(node)}${itemLabel ? ` · ${itemLabel}` : ""}`,
    THREAD_TITLE_CAP,
  );
  return {
    instanceKey: key,
    title,
    prompt,
    modelSelection,
    runtimeMode,
    envMode,
    session: thread ? { kind: "continue", thread } : { kind: "new" },
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Steps a lane's chain and reports how far it got. */
function laneState(planner: Planner, lane: readonly WorkflowNode[], scope: ChainScope) {
  let started = false;
  let failed = false;
  let allDone = lane.length > 0;
  for (const node of lane) {
    const instance = planner.instances[scope.keyOf(node.id)];
    if (instance) started = true;
    if (instance?.status === "failed") failed = true;
    if (!instance || (instance.status !== "done" && instance.status !== "skipped")) allDone = false;
  }
  return { started, failed, complete: !failed && allDone };
}

function stepFanOut(
  planner: Planner,
  node: WorkflowFanOutNode,
  chain: readonly WorkflowNode[],
  index: number,
  scope: ChainScope,
): ChainResult {
  const key = scope.keyOf(node.id);
  const source = previousDone(planner, chain, index, scope);
  const items = outputAsList(source?.instance.output);
  const existing = planner.instances[key];
  if (!existing || existing.status === "pending") {
    if (items === null) {
      setInstance(planner, {
        ...baseInstance(planner, node, scope),
        status: "failed",
        error: "For each needs a list from the step before it.",
        finishedAt: planner.now,
      });
      return { state: "failed", error: "For each needs a list from the step before it." };
    }
    if (items.length === 0) {
      setInstance(planner, {
        ...baseInstance(planner, node, scope),
        status: "done",
        output: { kind: "json", value: [] },
        finishedAt: planner.now,
      });
      return { state: "complete" };
    }
    setInstance(planner, { ...baseInstance(planner, node, scope), status: "running" });
  } else if (existing.status === "done" || existing.status === "skipped") {
    return { state: "complete" };
  } else if (existing.status === "failed") {
    return { state: "failed", error: existing.error ?? "For each failed." };
  }
  if (items === null) return { state: "failed", error: "For each lost its source list." };

  let active = 0;
  const laneScopes = items.map((item, laneIndex) => ({
    keyOf: (nodeId: string) => instanceKeyFor(nodeId, planner.run.iteration, laneIndex),
    item,
    laneIndex,
    ...(node.laneEnvMode !== "default" ? { envModeOverride: node.laneEnvMode } : {}),
  }));
  const states = laneScopes.map((laneScope) => laneState(planner, node.lane, laneScope));
  for (const state of states) {
    if (state.started && !state.complete && !state.failed) active += 1;
  }
  let allTerminal = true;
  laneScopes.forEach((laneScope, laneIndex) => {
    const state = states[laneIndex]!;
    if (state.complete || state.failed) return;
    if (state.started) {
      const result = stepChain(planner, node.lane, laneScope);
      if (result.state === "running") allTerminal = false;
      if (result.state === "failed") markLaneRemainingSkipped(planner, node.lane, laneScope);
      return;
    }
    if (active < node.maxParallel) {
      active += 1;
      const result = stepChain(planner, node.lane, laneScope);
      if (result.state === "running") allTerminal = false;
      if (result.state === "failed") markLaneRemainingSkipped(planner, node.lane, laneScope);
      return;
    }
    allTerminal = false;
  });
  if (!allTerminal) return { state: "running" };

  const results = laneScopes.map((laneScope, laneIndex) => {
    const last = node.lane.toReversed().find((laneNode) => laneNode.kind !== "prompt-block");
    const lastInstance = last ? planner.instances[laneScope.keyOf(last.id)] : undefined;
    const failedInstance = node.lane
      .map((laneNode) => planner.instances[laneScope.keyOf(laneNode.id)])
      .find((instance) => instance?.status === "failed");
    return {
      item: items[laneIndex],
      ...(failedInstance ? { error: failedInstance.error ?? "failed" } : {}),
      ...(lastInstance?.output
        ? {
            output:
              lastInstance.output.kind === "json"
                ? lastInstance.output.value
                : lastInstance.output.text,
          }
        : {}),
    };
  });
  setInstance(planner, {
    ...(planner.instances[key] ?? baseInstance(planner, node, scope)),
    status: "done",
    output: { kind: "json", value: results },
    finishedAt: planner.now,
  });
  return { state: "complete" };
}

function markLaneRemainingSkipped(
  planner: Planner,
  lane: readonly WorkflowNode[],
  scope: ChainScope,
) {
  for (const node of lane) {
    const key = scope.keyOf(node.id);
    if (!planner.instances[key]) {
      setInstance(planner, {
        ...baseInstance(planner, node, scope),
        status: "skipped",
        finishedAt: planner.now,
      });
    }
  }
}

function stepChain(
  planner: Planner,
  chain: readonly WorkflowNode[],
  scope: ChainScope,
): ChainResult {
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]!;
    const key = scope.keyOf(node.id);
    const instance = planner.instances[key];

    if (node.kind === "fan-out") {
      const result = stepFanOut(planner, node, chain, index, scope);
      if (result.state !== "complete") return result;
      continue;
    }

    if (instance?.status === "done" || instance?.status === "skipped") {
      if (node.kind === "gate") {
        const verdict = gateVerdict(instance);
        if (verdict === "fail") {
          if (node.onFail.kind === "continue") continue;
          if (node.onFail.kind === "retry" && (instance.attempt ?? 0) < node.onFail.times) {
            const { finishedAt: _finishedAt, ...retrying } = instance;
            setInstance(planner, {
              ...retrying,
              status: "pending",
              attempt: (instance.attempt ?? 0) + 1,
              error: gateReason(instance),
              startedAt: planner.now,
            });
            index -= 1;
            continue;
          }
          const error = `Check failed: ${gateReason(instance)}`;
          setInstance(planner, { ...instance, status: "failed", error, finishedAt: planner.now });
          return { state: "failed", error };
        }
      }
      continue;
    }
    if (instance?.status === "running" || instance?.status === "waiting-review") {
      return { state: "running" };
    }
    if (instance?.status === "failed") {
      return { state: "failed", error: instance.error ?? `${workflowNodeTitle(node)} failed.` };
    }

    // pending or not yet created
    switch (node.kind) {
      case "start":
      case "prompt-block":
        setInstance(planner, {
          ...baseInstance(planner, node, scope),
          status: "done",
          finishedAt: planner.now,
        });
        continue;
      case "review": {
        const prev = previousDone(planner, chain, index, scope);
        setInstance(planner, { ...baseInstance(planner, node, scope), status: "waiting-review" });
        planner.run = {
          ...planner.run,
          status: "review",
          review: {
            instanceKey: key,
            summary: node.instructions.trim() || outputAsText(prev?.instance.output).slice(0, 400),
          },
        };
        planner.effects.push({ type: "review-requested", instanceKey: key });
        return { state: "running" };
      }
      case "end": {
        if (!node.reportPrompt.trim()) {
          const prev = previousDone(planner, chain, index, scope);
          const text = truncate(outputAsText(prev?.instance.output), RESULT_TEXT_CAP);
          setInstance(planner, {
            ...baseInstance(planner, node, scope),
            status: "done",
            ...(text ? { output: { kind: "text", text } } : {}),
            finishedAt: planner.now,
          });
          planner.run = { ...planner.run, result: text || null };
          continue;
        }
        const request = agentRequestFor(planner, node, chain, index, scope, 0);
        setInstance(planner, { ...baseInstance(planner, node, scope), status: "running" });
        planner.effects.push({ type: "start-agent", request });
        return { state: "running" };
      }
      case "agent":
      case "linear-agent":
      case "action":
      case "gate": {
        const attempt = instance?.attempt ?? 0;
        const request = agentRequestFor(planner, node, chain, index, scope, attempt);
        setInstance(planner, {
          ...(instance ?? baseInstance(planner, node, scope)),
          status: "running",
          startedAt: planner.now,
          ...(attempt ? { attempt } : {}),
        });
        planner.effects.push({ type: "start-agent", request });
        return { state: "running" };
      }
    }
  }
  return { state: "complete" };
}

function gateVerdict(instance: WorkflowNodeInstance): "pass" | "fail" {
  const value = instance.output?.kind === "json" ? instance.output.value : null;
  const verdict =
    value && typeof value === "object" ? (value as { verdict?: unknown }).verdict : undefined;
  return typeof verdict === "string" && verdict.toLowerCase().startsWith("pass") ? "pass" : "fail";
}

function gateReason(instance: WorkflowNodeInstance): string {
  const value = instance.output?.kind === "json" ? instance.output.value : null;
  const reason =
    value && typeof value === "object" ? (value as { reason?: unknown }).reason : undefined;
  return typeof reason === "string" && reason.trim() ? reason.trim() : "no reason given";
}

/** Whether the run should start another iteration after finishing this one. */
export function shouldIterate(run: WorkflowRun): boolean {
  const start = findStartNode(run.snapshot.nodes);
  if (!start || start.mode !== "loop") return false;
  if (run.iteration + 1 >= start.maxIterations) return false;
  switch (start.doneWhen) {
    case "max-only":
      return true;
    case "source-empty": {
      const source = firstListSource(run);
      if (source === null) return true;
      return source.length > 0;
    }
    case "gate-pass": {
      const passed = currentIterationInstances(run).some((instance) => {
        const node = findNode(run.snapshot.nodes, instance.nodeId);
        return (
          node?.kind === "gate" && instance.status === "done" && gateVerdict(instance) === "pass"
        );
      });
      return !passed;
    }
  }
}

/** The list the current iteration's first fan-out ran over (or the first list output). */
function firstListSource(run: WorkflowRun): unknown[] | null {
  for (const node of run.snapshot.nodes) {
    if (node.kind !== "agent" && node.kind !== "linear-agent") continue;
    if (node.output.kind !== "list") continue;
    const instance = run.instances[instanceKeyFor(node.id, run.iteration)];
    const list = outputAsList(instance?.output);
    if (list !== null) return list;
    return null;
  }
  return null;
}

/** Drop instances older than the previous iteration so looping runs stay small. */
export function pruneOldIterations(run: WorkflowRun): WorkflowRun {
  const keep = run.iteration - 1;
  const instances: Record<string, WorkflowNodeInstance> = {};
  for (const [key, instance] of Object.entries(run.instances)) {
    if (instance.iteration >= keep) instances[key] = instance;
  }
  return { ...run, instances };
}

/**
 * Advance a run as far as it can go without I/O. Idempotent for instances that are already
 * running: they produce no effects until `completeInstance`/`failInstance` settle them.
 */
export function planRun(input: WorkflowRun, now: string): PlanResult {
  if (input.status !== "in-progress" && input.status !== "review") {
    return { run: input, effects: [] };
  }
  if (input.status === "review" || input.pausedAt !== null) {
    return { run: input, effects: [] };
  }
  let run = input;
  if (run.nextIterationAt) {
    if (run.nextIterationAt > now) {
      return { run, effects: [{ type: "schedule-iteration", at: run.nextIterationAt }] };
    }
    run = { ...run, nextIterationAt: null };
  }
  const planner: Planner = {
    run,
    instances: { ...run.instances },
    effects: [],
    now,
    changed: run !== input,
  };
  const scope: ChainScope = { keyOf: (nodeId) => instanceKeyFor(nodeId, run.iteration) };
  const result = stepChain(planner, run.snapshot.nodes, scope);
  let next: WorkflowRun = { ...planner.run, instances: planner.instances };
  if (result.state === "failed") {
    next = { ...next, status: "failed", lastError: result.error ?? null, finishedAt: now };
    planner.effects.push({ type: "run-finished", status: "failed" });
  } else if (result.state === "complete") {
    if (shouldIterate(next)) {
      const start = findStartNode(next.snapshot.nodes)!;
      const at = new Date(Date.parse(now) + start.pauseSeconds * 1_000).toISOString();
      next = pruneOldIterations({ ...next, iteration: next.iteration + 1, nextIterationAt: at });
      planner.effects.push({ type: "schedule-iteration", at });
    } else {
      next = { ...next, status: "done", finishedAt: now };
      planner.effects.push({ type: "run-finished", status: "done" });
    }
  }
  return { run: next, effects: planner.effects };
}

// ---------------------------------------------------------------------------
// Settling instances after I/O

export interface HarvestedTurn {
  text: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  turnState: "completed" | "interrupted" | "error";
}

/** Apply a settled agent turn to its instance: parse output, validate, mark done or failed. */
export function completeInstance(
  run: WorkflowRun,
  instanceKey: string,
  harvested: HarvestedTurn,
  now: string,
): WorkflowRun {
  const instance = run.instances[instanceKey];
  if (!instance) return run;
  const node = findNode(run.snapshot.nodes, instance.nodeId);
  const output = extractLastFencedJson(harvested.text);
  const files = harvested.files.slice(0, FILES_CAP);
  if (harvested.turnState !== "completed") {
    return withInstance(run, {
      ...instance,
      status: "failed",
      error:
        harvested.turnState === "interrupted" ? "The agent was interrupted." : "The agent errored.",
      output,
      files,
      finishedAt: now,
    });
  }
  const spec: WorkflowOutputSpec =
    node?.kind === "agent" || node?.kind === "linear-agent"
      ? node.output
      : node?.kind === "gate"
        ? { kind: "object", hint: GATE_SCHEMA_HINT }
        : { kind: "none", hint: "" };
  const problem = validateExpected(output, spec);
  const done: WorkflowNodeInstance = {
    ...instance,
    status: problem ? "failed" : "done",
    ...(problem ? { error: problem } : {}),
    output,
    files,
    finishedAt: now,
  };
  let next = withInstance(run, done);
  if (node?.kind === "end" && !problem) {
    next = { ...next, result: truncate(outputAsText(output), RESULT_TEXT_CAP) || null };
  }
  return next;
}

export function failInstance(
  run: WorkflowRun,
  instanceKey: string,
  error: string,
  now: string,
): WorkflowRun {
  const instance = run.instances[instanceKey];
  if (!instance) return run;
  return withInstance(run, { ...instance, status: "failed", error, finishedAt: now });
}

export function attachThread(
  run: WorkflowRun,
  instanceKey: string,
  thread: WorkflowInstanceThread,
): WorkflowRun {
  const instance = run.instances[instanceKey];
  if (!instance) return run;
  return withInstance(run, { ...instance, thread });
}

function withInstance(run: WorkflowRun, instance: WorkflowNodeInstance): WorkflowRun {
  return { ...run, instances: { ...run.instances, [instance.key]: instance } };
}

/** Approve the pending review: its instance is done and the run continues. */
export function approveReview(run: WorkflowRun, now: string): WorkflowRun {
  if (!run.review) return run;
  const instance = run.instances[run.review.instanceKey];
  const next: WorkflowRun = { ...run, status: "in-progress", review: null };
  return instance ? withInstance(next, { ...instance, status: "done", finishedAt: now }) : next;
}

/** Reject the pending review: the run is cancelled where it stands. */
export function rejectReview(run: WorkflowRun, now: string): WorkflowRun {
  if (!run.review) return run;
  const instance = run.instances[run.review.instanceKey];
  const next: WorkflowRun = {
    ...run,
    status: "cancelled",
    review: null,
    finishedAt: now,
    lastError: "Rejected in review.",
  };
  return instance
    ? withInstance(next, { ...instance, status: "failed", error: "Rejected", finishedAt: now })
    : next;
}

/** Pause: nothing new is dispatched until resumed; agents already running settle normally. */
export function pauseRun(run: WorkflowRun, now: string): WorkflowRun {
  if (run.status !== "in-progress" || run.pausedAt !== null) return run;
  return { ...run, pausedAt: now };
}

export function resumeRun(run: WorkflowRun): WorkflowRun {
  if (run.pausedAt === null) return run;
  return { ...run, pausedAt: null };
}

/** Cancel: every unfinished instance is skipped/failed and the run is put away. */
export function cancelRun(run: WorkflowRun, now: string): WorkflowRun {
  const instances: Record<string, WorkflowNodeInstance> = {};
  for (const [key, instance] of Object.entries(run.instances)) {
    instances[key] =
      instance.status === "running" ||
      instance.status === "waiting-review" ||
      instance.status === "pending"
        ? { ...instance, status: "skipped", finishedAt: now }
        : instance;
  }
  return {
    ...run,
    instances,
    status: "cancelled",
    review: null,
    nextIterationAt: null,
    finishedAt: now,
    lastError: "Stopped.",
  };
}

/** Threads currently running for the run: what Stop has to interrupt. */
export function runningThreads(run: WorkflowRun): WorkflowInstanceThread[] {
  return Object.values(run.instances)
    .filter((instance) => instance.status === "running" && instance.thread)
    .map((instance) => instance.thread!);
}
