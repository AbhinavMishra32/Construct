import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TestRunnerManager, resolveBlueprintStepRequest } from "./testRunner";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const blueprintPath = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "project-blueprint.json"
);
const failureFixtureRoot = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "test-fixtures",
  "jest-failure"
);
const timeoutFixtureRoot = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "test-fixtures",
  "jest-timeout"
);

test("resolveBlueprintStepRequest maps a blueprint step to a targeted Jest run", async () => {
  const request = await resolveBlueprintStepRequest({
    blueprintPath,
    stepId: "step.state-merge",
    timeoutMs: 4_000
  });

  assert.equal(request.adapter, "jest");
  assert.equal(path.basename(request.projectRoot), "workflow-runtime");
  assert.deepEqual(request.tests, ["tests/state.test.ts"]);
  assert.equal(request.timeoutMs, 4_000);
});

test("TestRunnerManager returns a passing structured result for a blueprint step", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runBlueprintStep({
    blueprintPath,
    stepId: "step.state-merge",
    timeoutMs: 10_000
  });

  assert.equal(result.status, "passed");
  assert.equal(result.adapter, "jest");
  assert.equal(result.timedOut, false);
  assert.equal(result.testsRun.includes("tests/state.test.ts"), true);
  assert.equal(result.failures.length, 0);
});

test("TestRunnerManager captures failing assertions as structured task failures", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runTask({
    stepId: "fixture.failure",
    adapter: "jest",
    projectRoot: failureFixtureRoot,
    tests: ["tests/math.test.js"],
    timeoutMs: 10_000
  });

  assert.equal(result.status, "failed");
  assert.equal(result.adapter, "jest");
  assert.equal(result.failures.length > 0, true);
  assert.match(result.failures[0].testName, /reports a structured failure/i);
  assert.equal(result.failures[0].message.length > 0, true);
  assert.equal(result.timedOut, false);
});

test("TestRunnerManager marks timed-out task runs explicitly", async () => {
  const manager = new TestRunnerManager();
  const result = await manager.runTask({
    stepId: "fixture.timeout",
    adapter: "jest",
    projectRoot: timeoutFixtureRoot,
    tests: ["tests/slow.test.js"],
    timeoutMs: 50
  });

  assert.equal(result.status, "failed");
  assert.equal(result.timedOut, true);
  assert.match(result.failures[0].message, /timed out/i);
});

