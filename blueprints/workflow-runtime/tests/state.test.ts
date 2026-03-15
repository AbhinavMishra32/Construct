import { mergeState } from "../src/state";
import { WorkflowState } from "../src/types";

describe("mergeState", () => {
  it("returns a new state object with merged flags and appended history", () => {
    const initialState: WorkflowState = {
      value: 1,
      history: ["boot"],
      flags: {
        ready: false
      }
    };

    const nextState = mergeState(initialState, {
      value: 2,
      flagUpdates: { ready: true, reviewed: true },
      historyEntry: "validate"
    });

    expect(nextState).not.toBe(initialState);
    expect(nextState.value).toBe(2);
    expect(nextState.history).toEqual(["boot", "validate"]);
    expect(nextState.flags).toEqual({
      ready: true,
      reviewed: true
    });
    expect(initialState.history).toEqual(["boot"]);
    expect(initialState.flags).toEqual({ ready: false });
  });
});

