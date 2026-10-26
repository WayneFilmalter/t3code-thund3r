import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";
import { SecretInput } from "./SecretInput";

const NEW_APP_URL = "https://api.slack.com/apps?new_app=1";

/**
 * Pasted into Slack's "From a manifest" flow: user scopes to read every
 * conversation and reply as the user, the priority slash commands, and Socket
 * Mode so new messages and commands arrive without a public URL.
 */
const SLACK_APP_MANIFEST = JSON.stringify(
  {
    display_information: { name: "T3 Code" },
    features: {
      // Slack only accepts slash commands and the `commands` scope on an app with a bot user.
      bot_user: { display_name: "T3 Code", always_online: false },
      slash_commands: [
        { command: "/priorities", description: "List the priority tickets" },
        {
          command: "/add-priority",
          description: "Add Linear tickets to the priority list",
          usage_hint: "ENG-482 #490 or a Linear link",
        },
        {
          command: "/remove-priority",
          description: "Take tickets off the priority list",
          usage_hint: "ENG-482",
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: ["commands"],
        user: [
          "channels:history",
          "groups:history",
          "im:history",
          "mpim:history",
          "channels:read",
          "groups:read",
          "im:read",
          "mpim:read",
          "users:read",
          "search:read",
          "chat:write",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        user_events: ["message.channels", "message.groups", "message.im", "message.mpim"],
      },
      socket_mode_enabled: true,
      org_deploy_enabled: false,
      token_rotation_enabled: false,
    },
  },
  null,
  2,
);

/**
 * Slack access for the Control window's feed: the user token reads messages
 * and replies as the user, the app-level token opens the live stream. Both are
 * kept in the server's secret store and are write-only, like the Linear key.
 */
export function SlackSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const slack = useEnvironmentSettings(environmentId, (settings) => settings.slack);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save Slack settings",
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [userToken, setUserToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [saving, setSaving] = useState(false);
  const userSaved = slack.userToken.length > 0;
  const appSaved = slack.appToken.length > 0;
  const canSave = userToken.trim().length > 0 || appToken.trim().length > 0;

  const save = async (patch: { readonly userToken?: string; readonly appToken?: string }) => {
    setSaving(true);
    try {
      const result = await updateSettings({ environmentId, input: { patch: { slack: patch } } });
      if (result._tag === "Success") {
        setUserToken("");
        setAppToken("");
        const removed = patch.userToken === "" && patch.appToken === "";
        toastManager.add({
          type: "success",
          title: removed ? "Slack disconnected" : "Slack tokens saved",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        void save({
          ...(userToken.trim() ? { userToken: userToken.trim() } : {}),
          ...(appToken.trim() ? { appToken: appToken.trim() } : {}),
        });
      }}
    >
      {/* Locked while saving: a successful save clears the drafts, which would drop edits made mid-request. */}
      <fieldset disabled={saving} className="contents">
        <ol className="grid max-w-2xl list-decimal gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>
            <InlineButton
              render={<a href={NEW_APP_URL} target="_blank" rel="noreferrer noopener" />}
            >
              Create a Slack app
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>{" "}
            from a manifest and paste{" "}
            <InlineButton onClick={() => copyToClipboard(SLACK_APP_MANIFEST)}>
              this manifest
              {isCopied ? (
                <CheckIcon aria-hidden className="size-3" />
              ) : (
                <CopyIcon aria-hidden className="size-3" />
              )}
            </InlineButton>
            .
          </li>
          <li>Install it to your workspace and copy the User OAuth Token (xoxp-).</li>
          <li>
            Under Basic Information, generate an app-level token with connections:write (xapp-).
          </li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`slack-user-token-${environmentId}`}>User token</Label>
            <SecretInput
              id={`slack-user-token-${environmentId}`}
              size="sm"
              placeholder="xoxp-…"
              configured={userSaved}
              value={userToken}
              onChange={(event) => setUserToken(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`slack-app-token-${environmentId}`}>App-level token</Label>
            <SecretInput
              id={`slack-app-token-${environmentId}`}
              size="sm"
              placeholder="xapp-…"
              configured={appSaved}
              value={appToken}
              onChange={(event) => setAppToken(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {userSaved && appSaved
              ? "Both tokens saved."
              : userSaved || appSaved
                ? `Add the ${userSaved ? "app-level" : "user"} token to connect.`
                : "No tokens saved."}
          </p>
          <div className="flex shrink-0 gap-2">
            {userSaved || appSaved ? (
              <Button
                size="xs"
                variant="outline"
                disabled={saving}
                onClick={() => void save({ userToken: "", appToken: "" })}
              >
                Disconnect
              </Button>
            ) : null}
            <Button type="submit" size="xs" disabled={!canSave || saving}>
              Save
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
