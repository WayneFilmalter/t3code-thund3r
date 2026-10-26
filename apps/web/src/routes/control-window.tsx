import { createFileRoute } from "@tanstack/react-router";

import { BtopPanel } from "../components/control/BtopPanel";
import { PrioritiesPanel } from "../components/control/priorities/PrioritiesPanel";
import { PulsePanel } from "../components/control/pulse/PulsePanel";
import { SlackFeedPanel } from "../components/control/SlackFeedPanel";
import { WorkflowsPanel } from "../components/control/workflows/WorkflowsPanel";

export const Route = createFileRoute("/control-window")({
  component: ControlWindowGrid,
});

/**
 * The desktop Control window's content: one tall panel on the left, then two
 * stacked panels in each of the middle and right columns, divided by 1px gaps
 * that show the border colour. The grid flows by column, so Panel 1 spans the
 * first column, Panels 2–3 fill the middle and Panels 4–5 the right.
 */
function ControlWindowGrid() {
  return (
    <div className="grid h-dvh grid-flow-col grid-cols-3 grid-rows-2 gap-px bg-border">
      <section className="row-span-2 min-h-0 min-w-0 overflow-hidden bg-background">
        <PrioritiesPanel />
      </section>
      <section className="min-h-0 min-w-0 overflow-hidden bg-background">
        <SlackFeedPanel />
      </section>
      <section className="min-h-0 min-w-0 overflow-hidden bg-background">
        <WorkflowsPanel />
      </section>
      <section className="min-h-0 min-w-0 overflow-hidden bg-background">
        <PulsePanel />
      </section>
      <section className="min-h-0 min-w-0 overflow-hidden bg-background">
        <BtopPanel />
      </section>
    </div>
  );
}
