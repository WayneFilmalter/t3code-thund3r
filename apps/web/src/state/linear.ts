import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

const ONE_DAY_MS = 24 * 60 * 60_000;

/**
 * One Linear status section's issues, read through the server's Linear MCP
 * client. Sections fetch only when asked (first expand or a fetch button), so
 * results never go stale on their own and stay cached for the session.
 */
export const linearEnvironment = {
  issues: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:linear:issues",
    tag: WS_METHODS.linearIssuesList,
    staleTimeMs: ONE_DAY_MS,
    idleTtlMs: ONE_DAY_MS,
  }),
  /** The Priorities panel's tickets; the panel refreshes them on its own interval. */
  tickets: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:linear:tickets",
    tag: WS_METHODS.linearTicketsGet,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  }),
  ticketSearch: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:linear:ticket-search",
    tag: WS_METHODS.linearTicketsSearch,
    staleTimeMs: 30_000,
    idleTtlMs: 60_000,
  }),
  ticketDetail: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:linear:ticket-detail",
    tag: WS_METHODS.linearTicketDetail,
    staleTimeMs: 15_000,
    idleTtlMs: 60_000,
  }),
  /** The Pulse panel's board counts and moves; the panel refreshes them on its own interval. */
  boardStats: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:linear:board-stats",
    tag: WS_METHODS.linearBoardStats,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  }),
  /** The Control window feed's comments; the panel refreshes them on its own interval. */
  recentComments: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:linear:recent-comments",
    tag: WS_METHODS.linearCommentsRecent,
    staleTimeMs: 60_000,
    idleTtlMs: 5 * 60_000,
  }),
  /** A one-off read for paste resolution and the Done check, which need the current state. */
  resolveTickets: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "look up Linear tickets",
    tag: WS_METHODS.linearTicketsGet,
  }),
  createComment: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "comment on Linear",
    tag: WS_METHODS.linearCommentCreate,
  }),
};
