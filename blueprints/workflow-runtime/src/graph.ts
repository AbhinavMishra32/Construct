import { pickNextEdge } from "./edge";
import { WorkflowEdge, WorkflowNode, WorkflowState } from "./types";

export class WorkflowGraph {
  readonly start: string;
  private readonly nodes = new Map<string, WorkflowNode>();

  constructor(nodes: WorkflowNode[], private readonly edges: WorkflowEdge[], start: string) {
    this.start = start;

    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }

    if (!this.nodes.has(start)) {
      throw new Error(`Unknown start node: ${start}`);
    }
  }

  getNode(id: string): WorkflowNode {
    const node = this.nodes.get(id);

    if (!node) {
      throw new Error(`Unknown node: ${id}`);
    }

    return node;
  }

  next(currentId: string, state: WorkflowState): string | undefined {
    // TASK:graph-next
    return pickNextEdge(this.edges, currentId, state)?.to;
  }
}
