import { useAtomValue } from "@effect/atom-react";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { Switch } from "~/components/ui/switch";
import { usePrimarySettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { getDefaultServerModel, getProviderModelCapabilities } from "~/providerModels";
import { primaryServerProvidersAtom } from "~/state/server";

import { InspectorField, InspectorSelect } from "./inspectorFields";

/**
 * "Project default" or an explicit provider/model with the model's own options (effort,
 * fast mode…) rendered from its capability descriptors, the same way the composer does.
 */
export function ModelSelectionField(props: {
  value: ModelSelection | null;
  onChange: (value: ModelSelection | null) => void;
}) {
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(settings, providers);
  const firstEntry =
    instanceEntries.find((entry) => entry.enabled && entry.isAvailable) ?? instanceEntries[0];
  const activeEntry = props.value
    ? (instanceEntries.find((entry) => entry.instanceId === props.value!.instanceId) ?? firstEntry)
    : null;
  const descriptors =
    props.value && activeEntry
      ? getProviderOptionDescriptors({
          caps: getProviderModelCapabilities(
            activeEntry.models,
            props.value.model,
            activeEntry.driverKind,
          ),
          selections: props.value.options,
        })
      : [];

  const setOption = (id: string, value: string | boolean) => {
    if (!props.value) return;
    const next = descriptors.map((descriptor) =>
      descriptor.id === id ? { ...descriptor, currentValue: value as never } : descriptor,
    );
    props.onChange(
      createModelSelection(
        props.value.instanceId,
        props.value.model,
        buildProviderOptionSelectionsFromDescriptors(next),
      ),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <InspectorField label="Model">
        <div className="flex items-center gap-2">
          <Switch
            checked={props.value !== null}
            aria-label="Choose a specific model"
            disabled={!firstEntry}
            onCheckedChange={(checked) => {
              if (!checked || !firstEntry) {
                props.onChange(null);
                return;
              }
              props.onChange(
                createModelSelection(
                  firstEntry.instanceId,
                  getDefaultServerModel(providers, firstEntry.driverKind),
                ),
              );
            }}
          />
          {props.value && activeEntry ? (
            <ProviderModelPicker
              activeInstanceId={activeEntry.instanceId as ProviderInstanceId}
              model={props.value.model}
              lockedProvider={null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none flex-1 text-foreground/90"
              triggerAriaLabel="Agent model"
              onInstanceModelChange={(instanceId, model) =>
                props.onChange(createModelSelection(instanceId, model))
              }
            />
          ) : (
            <span className="text-xs text-muted-foreground">Project default</span>
          )}
        </div>
      </InspectorField>
      {descriptors.map((descriptor) =>
        descriptor.type === "select" ? (
          <InspectorField key={descriptor.id} label={descriptor.label}>
            <InspectorSelect
              ariaLabel={descriptor.label}
              value={
                descriptor.currentValue ??
                descriptor.options.find((option) => option.isDefault)?.id ??
                descriptor.options[0]?.id ??
                ""
              }
              options={descriptor.options.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              onChange={(value) => setOption(descriptor.id, value)}
            />
          </InspectorField>
        ) : (
          <label key={descriptor.id} className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{descriptor.label}</span>
            <Switch
              checked={descriptor.currentValue ?? false}
              aria-label={descriptor.label}
              onCheckedChange={(checked) => setOption(descriptor.id, Boolean(checked))}
            />
          </label>
        ),
      )}
    </div>
  );
}
