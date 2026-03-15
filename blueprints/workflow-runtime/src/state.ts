import { WorkflowState } from "./types";

export interface StatePatch {
  value?: number;
  flagUpdates?: Record<string, boolean>;
  historyEntry?: string;
}

export function mergeState(state: WorkflowState, patch: StatePatch): WorkflowState {
  // TASK:state-merge
  return {
    value: patch.value ?? state.value,
    history: patch.historyEntry ? [...state.history, patch.historyEntry] : [...state.history],
    flags: {
      ...state.flags,
      ...patch.flagUpdates
    }
  };
}
