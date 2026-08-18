import type { ReactElement } from "react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  WORKFLOW_NODE_CATEGORY_LABELS,
  WORKFLOW_NODE_META,
  WORKFLOW_PALETTE_KINDS,
  type WorkflowNodeCategory,
} from "~/workflows/workflowNodeMeta";
import type { WorkflowNodeKind } from "~/workflowsStore";

import { NODE_ICONS } from "./nodeIcons";

const CATEGORY_ORDER: readonly WorkflowNodeCategory[] = ["agents", "flow", "actions", "context"];

/** The "add a step" menu, grouped by category, wrapping whatever trigger it is given. */
export function NodePaletteMenu(props: {
  children: ReactElement;
  onPick: (kind: WorkflowNodeKind) => void;
  allowFanOut: boolean;
}) {
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    kinds: WORKFLOW_PALETTE_KINDS.filter(
      (kind) =>
        WORKFLOW_NODE_META[kind].category === category && (props.allowFanOut || kind !== "fan-out"),
    ),
  })).filter((group) => group.kinds.length > 0);
  return (
    <Menu>
      <MenuTrigger render={props.children} />
      <MenuPopup align="center" className="w-60">
        {groups.map((group, groupIndex) => (
          <MenuGroup key={group.category}>
            {groupIndex > 0 ? <MenuSeparator /> : null}
            <MenuGroupLabel>{WORKFLOW_NODE_CATEGORY_LABELS[group.category]}</MenuGroupLabel>
            {group.kinds.map((kind) => {
              const Icon = NODE_ICONS[kind];
              const meta = WORKFLOW_NODE_META[kind];
              return (
                <MenuItem
                  key={kind}
                  onClick={() => props.onPick(kind)}
                  className="items-start gap-2 py-1.5"
                >
                  <span
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border"
                    style={{ borderColor: meta.accent, color: meta.accent }}
                  >
                    <Icon className="size-3" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                  </span>
                </MenuItem>
              );
            })}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}
