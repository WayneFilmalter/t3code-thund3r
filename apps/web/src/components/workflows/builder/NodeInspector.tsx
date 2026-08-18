import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { canMoveNode } from "~/workflows/graphEdits";
import {
  WORKFLOW_ACTION_PRESET_LABELS,
  WORKFLOW_LINEAR_PRESET_LABELS,
  WORKFLOW_NODE_META,
} from "~/workflows/workflowNodeMeta";
import type {
  WorkflowActionNode,
  WorkflowAgentNode,
  WorkflowDefinition,
  WorkflowEndNode,
  WorkflowFanOutNode,
  WorkflowGateNode,
  WorkflowNode,
  WorkflowPromptBlockNode,
  WorkflowReviewNode,
  WorkflowStartNode,
} from "~/workflowsStore";

import { NODE_ICONS } from "./nodeIcons";
import {
  ENV_MODE_OPTIONS,
  InspectorField,
  InspectorSelect,
  RUNTIME_MODE_OPTIONS,
  SESSION_OPTIONS,
} from "./inspectorFields";
import { ModelSelectionField } from "./ModelSelectionField";
import { SkillsField } from "./SkillsField";

const TEMPLATE_HINT =
  "Use {{item}}, {{item.field}}, {{prev}} and {{iteration}} to reference inputs.";

export interface NodeInspectorProps {
  nodes: readonly WorkflowNode[];
  node: WorkflowNode;
  /** Start node edits the workflow-level fields too. */
  definition: Pick<WorkflowDefinition, "description" | "sharedContext">;
  issues: readonly string[];
  onUpdateNode: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onUpdateDefinition: (
    patch: Partial<Pick<WorkflowDefinition, "description" | "sharedContext">>,
  ) => void;
  onMove: (nodeId: string, direction: -1 | 1) => void;
  onRemove: (nodeId: string) => void;
}

