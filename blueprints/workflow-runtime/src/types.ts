export type WorkflowFlags = Record<string, boolean>;

export interface WorkflowState {
  value: number;
  history: string[];
  flags: WorkflowFlags;
}

export interface WorkflowNode {
  id: string;
  run(state: WorkflowState): Promise<WorkflowState>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: (state: WorkflowState) => boolean;
}

