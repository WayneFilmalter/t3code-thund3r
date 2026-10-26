import { Check, type IconNode } from "lucide";
import { type ReactNode, useRef } from "react";

import { MorphIcon } from "~/components/MorphIcon";
import { Button } from "~/components/ui/button";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "~/components/ui/anchoredCopyToast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

/**
 * Copies one value of a Linear issue (its branch, its link) with a check that
 * morphs in on success. Pass `children` for a labelled button; without them
 * it is icon-only. A null value disables it and the tooltip says why.
 */
export function LinearCopyButton(props: {
  value: string | null;
  icon: IconNode;
  ariaLabel: string;
  /** Tooltip when there is nothing to copy. */
  unavailableHint: string;
  /** Tooltip before copying; defaults to the value itself. */
  hint?: string | undefined;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  const { value } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            type="button"
            size={props.children === undefined ? "icon-xs" : "xs"}
            variant="ghost-muted"
            aria-label={props.ariaLabel}
            disabled={value === null}
            onClick={(event) => {
              event.stopPropagation();
              if (value !== null) copyToClipboard(value, undefined);
            }}
          />
        }
      >
        <MorphIcon
          className={cn("size-3", isCopied && "text-success")}
          icon={isCopied ? Check : props.icon}
        />
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>
        <p>
          {value === null ? props.unavailableHint : isCopied ? "Copied" : (props.hint ?? value)}
        </p>
      </TooltipPopup>
    </Tooltip>
  );
}
