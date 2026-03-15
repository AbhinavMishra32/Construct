import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentPersistence } from "./agentPersistence";

test("local agent persistence stores planning state, knowledge, and generated blueprint records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-persistence-"));
  const previousBackend = process.env.CONSTRUCT_STORAGE_BACKEND;
  delete process.env.DATABASE_URL;
  process.env.CONSTRUCT_STORAGE_BACKEND = "local";

  const persistence = createAgentPersistence({
    rootDirectory: root,
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  try {
    await persistence.setPlanningState({
      session: {
        sessionId: "session-1",
        goal: "build a C compiler in Rust",
        normalizedGoal: "build a C compiler in Rust",
        learningStyle: "concept-first",
        detectedLanguage: "rust",
        detectedDomain: "compiler",
        createdAt: "2026-03-15T00:00:00.000Z",
        questions: []
      },
      plan: null
    });

    await persistence.setKnowledgeBase({
      updatedAt: "2026-03-15T00:00:00.000Z",
      concepts: [],
      goals: []
    });

    await persistence.saveGeneratedBlueprintRecord({
      sessionId: "session-1",
      goal: "build a C compiler in Rust",
      blueprintId: "blueprint-1",
      blueprintPath: path.join(root, ".construct", "generated-blueprints", "session-1", "project-blueprint.json"),
      projectRoot: path.join(root, ".construct", "generated-blueprints", "session-1"),
      blueprintJson: "{\"id\":\"blueprint-1\"}",
      planJson: "{\"sessionId\":\"session-1\"}",
      bundleJson: "{\"projectName\":\"Compiler\"}",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      isActive: false
    });

    await persistence.setActiveBlueprintState({
      blueprintPath: path.join(root, ".construct", "generated-blueprints", "session-1", "project-blueprint.json"),
      sessionId: "session-1",
      updatedAt: "2026-03-15T00:00:00.000Z"
    });

    const persistedState = await persistence.getPlanningState();
    const knowledgeBase = await persistence.getKnowledgeBase();
    const activeBlueprint = await persistence.getActiveBlueprintState();
    const blueprintRecord = await persistence.getGeneratedBlueprintRecord("session-1");

    assert.equal(persistedState?.session?.goal, "build a C compiler in Rust");
    assert.equal(knowledgeBase?.updatedAt, "2026-03-15T00:00:00.000Z");
    assert.equal(activeBlueprint?.sessionId, "session-1");
    assert.equal(blueprintRecord?.isActive, true);
  } finally {
    if (previousBackend) {
      process.env.CONSTRUCT_STORAGE_BACKEND = previousBackend;
    } else {
      delete process.env.CONSTRUCT_STORAGE_BACKEND;
    }

    await rm(root, { recursive: true, force: true });
  }
});
