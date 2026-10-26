import type { EnvironmentId, SlackFeedMessage } from "@t3tools/contracts";
import { useId } from "react";

import { Switch } from "~/components/ui/switch";

import { slackFeedChannels } from "./slackFeed.logic";
import { useSlackMutes } from "./useSlackMutes";

/** One switch per conversation in the feed: off keeps it out of the feed. */
export function SlackChannelToggles(props: {
  environmentId: EnvironmentId;
  messages: ReadonlyArray<SlackFeedMessage>;
}) {
  const { mutedChannels, setMuted } = useSlackMutes(props.environmentId);
  const channels = slackFeedChannels(props.messages, mutedChannels);
  const idPrefix = useId();
  if (channels.length === 0) {
    return <p className="text-xs text-muted-foreground">No channels in the feed yet.</p>;
  }
  return (
    <ul className="flex flex-col">
      {channels.map((channel) => {
        const id = `${idPrefix}-${channel.channelId}`;
        return (
          <li key={channel.channelId} className="flex items-center gap-2 py-1">
            <label
              htmlFor={id}
              className={
                channel.muted
                  ? "min-w-0 flex-1 cursor-pointer truncate text-xs text-muted-foreground"
                  : "min-w-0 flex-1 cursor-pointer truncate text-xs"
              }
            >
              {channel.name}
            </label>
            {channel.muted ? null : (
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {channel.count}
              </span>
            )}
            <Switch
              id={id}
              size="sm"
              checked={!channel.muted}
              aria-label={`Show ${channel.name} in the feed`}
              onCheckedChange={(shown) => setMuted(channel.channelId, shown ? null : channel.name)}
            />
          </li>
        );
      })}
    </ul>
  );
}
