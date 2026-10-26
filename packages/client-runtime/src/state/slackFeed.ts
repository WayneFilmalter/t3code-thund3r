import type { SlackConnectionStatus, SlackFeedEvent, SlackFeedMessage } from "@t3tools/contracts";

/** The Control window's Slack feed as clients hold it: status plus messages, newest first. */
export interface SlackFeedState {
  readonly status: SlackConnectionStatus;
  readonly messages: ReadonlyArray<SlackFeedMessage>;
}

export const initialSlackFeedState = (): SlackFeedState => ({
  status: { state: "connecting", detail: null, selfName: null, teamName: null, fetchedAt: null },
  messages: [],
});

const tsValue = (ts: string) => Number.parseFloat(ts);
const sameMessage = (a: SlackFeedMessage, channelId: string, ts: string) =>
  a.channelId === channelId && a.ts === ts;

/** Folds one server event into the feed; snapshots replace it, deltas edit one message. */
export function applySlackFeedEvent(state: SlackFeedState, event: SlackFeedEvent): SlackFeedState {
  switch (event._tag) {
    case "snapshot":
      return { status: event.status, messages: event.messages };
    case "status":
      return { ...state, status: event.status };
    case "remove":
      return {
        ...state,
        messages: state.messages.filter((m) => !sameMessage(m, event.channelId, event.ts)),
      };
    case "upsert": {
      const { message } = event;
      const rest = state.messages.filter((m) => !sameMessage(m, message.channelId, message.ts));
      const at = rest.findIndex((m) => tsValue(m.ts) < tsValue(message.ts));
      const messages =
        at === -1 ? [...rest, message] : [...rest.slice(0, at), message, ...rest.slice(at)];
      return { ...state, messages };
    }
  }
}
