import { mergeState, StatePatch } from "./state";
import { WorkflowNode, WorkflowState } from "./types";

export type StepHandler = (state: WorkflowState) => Promise<StatePatch> | StatePatch;

export function createStepNode(id: string, handler: StepHandler): WorkflowNode {
  return {
    id,
    async run(state) {
      const patch = await handler(state);

      return mergeState(state, {
        ...patch,
        historyEntry: patch.historyEntry ?? id
      });
    }
  };
}

