import type { EnvironmentId } from "@t3tools/contracts";

import { toastManager } from "~/components/ui/toast";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Conversations kept out of the Slack feed. The server filters them, so a
 * mute takes effect in every window at once and survives restarts.
 */
export function useSlackMutes(environmentId: EnvironmentId) {
  const mutedChannels = useEnvironmentSettings(
    environmentId,
    (settings) => settings.slack.mutedChannels,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update muted Slack channels",
  });
  const setMuted = (channelId: string, name: string | null) =>
    updateSettings({
      environmentId,
      input: { patch: { slack: { mutedChannels: { [channelId]: name } } } },
    });

  const unmute = (channelId: string) => void setMuted(channelId, null);
  const mute = (channelId: string, name: string) => {
    void setMuted(channelId, name).then((result) => {
      if (result._tag !== "Success") return;
      const id = toastManager.add({
        type: "success",
        title: `Muted ${name}`,
        description: "Unmute it from the Control tab.",
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(id);
            unmute(channelId);
          },
        },
      });
    });
  };

  return { mutedChannels, mute, unmute };
}