/** The selected node's settings, one editor per kind, with move/delete in the header. */
export function NodeInspector(props: NodeInspectorProps) {
  const meta = WORKFLOW_NODE_META[props.node.kind];
  const Icon = NODE_ICONS[props.node.kind];
  const removable = props.node.kind !== "start" && props.node.kind !== "end";
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-lg border"
          style={{ borderColor: meta.accent, color: meta.accent }}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{meta.label}</span>
        {removable ? (
          <>
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Move step up"
              disabled={!canMoveNode(props.nodes, props.node.id, -1)}
              onClick={() => props.onMove(props.node.id, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Move step down"
              disabled={!canMoveNode(props.nodes, props.node.id, 1)}
              onClick={() => props.onMove(props.node.id, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Delete step"
              onClick={() => props.onRemove(props.node.id)}
            >
              <Trash2Icon />
            </Button>
          </>
        ) : null}
      </div>
      {props.issues.length > 0 ? (
        <ul className="rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          {props.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <NodeEditor {...props} />
    </div>
  );
}

function NodeEditor(props: NodeInspectorProps) {
  const update = <TNode extends WorkflowNode>(patch: Partial<TNode>) =>
    props.onUpdateNode(props.node.id, patch as Partial<WorkflowNode>);
  switch (props.node.kind) {
    case "start":
      return (
        <StartEditor
          node={props.node}
          update={update}
          definition={props.definition}
          onUpdateDefinition={props.onUpdateDefinition}
        />
      );
    case "agent":
    case "linear-agent":
      return <AgentEditor node={props.node} update={update} />;
    case "fan-out":
      return <FanOutEditor node={props.node} update={update} />;
    case "gate":
      return <GateEditor node={props.node} update={update} />;
    case "review":
      return <ReviewEditor node={props.node} update={update} />;
    case "action":
      return <ActionEditor node={props.node} update={update} />;
    case "prompt-block":
      return <PromptBlockEditor node={props.node} update={update} />;
    case "end":
      return <EndEditor node={props.node} update={update} />;
  }
}

type Update<TNode extends WorkflowNode> = (patch: Partial<TNode>) => void;

function StartEditor(props: {
  node: WorkflowStartNode;
  update: Update<WorkflowStartNode>;
  definition: Pick<WorkflowDefinition, "description" | "sharedContext">;
  onUpdateDefinition: NodeInspectorProps["onUpdateDefinition"];
}) {
  const { node, update } = props;
  return (
    <>
      <InspectorField label="Description" hint="One line shown on the workflow's bubble.">
        <Input
          value={props.definition.description ?? ""}
          className="h-8"
          onChange={(event) => props.onUpdateDefinition({ description: event.target.value })}
        />
      </InspectorField>
      <InspectorField
        label="Shared context"
        hint="Injected at the top of every agent prompt in this workflow."
      >
        <Textarea
          value={props.definition.sharedContext}
          rows={4}
          className="font-mono text-xs"
          onChange={(event) => props.onUpdateDefinition({ sharedContext: event.target.value })}
        />
      </InspectorField>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Loop (Ralph-style)</span>
        <Switch
          checked={node.mode === "loop"}
          aria-label="Loop"
          onCheckedChange={(checked) => update({ mode: checked ? "loop" : "once" })}
        />
      </label>
      {node.mode === "loop" ? (
        <>
          <InspectorField label="Stop when">
            <InspectorSelect
              ariaLabel="Stop when"
              value={node.doneWhen}
              options={[
                { value: "source-empty", label: "The first list step returns nothing" },
                { value: "gate-pass", label: "A check passes" },
                { value: "max-only", label: "Max iterations reached" },
              ]}
              onChange={(doneWhen) => update({ doneWhen })}
            />
          </InspectorField>
          <div className="grid grid-cols-2 gap-2">
            <InspectorField label="Max iterations">
              <NumberField
                value={node.maxIterations}
                min={1}
                max={500}
                size="sm"
                onValueCommitted={(value) =>
                  update({ maxIterations: Math.max(1, Math.round(value ?? 1)) })
                }
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label="Max iterations" />
                </NumberFieldGroup>
              </NumberField>
            </InspectorField>
            <InspectorField label="Pause (seconds)">
              <NumberField
                value={node.pauseSeconds}
                min={0}
                max={86_400}
                size="sm"
                onValueCommitted={(value) =>
                  update({ pauseSeconds: Math.max(0, Math.round(value ?? 0)) })
                }
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label="Pause between iterations in seconds" />
                </NumberFieldGroup>
              </NumberField>
            </InspectorField>
          </div>
        </>
      ) : null}
    </>
  );
}

function AgentEditor(props: { node: WorkflowAgentNode; update: Update<WorkflowAgentNode> }) {
  const { node, update } = props;
  return (
    <>
      <InspectorField label="Title">
        <Input
          value={node.title}
          className="h-8"
          onChange={(event) => update({ title: event.target.value })}
        />
      </InspectorField>
      {node.kind === "linear-agent" ? (
        <InspectorField label="Linear task">
          <InspectorSelect
            ariaLabel="Linear task"
            value={node.preset}
            options={(
              Object.keys(WORKFLOW_LINEAR_PRESET_LABELS) as Array<
                keyof typeof WORKFLOW_LINEAR_PRESET_LABELS
              >
            ).map((value) => ({ value, label: WORKFLOW_LINEAR_PRESET_LABELS[value] }))}
            onChange={(preset) =>
              update({
                preset,
                ...(preset === "find" && node.output.kind === "none"
                  ? { output: { kind: "list", hint: "{ id, identifier, title, url }[]" } }
                  : {}),
              })
            }
          />
        </InspectorField>
      ) : null}
      <InspectorField label="Prompt" hint={TEMPLATE_HINT}>
        <Textarea
          value={node.prompt}
          rows={6}
          className="font-mono text-xs"
          onChange={(event) => update({ prompt: event.target.value })}
        />
      </InspectorField>
      <ModelSelectionField
        value={node.modelSelection}
        onChange={(modelSelection) => update({ modelSelection })}
      />
      <SkillsField
        modelSelection={node.modelSelection}
        value={node.skills}
        onChange={(skills) => update({ skills })}
      />
      <InspectorField label="Session">
        <InspectorSelect
          ariaLabel="Session"
          value={node.session}
          options={SESSION_OPTIONS}
          onChange={(session) => update({ session })}
        />
      </InspectorField>
      <div className="grid grid-cols-2 gap-2">
        <InspectorField label="Permissions">
          <InspectorSelect
            ariaLabel="Permissions"
            value={node.runtimeMode}
            options={RUNTIME_MODE_OPTIONS}
            onChange={(runtimeMode) => update({ runtimeMode })}
          />
        </InspectorField>
        <InspectorField label="Checkout">
          <InspectorSelect
            ariaLabel="Checkout"
            value={node.envMode}
            options={ENV_MODE_OPTIONS}
            onChange={(envMode) => update({ envMode })}
          />
        </InspectorField>
      </div>
      <InspectorField
        label="Expected output"
        hint="Structured output is handed to the next step and can feed a For each."
      >
        <div className="flex gap-2">
          <InspectorSelect
            ariaLabel="Expected output kind"
            className="w-32 shrink-0"
            value={node.output.kind}
            options={[
              { value: "none", label: "Free text" },
              { value: "list", label: "JSON list" },
              { value: "object", label: "JSON object" },
            ]}
            onChange={(kind) => update({ output: { ...node.output, kind } })}
          />
          <Input
            value={node.output.hint}
            placeholder="shape hint, e.g. { id, title }[]"
            className="h-8 font-mono text-xs"
            disabled={node.output.kind === "none"}
            onChange={(event) => update({ output: { ...node.output, hint: event.target.value } })}
          />
        </div>
      </InspectorField>
    </>
  );
}

function FanOutEditor(props: { node: WorkflowFanOutNode; update: Update<WorkflowFanOutNode> }) {
  const { node, update } = props;
  return (
    <>
      <InspectorField label="Lanes at once" hint="How many items run in parallel; the rest queue.">
        <NumberField
          value={node.maxParallel}
          min={1}
          max={32}
          size="sm"
          onValueCommitted={(value) => update({ maxParallel: Math.max(1, Math.round(value ?? 1)) })}
        >
          <NumberFieldGroup>
            <NumberFieldInput aria-label="Lanes at once" />
          </NumberFieldGroup>
        </NumberField>
      </InspectorField>
      <InspectorField
        label="Checkout per lane"
        hint="Fresh worktree gives every lane its own branch — pick this when lanes open PRs."
      >
        <InspectorSelect
          ariaLabel="Checkout per lane"
          value={node.laneEnvMode}
          options={ENV_MODE_OPTIONS}
          onChange={(laneEnvMode) => update({ laneEnvMode })}
        />
      </InspectorField>
      <p className="text-xs text-muted-foreground">
        Runs the lane once per item of the previous step's list. Add steps inside the dashed lane on
        the canvas.
      </p>
    </>
  );
}

function GateEditor(props: { node: WorkflowGateNode; update: Update<WorkflowGateNode> }) {
  const { node, update } = props;
  return (
    <>
      <InspectorField
        label="Check"
        hint="Asked of the agent that did the previous step; it answers pass or fail with a reason."
      >
        <Textarea
          value={node.question}
          rows={3}
          onChange={(event) => update({ question: event.target.value })}
        />
      </InspectorField>
      <InspectorField label="On fail">
        <div className="flex gap-2">
          <InspectorSelect
            ariaLabel="On fail"
            value={node.onFail.kind}
            options={[
              { value: "stop", label: "Stop the run" },
              { value: "retry", label: "Fix and re-check" },
              { value: "continue", label: "Continue anyway" },
            ]}
            onChange={(kind) =>
              update({ onFail: kind === "retry" ? { kind, times: 2 } : { kind } })
            }
          />
          {node.onFail.kind === "retry" ? (
            <NumberField
              value={node.onFail.times}
              min={1}
              max={10}
              size="sm"
              className="w-24 shrink-0"
              onValueCommitted={(value) =>
                update({ onFail: { kind: "retry", times: Math.max(1, Math.round(value ?? 1)) } })
              }
            >
              <NumberFieldGroup>
                <NumberFieldInput aria-label="Retry times" />
              </NumberFieldGroup>
            </NumberField>
          ) : null}
        </div>
      </InspectorField>
      <ModelSelectionField
        value={node.modelSelection}
        onChange={(modelSelection) => update({ modelSelection })}
      />
    </>
  );
}

function ReviewEditor(props: { node: WorkflowReviewNode; update: Update<WorkflowReviewNode> }) {
  return (
    <InspectorField
      label="What to review"
      hint="The run pauses here and waits under Review until you approve or reject."
    >
      <Textarea
        value={props.node.instructions}
        rows={3}
        onChange={(event) => props.update({ instructions: event.target.value })}
      />
    </InspectorField>
  );
}

function ActionEditor(props: { node: WorkflowActionNode; update: Update<WorkflowActionNode> }) {
  const { node, update } = props;
  return (
    <>
      <InspectorField label="Action">
        <InspectorSelect
          ariaLabel="Action"
          value={node.preset}
          options={(
            Object.keys(WORKFLOW_ACTION_PRESET_LABELS) as Array<
              keyof typeof WORKFLOW_ACTION_PRESET_LABELS
            >
          ).map((value) => ({ value, label: WORKFLOW_ACTION_PRESET_LABELS[value] }))}
          onChange={(preset) => update({ preset })}
        />
      </InspectorField>
      <InspectorField
        label={node.preset === "custom" ? "Instructions" : "Extra instructions"}
        hint={TEMPLATE_HINT}
      >
        <Textarea
          value={node.prompt}
          rows={4}
          className="font-mono text-xs"
          onChange={(event) => update({ prompt: event.target.value })}
        />
      </InspectorField>
      <InspectorField label="Session">
        <InspectorSelect
          ariaLabel="Session"
          value={node.session}
          options={SESSION_OPTIONS}
          onChange={(session) => update({ session })}
        />
      </InspectorField>
    </>
  );
}

function PromptBlockEditor(props: {
  node: WorkflowPromptBlockNode;
  update: Update<WorkflowPromptBlockNode>;
}) {
  const { node, update } = props;
  return (
    <>
      <InspectorField
        label="Text"
        hint="Not a step of its own: injected into the next agent's prompt."
      >
        <Textarea
          value={node.text}
          rows={6}
          className="font-mono text-xs"
          onChange={(event) => update({ text: event.target.value })}
        />
      </InspectorField>
      <InspectorField label="Placement">
        <InspectorSelect
          ariaLabel="Placement"
          value={node.placement}
          options={[
            { value: "before", label: "Before the prompt" },
            { value: "after", label: "After the prompt" },
          ]}
          onChange={(placement) => update({ placement })}
        />
      </InspectorField>
    </>
  );
}

function EndEditor(props: { node: WorkflowEndNode; update: Update<WorkflowEndNode> }) {
  return (
    <InspectorField
      label="Report"
      hint="What the final feedback should look like. Leave empty to show the last step's output as the result."
    >
      <Textarea
        value={props.node.reportPrompt}
        rows={5}
        className="font-mono text-xs"
        onChange={(event) => props.update({ reportPrompt: event.target.value })}
      />
    </InspectorField>
  );
}
