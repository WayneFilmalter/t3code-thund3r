import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { normalizeWorkflowColor, WORKFLOW_COLOR_SWATCHES } from "~/workflowsStore";

/** A round swatch trigger that opens the neon palette plus a free hex field. */
export function WorkflowColorPicker(props: {
  value: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
}) {
  const [draft, setDraft] = useState(props.value);
  const dimension = props.size === "sm" ? "size-4" : "size-5";
  return (
    <Popover onOpenChange={(open) => open && setDraft(props.value)}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Workflow colour"
            className={cn("shrink-0 rounded-full border border-white/20", dimension)}
            style={{ backgroundColor: props.value, boxShadow: `0 0 10px -2px ${props.value}` }}
          />
        }
      />
      <PopoverPopup align="start" className="w-56 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Bubble colour</div>
        <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Preset colours">
          {WORKFLOW_COLOR_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={props.value === swatch}
              aria-label={swatch}
              className="flex size-5 items-center justify-center rounded-full border border-white/10"
              style={{ backgroundColor: swatch }}
              onClick={() => {
                props.onChange(swatch);
                setDraft(swatch);
              }}
            >
              {props.value === swatch ? <CheckIcon className="size-3 text-black/70" /> : null}
            </button>
          ))}
        </div>
        <Input
          className="mt-2 h-7 font-mono text-xs"
          value={draft}
          aria-label="Custom hex colour"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => props.onChange(normalizeWorkflowColor(draft))}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onChange(normalizeWorkflowColor(draft));
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
