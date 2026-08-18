import type { ScopedProjectRef } from "@t3tools/contracts";
import { ArrowLeftIcon, Maximize2Icon, Minimize2Icon, MousePointerClickIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { requestConfirmDialog } from "~/confirmDialog";
import { cn } from "~/lib/utils";
import {
  findNodeSlot,
  insertNode,
  moveNode,
  removeNode,
  updateNode,
  type NodeSlot,
} from "~/workflows/graphEdits";
import { issuesByNode, validateWorkflow } from "~/workflows/workflowValidation";
import {
  createActionNode,
  createAgentNode,
  createFanOutNode,
  createGateNode,
  createPromptBlockNode,
  createReviewNode,
  selectProjectWorkflows,
  useWorkflowsStore,
  type WorkflowDefinition,
  type WorkflowDefinitionInput,
  type WorkflowNode,
  type WorkflowNodeKind,
} from "~/workflowsStore";

import { NodeInspector } from "./builder/NodeInspector";
import { WorkflowCanvas } from "./builder/WorkflowCanvas";
import { WorkflowColorPicker } from "./builder/WorkflowColorPicker";
import { WorkflowsSubheader } from "./WorkflowsSubheader";

export type WorkflowBuilderTarget =
  | { kind: "existing"; definition: WorkflowDefinition }
  | { kind: "new"; input: WorkflowDefinitionInput };

interface Draft {
  name: string;
  description: string | null;
  color: string;
  sharedContext: string;
  nodes: WorkflowNode[];
}

function draftFrom(target: WorkflowBuilderTarget): Draft {
  if (target.kind === "existing") {
    const { name, description, color, sharedContext, nodes } = target.definition;
    return { name, description, color, sharedContext, nodes };
  }
  return {
    name: target.input.name,
    description: target.input.description ?? null,
    color: target.input.color ?? "#22d3ee",
    sharedContext: target.input.sharedContext ?? "",
    nodes: target.input.nodes ?? [],
  };
}

function createNodeOfKind(kind: WorkflowNodeKind): WorkflowNode | null {
  switch (kind) {
    case "agent":
      return createAgentNode("agent");
    case "linear-agent":
      return createAgentNode("linear-agent");
    case "fan-out":
      return createFanOutNode();
    case "gate":
      return createGateNode();
    case "review":
      return createReviewNode();
    case "action":
      return createActionNode();
    case "prompt-block":
      return createPromptBlockNode();
    case "start":
    case "end":
      return null;
  }
}

/**
 * Build-workflow view of the Workflows surface: name and colour up top, the auto-laid-out
 * canvas of bubbles, and the selected node's inspector. Edits live in local draft state until
 * Save writes them to the store; validation gates Save and glows offending bubbles.
 */
export function WorkflowBuilderPanel(props: {
  projectRef: ScopedProjectRef;
  target: WorkflowBuilderTarget;
  maximized: boolean;
  onSetMaximized?: ((maximized: boolean) => void) | undefined;
  onBack: () => void;
  onSaved: (definition: WorkflowDefinition) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(props.target));
  const [dirty, setDirty] = useState(props.target.kind === "new");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => draft.nodes.find((node) => node.kind === "start")?.id ?? null,
  );
  const issues = useMemo(() => validateWorkflow(draft), [draft]);
  const issueMap = useMemo(() => issuesByNode(issues), [issues]);
  const selectedNode = selectedNodeId ? findNode(draft.nodes, selectedNodeId) : null;

  const patchDraft = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const setNodes = (nodes: WorkflowNode[]) => patchDraft({ nodes });

  const handleInsert = (slot: NodeSlot, kind: WorkflowNodeKind) => {
    const node = createNodeOfKind(kind);
    if (!node) return;
    setNodes(insertNode(draft.nodes, slot, node));
    setSelectedNodeId(node.id);
  };
  const handleRemove = (nodeId: string) => {
    const slot = findNodeSlot(draft.nodes, nodeId);
    const next = removeNode(draft.nodes, nodeId);
    setNodes(next);
    const chain =
      slot?.parentId === null || !slot
        ? next
        : ((next.find((node) => node.id === slot.parentId) as { lane?: WorkflowNode[] } | undefined)
            ?.lane ?? next);
    const neighbour = chain[Math.max(0, (slot?.index ?? 1) - 1)] ?? next[0];
    setSelectedNodeId(neighbour?.id ?? null);
  };

  const save = () => {
    if (issues.length > 0) return;
    const store = useWorkflowsStore.getState();
    if (props.target.kind === "existing") {
      const definitionId = props.target.definition.id;
      store.updateDefinition(props.projectRef, definitionId, draft);
      const saved = selectProjectWorkflows(
        useWorkflowsStore.getState().byProjectKey,
        props.projectRef,
      ).definitions.find((definition) => definition.id === definitionId) ?? {
        ...props.target.definition,
        ...draft,
      };
      setDirty(false);
      props.onSaved(saved);
      return;
    }
    const created = store.addDefinition(props.projectRef, draft);
    setDirty(false);
    props.onSaved(created);
  };

  const back = async () => {
    if (dirty) {
      const confirmed = await requestConfirmDialog("Discard unsaved changes to this workflow?", {
        variant: "destructive",
      });
      if (confirmed === false) return;
    }
    props.onBack();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={() => void back()}>
          <ArrowLeftIcon />
          Back
        </Button>
        <WorkflowColorPicker
          value={draft.color}
          onChange={(color) => patchDraft({ color })}
          size="sm"
        />
        <Input
          value={draft.name}
          aria-label="Workflow name"
          placeholder="Workflow name"
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm font-medium shadow-none focus-visible:border-input"
          onChange={(event) => patchDraft({ name: event.target.value })}
        />
        {props.onSetMaximized ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={props.maximized ? "Restore panel" : "Maximize panel"}
                  onClick={() => props.onSetMaximized?.(!props.maximized)}
                />
              }
            >
              {props.maximized ? <Minimize2Icon /> : <Maximize2Icon />}
            </TooltipTrigger>
            <TooltipPopup>{props.maximized ? "Restore panel" : "Maximize panel"}</TooltipPopup>
          </Tooltip>
        ) : null}
        <Button type="button" size="xs" disabled={issues.length > 0 || !dirty} onClick={save}>
          Save
        </Button>
      </WorkflowsSubheader>
      <div className={cn("flex min-h-0 flex-1", props.maximized ? "flex-row" : "flex-col")}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkflowCanvas
            nodes={draft.nodes}
            selectedNodeId={selectedNodeId}
            onSelect={setSelectedNodeId}
            onInsert={handleInsert}
            issuesByNode={issueMap}
          />
          {issueMap.get(null)?.length ? (
            <ul className="mx-3 mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
              {issueMap.get(null)!.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div
          className={cn(
            "min-h-0 shrink-0 overflow-y-auto border-border/60 bg-background",
            props.maximized ? "w-[360px] border-l" : "max-h-[46%] border-t",
          )}
        >
          {selectedNode ? (
            <NodeInspector
              nodes={draft.nodes}
              node={selectedNode}
              definition={draft}
              issues={issueMap.get(selectedNode.id) ?? []}
              onUpdateNode={(nodeId, patch) => setNodes(updateNode(draft.nodes, nodeId, patch))}
              onUpdateDefinition={(patch) => patchDraft(patch)}
              onMove={(nodeId, direction) => setNodes(moveNode(draft.nodes, nodeId, direction))}
              onRemove={handleRemove}
            />
          ) : (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <MousePointerClickIcon className="size-3.5" />
              Select a bubble to edit it, or press + between bubbles to add a step.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function findNode(nodes: readonly WorkflowNode[], nodeId: string): WorkflowNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.kind === "fan-out") {
      const inner = node.lane.find((laneNode) => laneNode.id === nodeId);
      if (inner) return inner;
    }
  }
  return null;
}
