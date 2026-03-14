import { WorkflowGraph } from "./graph";
import { WorkflowState } from "./types";

export interface RunResult {
  state: WorkflowState;
  visited: string[];
}

export async function runWorkflow(
  graph: WorkflowGraph,
  initialState: WorkflowState
): Promise<RunResult> {
  const visited: string[] = [];
  let currentNodeId: string | undefined = graph.start;
  let state = initialState;

  while (currentNodeId) {
    if (visited.length >= 64) {
      throw new Error("Workflow exceeded the maximum number of allowed steps.");
    }

    const node = graph.getNode(currentNodeId);
    state = await node.run(state);
    visited.push(currentNodeId);
    currentNodeId = graph.next(currentNodeId, state);
  }

  return {
    state,
    visited
  };
}

