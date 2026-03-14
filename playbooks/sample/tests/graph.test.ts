import { WorkflowGraph } from "../src/graph";
import { createStepNode } from "../src/node";
import { WorkflowState } from "../src/types";

describe("WorkflowGraph.next", () => {
  it("returns the first matching conditional edge", () => {
    const graph = new WorkflowGraph(
      [
        createStepNode("start", () => ({})),
        createStepNode("review", () => ({})),
        createStepNode("ship", () => ({}))
      ],
      [
        { from: "start", to: "review", condition: (state) => !state.flags.approved },
        { from: "start", to: "ship" }
      ],
      "start"
    );

    const state: WorkflowState = {
      value: 0,
      history: [],
      flags: {
        approved: false
      }
    };

    expect(graph.next("start", state)).toBe("review");
  });

  it("returns undefined when no outgoing edge matches", () => {
    const graph = new WorkflowGraph(
      [createStepNode("finish", () => ({}))],
      [],
      "finish"
    );

    expect(
      graph.next("finish", {
        value: 0,
        history: [],
        flags: {}
      })
    ).toBeUndefined();
  });
});

