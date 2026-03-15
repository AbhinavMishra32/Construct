import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentPlannerService } from "./agentPlanner";

test("AgentPlannerService asks targeted Rust compiler questions from the goal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-planner-"));

  try {
    const planner = new AgentPlannerService(root, {
      now: () => new Date("2026-03-15T00:00:00.000Z")
    });
    const started = await planner.startPlanningSession({
      goal: "build a C compiler in Rust",
      learningStyle: "concept-first"
    });

    assert.equal(started.session.detectedLanguage, "rust");
    assert.equal(started.session.detectedDomain, "compiler");
    assert.ok(
      started.session.questions.some((question) => question.conceptId === "rust.ownership")
    );
    assert.ok(
      started.session.questions.some((question) => question.conceptId === "domain.parser-design")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AgentPlannerService generates different first steps for concept-first and build-first learners", async () => {
  const conceptFirstRoot = await mkdtemp(path.join(os.tmpdir(), "construct-agent-planner-"));
  const buildFirstRoot = await mkdtemp(path.join(os.tmpdir(), "construct-agent-planner-"));

  try {
    const conceptFirstPlanner = new AgentPlannerService(conceptFirstRoot);
    const buildFirstPlanner = new AgentPlannerService(buildFirstRoot);
    const conceptFirstSession = await conceptFirstPlanner.startPlanningSession({
      goal: "build a C compiler in Rust",
      learningStyle: "concept-first"
    });
    const buildFirstSession = await buildFirstPlanner.startPlanningSession({
      goal: "build a C compiler in Rust",
      learningStyle: "build-first"
    });

    const answers = conceptFirstSession.session.questions.map((question) => ({
      questionId: question.id,
      answerType: "option" as const,
      optionId:
        question.conceptId === "rust.structs" || question.conceptId === "rust.enums"
          ? "comfortable"
          : "new"
    })) as Array<{
      questionId: string;
      answerType: "option";
      optionId: "comfortable" | "shaky" | "new";
    }>;

    const conceptFirstPlan = await conceptFirstPlanner.completePlanningSession({
      sessionId: conceptFirstSession.session.sessionId,
      answers
    });
    const buildFirstPlan = await buildFirstPlanner.completePlanningSession({
      sessionId: buildFirstSession.session.sessionId,
      answers
    });

    assert.equal(conceptFirstPlan.plan.steps[0].kind, "skill");
    assert.equal(buildFirstPlan.plan.steps[0].kind, "implementation");
    assert.notEqual(conceptFirstPlan.plan.steps[0].id, buildFirstPlan.plan.steps[0].id);
  } finally {
    await rm(conceptFirstRoot, { recursive: true, force: true });
    await rm(buildFirstRoot, { recursive: true, force: true });
  }
});
