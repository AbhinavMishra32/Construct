import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConstructAgentService } from "./agentService";

test("ConstructAgentService creates question and plan jobs and persists the resulting state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-service-"));
  let tick = 0;

  const service = new ConstructAgentService(root, {
    now: () => new Date(Date.UTC(2026, 2, 15, 0, 0, tick++)),
    search: {
      async research(query) {
        return {
          query,
          answer: "Compiler architecture typically starts with tokenization and parsing contracts.",
          sources: [
            {
              title: "Compiler architecture overview",
              url: "https://example.com/compiler-architecture",
              snippet: "Tokenization and parsing establish the first dependency chain."
            }
          ]
        };
      }
    },
    llm: {
      async parse({ schemaName, schema }) {
        if (schemaName === "construct_planning_question_draft") {
          return schema.parse({
            detectedLanguage: "rust",
            detectedDomain: "compiler",
            questions: [
              {
                conceptId: "rust.ownership",
                category: "language",
                prompt: "How comfortable are you with Rust ownership and borrowing?"
              },
              {
                conceptId: "rust.enums",
                category: "language",
                prompt: "How comfortable are you with Rust enums?"
              },
              {
                conceptId: "domain.tokens",
                category: "domain",
                prompt: "How comfortable are you with token design?"
              },
              {
                conceptId: "domain.parser-design",
                category: "domain",
                prompt: "How comfortable are you with recursive descent parser design?"
              }
            ]
          });
        }

        if (schemaName === "construct_generated_project_plan") {
          return schema.parse({
            summary: "Start with the token model and lexer contract, then move into parser scaffolding once ownership risks are addressed.",
            knowledgeGraph: {
              concepts: [
                {
                  id: "rust.ownership",
                  label: "Rust ownership",
                  category: "language",
                  confidence: "new",
                  rationale: "The learner reported low confidence and the parser will rely on safe borrowing."
                },
                {
                  id: "domain.tokens",
                  label: "Token modeling",
                  category: "domain",
                  confidence: "shaky",
                  rationale: "The learner can name tokens but needs stronger design support."
                }
              ],
              strengths: [],
              gaps: ["Rust ownership", "Token modeling"]
            },
            architecture: [
              {
                id: "skill.rust-ownership",
                label: "Rust ownership",
                kind: "skill",
                summary: "Support the ownership concepts needed for the lexer and parser.",
                dependsOn: []
              },
              {
                id: "component.token-model",
                label: "Token model",
                kind: "component",
                summary: "Define the token enum and shared lexer contract.",
                dependsOn: []
              },
              {
                id: "component.lexer",
                label: "Lexer",
                kind: "component",
                summary: "Scan raw source into tokens.",
                dependsOn: ["component.token-model"]
              }
            ],
            steps: [
              {
                id: "step.skill.rust-ownership",
                title: "Strengthen Rust ownership",
                kind: "skill",
                objective: "Practice the ownership moves needed for the compiler pipeline.",
                rationale: "Ownership is the main blocker for the upcoming parser work.",
                concepts: ["rust.ownership"],
                dependsOn: [],
                validationFocus: ["Can explain move vs borrow", "Can model borrowed token slices"],
                suggestedFiles: ["notes/ownership.md"],
                implementationNotes: ["Relate every example back to token and parser memory flow."],
                quizFocus: ["Can explain why borrowed views help the parser."],
                hiddenValidationFocus: ["Uses ownership language correctly in reflections."]
              },
              {
                id: "step.token-model",
                title: "Implement the token model",
                kind: "implementation",
                objective: "Define the token enum and shared lexer interface.",
                rationale: "The lexer and parser both depend on the token contract.",
                concepts: ["domain.tokens", "rust.enums"],
                dependsOn: ["step.skill.rust-ownership"],
                validationFocus: ["Token enum exists", "Shared token metadata is typed"],
                suggestedFiles: ["src/token.rs", "src/lexer.rs"],
                implementationNotes: ["Keep token variants compact and parser-friendly."],
                quizFocus: ["Can justify the chosen token shape."],
                hiddenValidationFocus: ["Validates token variants and metadata fields."]
              }
            ],
            suggestedFirstStepId: "step.skill.rust-ownership"
          });
        }

        if (schemaName === "construct_generated_blueprint_bundle") {
          return schema.parse({
            projectName: "Rust Compiler Foundations",
            projectSlug: "rust-compiler-foundations",
            description: "A generated starter compiler project with learner-owned lexer work.",
            language: "typescript",
            entrypoints: ["src/index.ts"],
            supportFiles: {
              "package.json": JSON.stringify({
                name: "@construct/generated-compiler",
                private: true,
                type: "module",
                scripts: {
                  test: "node ./node_modules/jest/bin/jest.js --runInBand"
                }
              }, null, 2),
              "jest.config.cjs": "module.exports = { testEnvironment: 'node' };\n",
              "src/index.ts": "export * from './lexer';\n",
              "src/token.ts": "export type Token = { kind: string; lexeme: string };\n"
            },
            canonicalFiles: {
              "src/lexer.ts": [
                "import type { Token } from './token';",
                "",
                "export function tokenize(source: string): Token[] {",
                "  return source",
                "    .split(/\\s+/)",
                "    .filter(Boolean)",
                "    .map((lexeme) => ({ kind: 'word', lexeme }));",
                "}"
              ].join("\n")
            },
            learnerFiles: {
              "src/lexer.ts": [
                "import type { Token } from './token';",
                "",
                "export function tokenize(source: string): Token[] {",
                "  // TASK:lexer-tokenize",
                "  throw new Error('Implement tokenize');",
                "}"
              ].join("\n")
            },
            hiddenTests: {
              "tests/lexer.test.ts": [
                "import { tokenize } from '../src/lexer';",
                "",
                "test('tokenize returns lexeme tokens in order', () => {",
                "  expect(tokenize('int main')).toEqual([",
                "    { kind: 'word', lexeme: 'int' },",
                "    { kind: 'word', lexeme: 'main' }",
                "  ]);",
                "});"
              ].join("\n")
            },
            steps: [
              {
                id: "step.lexer-tokenize",
                title: "Implement tokenize",
                summary: "Convert source text into ordered word tokens.",
                doc: "Start the project by defining the first real lexer behavior.",
                anchor: {
                  file: "src/lexer.ts",
                  marker: "TASK:lexer-tokenize"
                },
                tests: ["tests/lexer.test.ts"],
                concepts: ["tokenization", "array mapping"],
                constraints: ["Return tokens in source order."],
                checks: [
                  {
                    id: "check.lexer.1",
                    type: "mcq",
                    prompt: "Why does token order matter to a parser?",
                    options: [
                      {
                        id: "a",
                        label: "The parser consumes tokens in sequence."
                      },
                      {
                        id: "b",
                        label: "It makes tests shorter."
                      }
                    ],
                    answer: "a"
                  }
                ],
                estimatedMinutes: 12,
                difficulty: "intro"
              }
            ],
            dependencyGraph: {
              nodes: [
                {
                  id: "component.lexer",
                  label: "Lexer",
                  kind: "component"
                },
                {
                  id: "skill.tokenization",
                  label: "Tokenization",
                  kind: "skill"
                }
              ],
              edges: [
                {
                  from: "skill.tokenization",
                  to: "component.lexer",
                  reason: "The lexer depends on tokenization rules."
                }
              ]
            },
            tags: ["compiler", "generated"]
          });
        }

        if (schemaName === "construct_runtime_guide") {
          return schema.parse({
            summary: "The implementation is close, but the current return path still mutates state in-place.",
            observations: [
              "The failing test is checking immutability.",
              "The constraint explicitly says not to mutate the incoming state."
            ],
            socraticQuestions: [
              "Which value in your current function is still pointing at the original object?",
              "How would the test observe that mutation after the function returns?"
            ],
            hints: {
              level1: "Check the object you spread first and whether nested fields are still shared.",
              level2: "Create a fresh object for the outer state and any nested structure you update.",
              level3: "Return a new state object, then build a new nested field map before applying the patch."
            },
            nextAction: "Rewrite the state merge so both the outer object and the updated nested object are recreated."
          });
        }

        throw new Error(`Unexpected schema request: ${schemaName}`);
      }
    }
  });

  try {
    const questionJob = service.createPlanningQuestionsJob({
      goal: "build a C compiler in Rust",
      learningStyle: "concept-first"
    });
    const questionResult = await waitForJobCompletion(service, questionJob.jobId);
    const questionSession = questionResult.result as {
      session: { sessionId: string; detectedLanguage: string; questions: Array<{ id: string }> };
    };

    assert.equal(questionSession.session.detectedLanguage, "rust");
    assert.equal(questionSession.session.questions.length, 4);

    const planJob = service.createPlanningPlanJob({
      sessionId: questionSession.session.sessionId,
      answers: questionSession.session.questions.map((question, index) => ({
        questionId: question.id,
        value: index === 0 ? "new" : "shaky"
      }))
    });
    const planResult = await waitForJobCompletion(service, planJob.jobId);
    const planPayload = planResult.result as {
      plan: { steps: Array<{ id: string }>; suggestedFirstStepId: string };
    };

    assert.equal(planPayload.plan.steps.length, 2);
    assert.equal(planPayload.plan.suggestedFirstStepId, "step.skill.rust-ownership");

    const persistedPlanningState = await service.getCurrentPlanningState();
    assert.ok(persistedPlanningState.session);
    assert.ok(persistedPlanningState.plan);

    const generatedProjectDirectories = await readdir(
      path.join(root, ".construct", "generated-blueprints")
    );
    assert.equal(generatedProjectDirectories.length, 1);

    const generatedBlueprintPath = path.join(
      root,
      ".construct",
      "generated-blueprints",
      generatedProjectDirectories[0]!,
      "project-blueprint.json"
    );
    const generatedBlueprint = JSON.parse(
      await readFile(generatedBlueprintPath, "utf8")
    ) as {
      files: Record<string, string>;
      steps: Array<{ id: string }>;
    };
    assert.ok(generatedBlueprint.files["src/lexer.ts"]);
    assert.equal(generatedBlueprint.steps[0]?.id, "step.lexer-tokenize");

    const activeBlueprintState = JSON.parse(
      await readFile(path.join(root, ".construct", "state", "active-blueprint.json"), "utf8")
    ) as { blueprintPath: string };
    assert.equal(activeBlueprintState.blueprintPath, generatedBlueprintPath);
    assert.equal(await service.getActiveBlueprintPath(), generatedBlueprintPath);

    const knowledgeBaseRaw = await readFile(
      path.join(root, ".construct", "state", "user-knowledge.json"),
      "utf8"
    );
    const knowledgeBase = JSON.parse(knowledgeBaseRaw) as {
      concepts: Array<{ id: string }>;
      goals: Array<{ goal: string }>;
    };

    assert.ok(knowledgeBase.concepts.some((concept) => concept.id === "rust.ownership"));
    assert.equal(knowledgeBase.goals[0]?.goal, "build a C compiler in Rust");

    const resumedService = new ConstructAgentService(root, {
      now: () => new Date("2026-03-15T00:00:00.000Z")
    });
    const resumedState = await resumedService.getCurrentPlanningState();
    assert.equal(resumedState.session?.goal, "build a C compiler in Rust");
    assert.equal(await resumedService.getActiveBlueprintPath(), generatedBlueprintPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ConstructAgentService creates runtime guide jobs with Socratic prompts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-guide-"));

  const service = new ConstructAgentService(root, {
    now: () => new Date("2026-03-15T00:00:00.000Z"),
    search: {
      async research(query) {
        return {
          query,
          sources: []
        };
      }
    },
    llm: {
      async parse({ schemaName, schema }) {
        assert.equal(schemaName, "construct_runtime_guide");
        return schema.parse({
          summary: "The code still mutates the input object.",
          observations: ["The latest failure mentions shared state."],
          socraticQuestions: [
            "What object is still shared between the old and new state?"
          ],
          hints: {
            level1: "Follow the shared reference.",
            level2: "Clone the nested object before updating it.",
            level3: "Return a fresh top-level object and a fresh nested map."
          },
          nextAction: "Rewrite the merge to create a new outer and nested object."
        });
      }
    }
  });

  try {
    const job = service.createRuntimeGuideJob({
      stepId: "step.state-merge",
      stepTitle: "Implement immutable state updates",
      stepSummary: "Merge workflow state without mutating the original object.",
      filePath: "src/state.ts",
      anchorMarker: "TASK:state-merge",
      codeSnippet: "export function mergeState(state, patch) { return state; }",
      constraints: ["Do not mutate the incoming state."],
      tests: ["tests/state.test.ts"],
      taskResult: null,
      learnerModel: null
    });

    const result = await waitForJobCompletion(service, job.jobId);
    const payload = result.result as { socraticQuestions: string[]; hints: { level2: string } };

    assert.equal(payload.socraticQuestions.length, 1);
    assert.match(payload.hints.level2, /Clone the nested object/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForJobCompletion(
  service: ConstructAgentService,
  jobId: string
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const snapshot = service.getJob(jobId);

    if (snapshot.status === "completed") {
      return snapshot;
    }

    if (snapshot.status === "failed") {
      throw new Error(snapshot.error ?? `Agent job ${jobId} failed.`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Timed out waiting for agent job ${jobId}.`);
}
