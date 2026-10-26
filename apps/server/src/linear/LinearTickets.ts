/**
 * LinearTickets — reads and comments on Linear tickets for the Control
 * window's Priorities panel through Linear's GraphQL API, with the same
 * personal API key as the Linear tab. Stateless: each call is one request,
 * and the panel decides how often to ask.
 *
 * @module linear/LinearTickets
 */
import {
  LINEAR_IDENTIFIER_PATTERN,
  LinearError,
  type LinearCommentCreateInput,
  type LinearCommentCreateResult,
  type LinearTicketDetail,
  type LinearTicketDetailInput,
  type LinearTicketsGetInput,
  type LinearTicketsGetResult,
  type LinearTicketsSearchInput,
  type LinearTicketsSearchResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as Settings from "../serverSettings.ts";
import {
  COMMENT_MUTATION,
  DETAIL_QUERY,
  SEARCH_QUERY,
  TICKETS_QUERY,
  identifierFilter,
  mapTicketDetail,
  mapTickets,
  readViewerHandle,
  readGraphqlData,
} from "./linearTickets.logic.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT = "20 seconds";

export class LinearTickets extends Context.Service<
  LinearTickets,
  {
    /** The tickets behind `ENG-482` identifiers, plus the ones Linear has no issue for. */
    readonly getTickets: (
      input: LinearTicketsGetInput,
    ) => Effect.Effect<LinearTicketsGetResult, LinearError>;
    /** Up to ten tickets matching free text, or the exact ticket for an identifier. */
    readonly searchTickets: (
      input: LinearTicketsSearchInput,
    ) => Effect.Effect<LinearTicketsSearchResult, LinearError>;
    readonly getTicketDetail: (
      input: LinearTicketDetailInput,
    ) => Effect.Effect<LinearTicketDetail, LinearError>;
    /** Posts a comment as the API key's owner. */
    readonly createComment: (
      input: LinearCommentCreateInput,
    ) => Effect.Effect<LinearCommentCreateResult, LinearError>;
  }
>()("t3/linear/LinearTickets") {}

const describeError = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : String(error);

const make = Effect.gen(function* () {
  const settingsService = yield* Settings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;

  const apiKey = settingsService.getSettings.pipe(
    Effect.mapError(
      () => new LinearError({ kind: "unreachable", detail: "Could not read Linear settings." }),
    ),
    Effect.flatMap((settings) =>
      settings.linear.apiKey.length === 0
        ? Effect.fail(
            new LinearError({
              kind: "not-configured",
              detail: "Add a Linear API key in Settings → Integrations.",
            }),
          )
        : Effect.succeed(settings.linear.apiKey),
    ),
  );

  const graphql = (query: string, variables: Record<string, unknown>) =>
    Effect.gen(function* () {
      const key = yield* apiKey;
      const response = yield* httpClient
        .execute(
          HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
            // Personal API keys go in bare; only OAuth tokens take `Bearer`.
            HttpClientRequest.setHeader("authorization", key),
            HttpClientRequest.bodyJsonUnsafe({ query, variables }),
          ),
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new LinearError({
                kind: "unreachable",
                detail: `Could not reach Linear: ${describeError(error)}`,
              }),
          ),
        );
      const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
      return yield* Effect.fromResult(readGraphqlData(response.status, body));
    }).pipe(
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new LinearError({ kind: "unreachable", detail: "Linear did not answer in time." }),
          ),
      }),
      Effect.withTracerEnabled(false),
    );

  const getTickets = Effect.fn("LinearTickets.getTickets")(function* (
    input: LinearTicketsGetInput,
  ) {
    const identifiers = [...new Set(input.identifiers)];
    if (identifiers.length === 0) return { tickets: [], missing: [] };
    const data = yield* graphql(TICKETS_QUERY, { filter: identifierFilter(identifiers) });
    const found = mapTickets(data.issues, readViewerHandle(data.viewer));
    const byIdentifier = new Map(found.map((ticket) => [ticket.identifier, ticket]));
    // Requested order, so a pasted list keeps its order in the confirm dialog.
    return {
      tickets: identifiers.flatMap((identifier) => byIdentifier.get(identifier) ?? []),
      missing: identifiers.filter((identifier) => !byIdentifier.has(identifier)),
    };
  });

  const searchTickets = Effect.fn("LinearTickets.searchTickets")(function* (
    input: LinearTicketsSearchInput,
  ) {
    const term = input.query.trim();
    if (term.length === 0) return { tickets: [] };
    const identifier = term.toUpperCase();
    if (LINEAR_IDENTIFIER_PATTERN.test(identifier)) {
      const exact = yield* getTickets({ identifiers: [identifier] });
      if (exact.tickets.length > 0) return { tickets: exact.tickets };
    }
    const data = yield* graphql(SEARCH_QUERY, { term });
    return { tickets: mapTickets(data.searchIssues, readViewerHandle(data.viewer)) };
  });

  const getTicketDetail = Effect.fn("LinearTickets.getTicketDetail")(function* (
    input: LinearTicketDetailInput,
  ) {
    const data = yield* graphql(DETAIL_QUERY, { id: input.identifier });
    const detail = mapTicketDetail(data.issue, readViewerHandle(data.viewer));
    if (detail === null) {
      return yield* new LinearError({
        kind: "rejected",
        detail: `Linear has no ticket ${input.identifier}.`,
      });
    }
    return detail;
  });

  const createComment = Effect.fn("LinearTickets.createComment")(function* (
    input: LinearCommentCreateInput,
  ) {
    const data = yield* graphql(COMMENT_MUTATION, {
      input: { issueId: input.issueId, body: input.body },
    });
    const payload = data.commentCreate;
    const comment =
      typeof payload === "object" && payload !== null && "comment" in payload
        ? payload.comment
        : null;
    const commentId =
      typeof comment === "object" && comment !== null && "id" in comment ? comment.id : null;
    if (typeof commentId !== "string") {
      return yield* new LinearError({
        kind: "invalid-response",
        detail: "Linear did not confirm the comment.",
      });
    }
    return { commentId };
  });

  return LinearTickets.of({ getTickets, searchTickets, getTicketDetail, createComment });
});

export const layer = Layer.effect(LinearTickets, make);
