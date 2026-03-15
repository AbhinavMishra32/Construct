import { createStepNode } from "../src/node";
import { WorkflowState } from "../src/types";

describe("createStepNode", () => {
  it("applies async patches and defaults the history entry to the node id", async () => {
    const initialState: WorkflowState = {
      value: 3,
      history: [],
      flags: {}
    };

    const node = createStepNode("double", async (state) => ({
      value: state.value * 2
    }));

    await expect(node.run(initialState)).resolves.toEqual({
      value: 6,
      history: ["double"],
      flags: {}
    });
  });
});

