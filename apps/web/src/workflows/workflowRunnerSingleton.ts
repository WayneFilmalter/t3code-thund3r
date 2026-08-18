import { WorkflowRunner } from "./workflowRunner";
import { createAtomRunnerPorts } from "./workflowRunner.ports";

let singleton: WorkflowRunner | null = null;

/** The app-wide runner bound to the atom registry; created on first use. */
export function getWorkflowRunner(): WorkflowRunner {
  if (singleton === null) singleton = new WorkflowRunner(createAtomRunnerPorts());
  return singleton;
}
