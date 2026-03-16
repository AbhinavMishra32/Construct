import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentPersistence } from "./agentPersistence";

test("local agent persistence stores planning state, knowledge, generated blueprints, and project summaries", async () => {
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
      blueprintJson: JSON.stringify({
        id: "blueprint-1",
        name: "Compiler",
        version: "0.1.0",
        description: "A compiler project",
        projectRoot: path.join(root, ".construct", "generated-blueprints", "session-1"),
        sourceProjectRoot: path.join(root, ".construct", "generated-blueprints", "session-1"),
        language: "Rust",
        entrypoints: ["src/main.rs"],
        files: {
          "src/main.rs": "// TASK:step-1\nfn main() {}\n"
        },
        steps: [
          {
            id: "step-1",
            title: "Intro step",
            summary: "Build the first compiler type.",
            doc: "Learn the first compiler type.",
            lessonSlides: ["## Tokens\n\nStart with a token type."],
            anchor: {
              file: "src/main.rs",
              marker: "TASK:step-1"
            },
            tests: ["tests/token.test.ts"],
            concepts: ["rust-enums"],
            constraints: [],
            checks: [],
            estimatedMinutes: 20,
            difficulty: "intro"
          }
        ],
        dependencyGraph: {
          nodes: [],
          edges: []
        },
        metadata: {
          createdBy: "Construct",
          createdAt: "2026-03-15T00:00:00.000Z",
          targetLanguage: "Rust",
          tags: ["compiler"]
        }
      }),
      planJson: JSON.stringify({
        sessionId: "session-1",
        goal: "build a C compiler in Rust",
        language: "Rust",
        domain: "compiler",
        learningStyle: "concept-first",
        summary: "Learn compiler fundamentals in order.",
        architecture: [
          {
            id: "tokens",
            label: "Tokens",
            kind: "component",
            summary: "Token representation",
            dependsOn: []
          }
        ],
        knowledgeGraph: {
          concepts: [
            {
              id: "rust-enums",
              label: "Rust enums",
              category: "language",
              path: ["rust-enums"],
              labelPath: ["Rust enums"],
              confidence: "new",
              rationale: "Needed for token representation."
            }
          ],
          strengths: [],
          gaps: ["rust-enums"]
        },
        steps: [
          {
            id: "step-1",
            title: "Intro step",
            kind: "implementation",
            objective: "Create the first token type.",
            rationale: "Needed before lexing.",
            concepts: ["rust-enums"],
            dependsOn: [],
            validationFocus: ["token-shape"],
            suggestedFiles: ["src/main.rs"],
            implementationNotes: ["Define the enum."],
            quizFocus: ["rust-enums"],
            hiddenValidationFocus: ["enum-compiles"]
          }
        ],
        suggestedFirstStepId: "step-1"
      }),
      bundleJson: JSON.stringify({
        projectName: "Compiler"
      }),
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
    const activeProject = await persistence.getActiveProject();
    const projects = await persistence.listProjects();

    assert.equal(persistedState?.session?.goal, "build a C compiler in Rust");
    assert.equal(knowledgeBase?.updatedAt, "2026-03-15T00:00:00.000Z");
    assert.equal(activeBlueprint?.sessionId, "session-1");
    assert.equal(blueprintRecord?.isActive, true);
    assert.equal(activeProject?.id, "session-1");
    assert.equal(activeProject?.totalSteps, 1);
    assert.equal(projects.length, 1);

    await persistence.updateProjectProgress({
      blueprintPath: path.join(root, ".construct", "generated-blueprints", "session-1", "project-blueprint.json"),
      stepId: "step-1",
      stepTitle: "Intro step",
      stepIndex: 0,
      totalSteps: 1,
      markStepCompleted: true,
      lastAttemptStatus: "passed"
    });

    const updatedProject = await persistence.getProject("session-1");
    assert.equal(updatedProject?.completedStepsCount, 1);
    assert.equal(updatedProject?.status, "completed");
  } finally {
    if (previousBackend) {
      process.env.CONSTRUCT_STORAGE_BACKEND = previousBackend;
    } else {
      delete process.env.CONSTRUCT_STORAGE_BACKEND;
    }

    await rm(root, { recursive: true, force: true });
  }
});
