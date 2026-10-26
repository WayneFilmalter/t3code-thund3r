import type { EnvironmentId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

import { useSlackMutes } from "./useSlackMutes";

/** Muted conversations with a way back. Mute from a message's menu in the feed. */
export function SlackMutedChannels(props: {
  environmentId: EnvironmentId;
  /** Show a hint instead of nothing when no channel is muted. */
  showEmpty?: boolean;
}) {
  const { mutedChannels, unmute } = useSlackMutes(props.environmentId);
  const entries = Object.entries(mutedChannels).toSorted(([, a], [, b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return props.showEmpty ? (
      <p className="text-xs text-muted-foreground">
        No muted channels. Mute one from a message&apos;s menu in the Slack feed.
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">Muted</span>
      <ul className="flex flex-wrap gap-1.5">
        {entries.map(([channelId, name]) => (
          <li
            key={channelId}
            className="flex items-center gap-0.5 rounded-md border border-border/70 py-0.5 pr-0.5 pl-2 text-xs"
          >
            <span className="max-w-40 truncate">{name}</span>
            <Button
              type="button"
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Unmute ${name}`}
              onClick={() => unmute(channelId)}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
