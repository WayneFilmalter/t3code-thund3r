import { createFileRoute } from "@tanstack/react-router";

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
      {[1, 2, 3, 4, 5].map((panel) => (
        <section
          key={panel}
          className={`flex min-h-0 min-w-0 items-center justify-center bg-background text-sm text-muted-foreground${panel === 1 ? " row-span-2" : ""}`}
        >
          Panel {panel}
        </section>
      ))}
    </div>
  );
}
