import { createFileRoute } from "@tanstack/react-router";

import { BtopPanel } from "../components/control/BtopPanel";

export const Route = createFileRoute("/control-window")({
  component: ControlWindowGrid,
});

const PLACEHOLDER_CLASS =
  "flex min-h-0 min-w-0 items-center justify-center bg-background text-sm text-muted-foreground";

/**
 * The desktop Control window's content: one tall panel on the left, then two
 * stacked panels in each of the middle and right columns, divided by 1px gaps
 * that show the border colour. The grid flows by column, so Panel 1 spans the
 * first column, Panels 2–3 fill the middle and Panels 4–5 the right.
 */
function ControlWindowGrid() {
  return (
    <div className="grid h-dvh grid-flow-col grid-cols-3 grid-rows-2 gap-px bg-border">
      <section className={`${PLACEHOLDER_CLASS} row-span-2`}>Panel 1</section>
      <section className={PLACEHOLDER_CLASS}>Panel 2</section>
      <section className={PLACEHOLDER_CLASS}>Panel 3</section>
      <section className={PLACEHOLDER_CLASS}>Panel 4</section>
      <section className="min-h-0 min-w-0 overflow-hidden bg-background">
        <BtopPanel />
      </section>
    </div>
  );
}
