import type { ReactNode } from "react";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

/** Label + control row used by every node editor. */
export function InspectorField(props: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", props.className)}>
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      {props.children}
      {props.hint ? (
        <span className="text-[.7rem] text-muted-foreground/80">{props.hint}</span>
      ) : null}
    </label>
  );
}

export function InspectorSelect<TValue extends string>(props: {
  value: TValue;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  className?: string;
}) {
  const current = props.options.find((option) => option.value === props.value);
  return (
    <Select value={props.value} onValueChange={(value) => props.onChange(value as TValue)}>
      <SelectTrigger className={cn("h-8 w-full", props.className)} aria-label={props.ariaLabel}>
        <SelectValue>{current?.label ?? props.value}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={option.value} hideIndicator value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export const RUNTIME_MODE_OPTIONS = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "approval-required", label: "Supervised" },
] as const;

export const ENV_MODE_OPTIONS = [
  { value: "default", label: "Project default" },
  { value: "local", label: "Local checkout" },
  { value: "worktree", label: "Fresh worktree" },
] as const;

export const SESSION_OPTIONS = [
  { value: "new", label: "✦ New agent" },
  { value: "continue", label: "↳ Same agent as previous step" },
] as const;
