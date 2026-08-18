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
  WORKFLOW_PALETTE_ITEMS,
  type WorkflowNodeCategory,
  type WorkflowPaletteItemId,
} from "~/workflows/workflowNodeMeta";

import { NODE_ICONS, PLAN_ICON } from "./nodeIcons";

const CATEGORY_ORDER: readonly WorkflowNodeCategory[] = ["agents", "flow", "actions", "context"];

/** The "add a step" menu, grouped by category, wrapping whatever trigger it is given. */
export function NodePaletteMenu(props: {
  children: ReactElement;
  onPick: (item: WorkflowPaletteItemId) => void;
  allowFanOut: boolean;
}) {
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: WORKFLOW_PALETTE_ITEMS.filter(
      (item) =>
        WORKFLOW_NODE_META[item.kind].category === category &&
        (props.allowFanOut || item.kind !== "fan-out"),
    ),
  })).filter((group) => group.items.length > 0);
  return (
    <Menu>
      <MenuTrigger render={props.children} />
      <MenuPopup align="center" className="w-60">
        {groups.map((group, groupIndex) => (
          <MenuGroup key={group.category}>
            {groupIndex > 0 ? <MenuSeparator /> : null}
            <MenuGroupLabel>{WORKFLOW_NODE_CATEGORY_LABELS[group.category]}</MenuGroupLabel>
            {group.items.map((item) => {
              const Icon = item.id === "plan-agent" ? PLAN_ICON : NODE_ICONS[item.kind];
              const meta = WORKFLOW_NODE_META[item.kind];
              return (
                <MenuItem
                  key={item.id}
                  onClick={() => props.onPick(item.id)}
                  className="items-start gap-2 py-1.5"
                >
                  <span
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border"
                    style={{ borderColor: meta.accent, color: meta.accent }}
                  >
                    <Icon className="size-3" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.blurb}</span>
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
