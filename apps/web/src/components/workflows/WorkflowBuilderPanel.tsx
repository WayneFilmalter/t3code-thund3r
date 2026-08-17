import { ArrowLeftIcon, Workflow } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

import { WorkflowsSubheader } from "./WorkflowsSubheader";

/**
 * Build-workflow view of the Workflows surface, reached from the list's "+" button. The
 * builder itself lands later; for now this is the frame (header with Back) it will fill.
 */
export function WorkflowBuilderPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowsSubheader>
        <Button type="button" variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
          Build workflow
        </span>
      </WorkflowsSubheader>
      <Empty>
        <EmptyMedia variant="icon">
          <Workflow className="size-4.5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Workflow builder</EmptyTitle>
          <EmptyDescription>
            Define the phases and agents of a workflow here. Coming soon.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
