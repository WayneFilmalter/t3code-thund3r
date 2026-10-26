import type { LinearPriority, LinearTicket } from "@t3tools/contracts";

/** Someone else has commented since the ticket was last opened. */
export function hasUnreadComments(
  ticket: Pick<LinearTicket, "latestOthersCommentAt">,
  entry: Pick<LinearPriority, "seenCommentsAt">,
): boolean {
  const latest = ticket.latestOthersCommentAt;
  if (latest === null) return false;
  return entry.seenCommentsAt === null || latest > entry.seenCommentsAt;
}

const DONE_STATE_NAMES = new Set(["qa", "qa approved", "done"]);

/** QA, QA Approved and Done leave the list without asking; so does any completed state. */
export function isTicketDone(ticket: Pick<LinearTicket, "stateName" | "stateType">): boolean {
  return (
    ticket.stateType === "completed" || DONE_STATE_NAMES.has(ticket.stateName.trim().toLowerCase())
  );
}

/**
 * Every word of `query` appears somewhere in `fields`, ignoring case, so
 * `login 482` finds `ENG-482 Fix login`. An empty query matches everything.
 */
export function matchesSearch(
  fields: ReadonlyArray<string | null | undefined>,
  query: string,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
