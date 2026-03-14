import { WorkflowGraph } from "../src/graph";
import { createStepNode } from "../src/node";
import { runWorkflow } from "../src/runner";
import { WorkflowState } from "../src/types";

describe("runWorkflow", () => {
  it("executes nodes in order and follows conditional branches", async () => {
    const graph = new WorkflowGraph(
      [
        createStepNode("start", (state) => ({
          value: state.value + 1,
          flagUpdates: { reviewed: true }
        })),
        createStepNode("review", (state) => ({
          value: state.value + 2
        })),
        createStepNode("ship", (state) => ({
          value: state.value + 3,
          flagUpdates: { shipped: true }
        }))
      ],
      [
        { from: "start", to: "review", condition: (state) => Boolean(state.flags.reviewed) },
        { from: "review", to: "ship" }
      ],
      "start"
    );

    const initialState: WorkflowState = {
      value: 0,
      history: [],
      flags: {}
    };

    await expect(runWorkflow(graph, initialState)).resolves.toEqual({
      state: {
        value: 6,
        history: ["start", "review", "ship"],
        flags: {
          reviewed: true,
          shipped: true
        }
      },
      visited: ["start", "review", "ship"]
    });
  });
});
