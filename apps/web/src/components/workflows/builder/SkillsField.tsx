import { useAtomValue } from "@effect/atom-react";
import type { ModelSelection } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { primaryServerProvidersAtom } from "~/state/server";

import { InspectorField } from "./inspectorFields";

/**
 * Multi-select over the skills the chosen provider instance advertises (or every instance's
 * skills when the node runs on the project default). Selected names become `/name` lines at
 * the top of the agent's prompt.
 */
export function SkillsField(props: {
  modelSelection: ModelSelection | null;
  value: readonly string[];
  onChange: (skills: string[]) => void;
}) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const scoped = props.modelSelection
    ? providers.filter((provider) => provider.instanceId === props.modelSelection!.instanceId)
    : providers;
  const names = new Map<string, string>();
  for (const provider of scoped) {
    for (const skill of provider.skills) {
      if (skill.enabled) names.set(skill.name, skill.displayName ?? skill.name);
    }
    for (const command of provider.slashCommands) {
      if (!names.has(command.name)) names.set(command.name, command.name);
    }
  }
  const available = [...names.entries()].sort(([left], [right]) => left.localeCompare(right));
  const summary =
    props.value.length === 0 ? "None" : props.value.map((name) => `/${name}`).join(", ");
  return (
    <InspectorField label="Skills" hint="Invoked as /name at the top of the prompt.">
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full justify-between font-normal"
            />
          }
        >
          <span className="min-w-0 truncate">{summary}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </MenuTrigger>
        <MenuPopup align="start" className="max-h-72 w-(--anchor-width) overflow-y-auto">
          {available.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No skills advertised by this provider.
            </div>
          ) : (
            available.map(([name, label]) => (
              <MenuCheckboxItem
                key={name}
                checked={props.value.includes(name)}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  props.onChange(
                    checked
                      ? [...props.value, name]
                      : props.value.filter((candidate) => candidate !== name),
                  )
                }
              >
                <span className="min-w-0 truncate">/{name}</span>
                {label !== name ? (
                  <span className="ml-1 truncate text-xs text-muted-foreground">{label}</span>
                ) : null}
              </MenuCheckboxItem>
            ))
          )}
        </MenuPopup>
      </Menu>
    </InspectorField>
  );
}
