import assert from "node:assert/strict";
import test from "node:test";

import type { BlueprintStep, ComprehensionCheck } from "../types";

import {
  buildGuidancePrompts,
  buildStepHints,
  evaluateCheckResponse,
  hasAnsweredCheck,
  resolveBlueprintDefinitionPath
} from "./guide";

const shortAnswerCheck: ComprehensionCheck = {
  id: "check.graph.1",
  type: "short-answer",
  prompt: "What should the graph do when multiple outgoing edges exist?",
  rubric: [
    "Mention evaluating conditions in order.",
    "Mention returning the first matching edge."
  ]
};

const mcqCheck: ComprehensionCheck = {
  id: "check.state.1",
  type: "mcq",
  prompt: "Why should Construct return a new workflow state instead of mutating the old one?",
  options: [
    { id: "a", label: "It keeps snapshots and retries deterministic." },
    { id: "b", label: "It makes the code shorter." }
  ],
  answer: "a"
};

const blueprintStep: BlueprintStep = {
  id: "step.runner-loop",
  title: "Execute the workflow loop",
  summary: "Walk from the graph start node until there is no next node, returning final state and visit order.",
  doc: "The runner is the core runtime.",
  anchor: {
    file: "src/runner.ts",
    marker: "TASK:runner-loop"
  },
  tests: ["tests/runner.test.ts"],
  concepts: ["async control flow", "runtime orchestration"],
  constraints: ["Track visit order.", "Stop when there is no next node."],
  checks: [mcqCheck],
  estimatedMinutes: 15,
  difficulty: "core"
};

test("evaluateCheckResponse marks the correct MCQ option as complete", () => {
  const result = evaluateCheckResponse(mcqCheck, "a");

  assert.equal(result.status, "complete");
  assert.match(result.message, /Correct/);
});

test("evaluateCheckResponse gives partial feedback for incomplete short answers", () => {
  const result = evaluateCheckResponse(
    shortAnswerCheck,
    "Evaluate each condition in order."
  );

  assert.equal(result.status, "needs-revision");
  assert.equal(result.coveredCriteria.length, 1);
  assert.equal(result.missingCriteria.length, 1);
});

test("hasAnsweredCheck requires a meaningful short-answer response", () => {
  assert.equal(hasAnsweredCheck(shortAnswerCheck, "too short"), true);
  assert.equal(hasAnsweredCheck(shortAnswerCheck, "brief"), false);
});

test("guide helpers produce deterministic prompts and blueprint paths", () => {
  const prompts = buildGuidancePrompts(blueprintStep);
  const hints = buildStepHints(blueprintStep);

  assert.equal(prompts.length, 3);
  assert.equal(hints.length, 3);
  assert.equal(
    resolveBlueprintDefinitionPath("blueprints/workflow-runtime"),
    "blueprints/workflow-runtime/project-blueprint.json"
  );
});
