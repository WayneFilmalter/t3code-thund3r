/**
 * LinearIssues — reads a team's issues from Linear's hosted MCP server for the
 * right panel's Linear tab. The server is the MCP client, authenticated with
 * the user's API key as a bearer token, so a fetch is a plain data request:
 * no agent runs and no model tokens are spent. One connection per call keeps
 * the service stateless; the panel fetches on demand, not on an interval.
 *
 * @module linear/LinearIssues
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  LINEAR_ISSUE_STATUSES,
  LinearError,
  type LinearIssuesListInput,
  type LinearIssuesListResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Settings from "../serverSettings.ts";
import { LinearPayloadError, extractToolPayload, parseLinearIssues } from "./linearIssues.logic.ts";

export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
const LIST_TIMEOUT = "20 seconds";
/** Linear's maximum page; a busy backlog can hold a couple of hundred issues. */
const LIST_LIMIT = 250;

export class LinearIssues extends Context.Service<
  LinearIssues,
  {
    /** All issues of the configured team in one workflow state. */
    readonly listIssues: (
      input: LinearIssuesListInput,
    ) => Effect.Effect<LinearIssuesListResult, LinearError>;
  }
>()("t3/linear/LinearIssues") {}

const describeError = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : String(error);

/** A fresh MCP session for one call: connected on acquire, closed on release. */
const acquireClient = (apiKey: string) =>
  Effect.tryPromise({
    try: async () => {
      const client = new Client({ name: "t3code", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(LINEAR_MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
      });
      // The SDK's own transport class is not assignable to its `Transport` under
      // exactOptionalPropertyTypes; the cast is between the SDK's two shapes only.
      await client.connect(transport as Transport);
      return client;
    },
    catch: (error) => {
      const detail = describeError(error);
      return new LinearError({
        kind: /401|403|unauthori[sz]ed|forbidden/i.test(detail) ? "rejected" : "unreachable",
        detail: `Could not connect to Linear: ${detail}`,
      });
    },
  });

const make = Effect.gen(function* () {
  const settingsService = yield* Settings.ServerSettingsService;

  const listIssues = Effect.fn("LinearIssues.listIssues")(function* (input: LinearIssuesListInput) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        () => new LinearError({ kind: "unreachable", detail: "Could not read Linear settings." }),
      ),
    );
    const { apiKey, teamKey } = settings.linear;
    if (apiKey.length === 0 || teamKey.length === 0) {
      return yield* new LinearError({
        kind: "not-configured",
        detail: "Add a Linear API key and team key in Settings → Integrations.",
      });
    }
    const status = LINEAR_ISSUE_STATUSES.find((entry) => entry.id === input.status);
    if (!status) {
      return yield* new LinearError({ kind: "rejected", detail: "Unknown status." });
    }

    const issues = yield* Effect.acquireUseRelease(
      acquireClient(apiKey),
      (client) =>
        Effect.tryPromise({
          try: () =>
            client.callTool({
              name: "list_issues",
              arguments: { team: teamKey, state: status.linearState, limit: LIST_LIMIT },
            }),
          catch: (error) =>
            new LinearError({
              kind: "unreachable",
              detail: `Linear request failed: ${describeError(error)}`,
            }),
        }).pipe(
          Effect.flatMap((result) =>
            Effect.try({
              try: () => parseLinearIssues(extractToolPayload(result)),
              catch: (error) =>
                new LinearError({
                  kind: error instanceof LinearPayloadError ? "invalid-response" : "rejected",
                  detail: describeError(error),
                }),
            }),
          ),
        ),
      (client) => Effect.promise(() => client.close()).pipe(Effect.ignore),
    ).pipe(
      Effect.timeoutOrElse({
        duration: LIST_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new LinearError({ kind: "unreachable", detail: "Linear did not answer in time." }),
          ),
      }),
      Effect.withTracerEnabled(false),
    );

    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    return { status: input.status, issues, fetchedAt } satisfies LinearIssuesListResult;
  });

  return LinearIssues.of({ listIssues });
});

export const layer = Layer.effect(LinearIssues, make);
