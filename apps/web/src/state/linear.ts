import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";

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
};
