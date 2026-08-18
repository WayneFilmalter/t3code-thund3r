/**
 * Starting points offered by the panel's "+" menu. Each template builds fresh node ids so two
 * workflows made from the same template never share identity.
 */
import {
  createActionNode,
  createAgentNode,
  createEndNode,
  createFanOutNode,
  createStartNode,
  type WorkflowDefinitionInput,
} from "~/workflowsStore";

export interface WorkflowTemplate {
  id: string;
  label: string;
  description: string;
  build: () => WorkflowDefinitionInput;
}

const RESEARCH_TICKET_PROMPT = `Research ticket {{item.identifier}} ("{{item.title}}", {{item.url}}).

1. Read the ticket and its comments in Linear.
2. Look through this codebase for the areas it touches.
3. Decide two things: does the ticket have enough context to start work, and how doable is it (small / medium / large / unclear)?

Then, in Linear:
- Add labels that reflect your findings (for example "needs-context" when context is missing, and a size label).
- Leave one concise comment summarising what you found, what is missing, and a suggested approach.`;

const PLAN_TICKET_PROMPT = `Plan the change for ticket {{item.identifier}} ("{{item.title}}", {{item.url}}).

Read the ticket and its comments in Linear, find the code it touches, and write a short, concrete plan: files to change, the approach, and how to verify it. Keep the scope to what the ticket asks for; if something is ambiguous, pick the smallest reasonable interpretation and say so.`;

const IMPLEMENT_TICKET_PROMPT = `Implement the plan for ticket {{item.identifier}} in this repository with focused, well-tested edits. Stay within the plan; if it turns out to be wrong, say so in your final summary rather than improvising a bigger change.`;

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Start and Report, nothing in between",
    build: () => ({
      name: "New workflow",
      color: "#22d3ee",
      nodes: [createStartNode(), createEndNode()],
    }),
  },
  {
    id: "single-prompt",
    label: "Single prompt",
    description: "One agent, one prompt",
    build: () => ({
      name: "Single prompt",
      color: "#60a5fa",
      nodes: [
        createStartNode(),
        createAgentNode("agent", { title: "Do the thing", prompt: "" }),
        createEndNode(),
      ],
    }),
  },
  {
    id: "backlog-follow-up",
    label: "Backlog follow-up",
    description: "Find 10 tickets, research each in parallel, label and comment",
    build: () => ({
      name: "Backlog follow-up",
      description: "Triage 10 untriaged Linear tickets",
      color: "#a78bfa",
      nodes: [
        createStartNode(),
        createAgentNode("linear-agent", {
          title: "Find untriaged tickets",
          preset: "find",
          prompt:
            "Find 10 backlog tickets that have not been triaged yet (no triage labels and no triage comment from us).",
        }),
        createFanOutNode({
          maxParallel: 5,
          lane: [
            createAgentNode("agent", {
              title: "Research ticket",
              prompt: RESEARCH_TICKET_PROMPT,
              output: {
                kind: "object",
                hint: '{ "identifier": string, "hasEnoughContext": boolean, "size": "small" | "medium" | "large" | "unclear", "labelsAdded": string[] }',
              },
            }),
          ],
        }),
        createEndNode({
          reportPrompt:
            "Summarise the triage: one line per ticket with its size and whether it has enough context, then list any tickets that need input from a human.",
        }),
      ],
    }),
  },
  {
    id: "whole-backlog",
    label: "Whole backlog sweep",
    description: "Backlog follow-up, looped until nothing is left",
    build: () => ({
      name: "Whole backlog sweep",
      description: "Loop backlog follow-up until every ticket is triaged",
      color: "#f472b6",
      nodes: [
        createStartNode({
          mode: "loop",
          maxIterations: 50,
          pauseSeconds: 0,
          doneWhen: "source-empty",
        }),
        createAgentNode("linear-agent", {
          title: "Find untriaged tickets",
          preset: "find",
          prompt:
            "Find up to 10 backlog tickets that have not been triaged yet (no triage labels and no triage comment from us). Return an empty list when there are none left.",
        }),
        createFanOutNode({
          maxParallel: 5,
          lane: [
            createAgentNode("agent", {
              title: "Research ticket",
              prompt: RESEARCH_TICKET_PROMPT,
              output: {
                kind: "object",
                hint: '{ "identifier": string, "hasEnoughContext": boolean, "size": "small" | "medium" | "large" | "unclear", "labelsAdded": string[] }',
              },
            }),
          ],
        }),
        createEndNode({
          reportPrompt:
            "Summarise this batch: one line per ticket with its size and context verdict.",
        }),
      ],
    }),
  },
  {
    id: "implement-by-tag",
    label: "Implement by tag",
    description:
      "Find 5 tagged tickets; per ticket plan, implement (same agent, any model), open a PR, comment",
    build: () => ({
      name: "Implement by tag",
      description: "Ship 5 tickets carrying a label",
      color: "#34d399",
      nodes: [
        createStartNode(),
        createAgentNode("linear-agent", {
          title: "Find tickets by label",
          preset: "find",
          prompt:
            'Find 5 open tickets with the label "ready-for-agent" that do not already have a linked pull request.',
        }),
        createFanOutNode({
          maxParallel: 5,
          laneEnvMode: "worktree",
          lane: [
            createAgentNode("agent", {
              title: "Plan the change",
              interactionMode: "plan",
              prompt: PLAN_TICKET_PROMPT,
            }),
            createAgentNode("agent", {
              title: "Implement ticket",
              session: "continue",
              prompt: IMPLEMENT_TICKET_PROMPT,
            }),
            createActionNode({ preset: "commit-pr" }),
            createActionNode({
              preset: "comment-ticket",
              prompt:
                "Link the pull request you just opened and give a two-line summary of the change.",
            }),
          ],
        }),
        createEndNode({
          reportPrompt:
            "List each ticket with its pull request link, or the reason no PR was opened.",
        }),
      ],
    }),
  },
];

export function findWorkflowTemplate(id: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id) ?? null;
}
