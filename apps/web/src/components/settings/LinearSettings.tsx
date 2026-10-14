import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";
import { SecretInput } from "./SecretInput";

const NEW_KEY_URL = "https://linear.app/settings/account/security";

/**
 * Linear access for the right panel's Linear tab: a personal API key kept in
 * the server's secret store, and the key of the team whose issues it lists.
 * Write-only like the GitHub token: the saved key is never shown, only
 * whether one is set.
 */
export function LinearSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const linear = useEnvironmentSettings(environmentId, (settings) => settings.linear);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save Linear settings",
  });
  const [teamKey, setTeamKey] = useState(linear.teamKey);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const keySaved = linear.apiKey.length > 0;
  const normalizedTeam = teamKey.trim().toUpperCase();
  const teamChanged = normalizedTeam !== linear.teamKey;
  const canSave = (draft.trim().length > 0 || teamChanged) && (keySaved || draft.trim().length > 0);

  const save = async (patch: { readonly apiKey?: string; readonly teamKey?: string }) => {
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId,
        input: { patch: { linear: patch } },
      });
      if (result._tag === "Success") {
        setDraft("");
        toastManager.add({
          type: "success",
          title: patch.apiKey === "" ? "Linear key removed" : "Linear settings saved",
          description:
            patch.apiKey === ""
              ? "The Linear tab will ask for a key again."
              : "The Linear tab can fetch issues now.",
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
          ...(draft.trim() ? { apiKey: draft.trim() } : {}),
          ...(teamChanged ? { teamKey: normalizedTeam } : {}),
        });
      }}
    >
      {/* Locked while saving: a successful save clears the draft, which would drop edits made mid-request. */}
      <fieldset disabled={saving} className="contents">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          The Linear tab in the right panel lists one team&apos;s issues by status. The server reads
          them straight from Linear with this key; no agent runs. A key with read access is enough.{" "}
          <InlineButton render={<a href={NEW_KEY_URL} target="_blank" rel="noreferrer noopener" />}>
            Create a key
            <ExternalLinkIcon aria-hidden className="size-3" />
          </InlineButton>
        </p>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor={`linear-team-${environmentId}`}>Team key</Label>
            <Input
              id={`linear-team-${environmentId}`}
              autoComplete="off"
              size="sm"
              placeholder="ENG"
              value={teamKey}
              onChange={(event) => setTeamKey(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`linear-key-${environmentId}`}>API key</Label>
            <SecretInput
              id={`linear-key-${environmentId}`}
              size="sm"
              configured={keySaved}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {keySaved
              ? linear.teamKey
                ? `Key saved; listing team ${linear.teamKey}.`
                : "Key saved; add the team key to list issues."
              : "No key saved."}
          </p>
          <div className="flex shrink-0 gap-2">
            {keySaved ? (
              <Button
                size="xs"
                variant="outline"
                disabled={saving}
                onClick={() => void save({ apiKey: "" })}
              >
                Remove key
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
