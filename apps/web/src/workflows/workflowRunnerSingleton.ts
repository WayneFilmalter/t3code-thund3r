import { WorkflowRunner } from "./workflowRunner";
import { createAtomRunnerPorts, type RunnerPorts } from "./workflowRunner.ports";

let ports: RunnerPorts | null = null;
let singleton: WorkflowRunner | null = null;

/** The app's one set of runner ports, shared by the runner and the "describe it" drafting turn. */
export function getWorkflowRunnerPorts(): RunnerPorts {
  if (ports === null) ports = createAtomRunnerPorts();
  return ports;
}

/** The app-wide runner bound to the atom registry; created on first use. */
export function getWorkflowRunner(): WorkflowRunner {
  if (singleton === null) singleton = new WorkflowRunner(getWorkflowRunnerPorts());
  return singleton;
}
