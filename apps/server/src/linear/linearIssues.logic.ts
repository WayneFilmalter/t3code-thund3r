import type { LinearIssue, LinearIssuePriority } from "@t3tools/contracts";

/**
 * Pure parsing of Linear MCP tool results. Linear does not document the
 * `list_issues` result shape, so this reads the fields leniently: a bare
 * array or an object wrapping one, states as names or objects, priorities as
 * Linear's 0-4 numbers or their labels.
 */

export class LinearPayloadError extends Error {
  override readonly name = "LinearPayloadError";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The tool's JSON payload: structured content first, else the first text block parsed. */
export function extractToolPayload(result: unknown): unknown {
  const record = isRecord(result) ? result : {};
  const blocks = Array.isArray(record.content) ? record.content : [];
  const textBlock = blocks.find(
    (block): block is { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string",
  );
  const text = textBlock?.text;
  if (record.isError === true) {
    throw new LinearPayloadError(text?.trim() || "Linear rejected the request.");
  }
  if (record.structuredContent !== undefined && record.structuredContent !== null) {
    return record.structuredContent;
  }
  if (text === undefined) throw new LinearPayloadError("Linear returned no content.");
  try {
    return JSON.parse(text);
  } catch {
    throw new LinearPayloadError("Linear returned a response that is not JSON.");
  }
}

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** A number, or Linear's `{ value, name }` wrapper around one. */
const readValueNumber = (value: unknown): number | null =>
  isRecord(value) ? readNumber(value.value) : readNumber(value);

/** Linear's hosted MCP puts the human identifier (`KRE-12`) in `id` and the UUID in `uuid`. */
const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

/** The name under `state`, `status`, or `workflowState`, as a string or an object with a name. */
function readStateName(issue: Record<string, unknown>): string {
  for (const key of ["state", "status", "workflowState", "stateName"]) {
    const value = issue[key];
    const direct = readString(value);
    if (direct) return direct;
    if (isRecord(value)) {
      const name = readString(value.name);
      if (name) return name;
    }
  }
  return "";
}

const PRIORITY_BY_NUMBER: Record<number, LinearIssuePriority> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

export function readPriority(value: unknown): LinearIssuePriority {
  if (typeof value === "number") return PRIORITY_BY_NUMBER[value] ?? "none";
  if (isRecord(value)) {
    const inner = value.value ?? value.priority ?? value.label ?? value.name;
    return inner === undefined ? "none" : readPriority(inner);
  }
  const label = readString(value)?.toLowerCase();
  switch (label) {
    case "urgent":
    case "high":
    case "medium":
    case "low":
      return label;
    case "no priority":
    case "none":
    default:
      return "none";
  }
}

function readIssueList(payload: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    for (const key of ["issues", "nodes", "results", "data", "items"]) {
      const inner = payload[key];
      if (Array.isArray(inner)) return inner;
      if (isRecord(inner) && Array.isArray(inner.nodes)) return inner.nodes;
    }
  }
  throw new LinearPayloadError("Linear returned no issue list.");
}

/** Issues from a `list_issues` payload. Entries without an identifier and title are skipped. */
export function parseLinearIssues(payload: unknown): ReadonlyArray<LinearIssue> {
  const issues: LinearIssue[] = [];
  for (const entry of readIssueList(payload)) {
    if (!isRecord(entry)) continue;
    const rawId = readString(entry.id);
    const identifier =
      readString(entry.identifier) ??
      readString(entry.key) ??
      (rawId !== null && IDENTIFIER_PATTERN.test(rawId) ? rawId : null);
    const title = readString(entry.title);
    if (!identifier || !title) continue;
    const id = readString(entry.uuid) ?? rawId ?? identifier;
    issues.push({
      id,
      identifier,
      title,
      url: readString(entry.url) ?? "",
      priority: readPriority(entry.priority ?? entry.priorityLabel),
      estimate: readValueNumber(entry.estimate),
      stateName: readStateName(entry),
      branchName: readString(entry.gitBranchName) ?? readString(entry.branchName),
    });
  }
  return issues;
}
