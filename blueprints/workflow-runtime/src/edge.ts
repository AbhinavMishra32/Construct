import { WorkflowEdge, WorkflowState } from "./types";

export function pickNextEdge(
  edges: WorkflowEdge[],
  currentId: string,
  state: WorkflowState
): WorkflowEdge | undefined {
  return edges.find((edge) => {
    if (edge.from !== currentId) {
      return false;
    }

    if (!edge.condition) {
      return true;
    }

    return edge.condition(state);
  });
}

