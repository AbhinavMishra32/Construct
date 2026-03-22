import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { StoredKnowledgeConcept } from "@construct/shared";

import { ConstructAgentService } from "./agentService";
import { createAgentPersistence, type AgentPersistence } from "./agentPersistence";
import { findKnowledgeConcept } from "./knowledgeGraph";
import { prepareLearnerWorkspace } from "./workspaceMaterializer";

const previousStorageBackend = process.env.CONSTRUCT_STORAGE_BACKEND;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousDirectUrl = process.env.DIRECT_URL;

function markdownSlide(markdown: string) {
  return {
    blocks: [
      {
        type: "markdown" as const,
        markdown
      }
    ]
  };
}

test.before(() => {
  process.env.CONSTRUCT_STORAGE_BACKEND = "local";
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
});

test.after(() => {
  if (previousStorageBackend === undefined) {
    delete process.env.CONSTRUCT_STORAGE_BACKEND;
  } else {
    process.env.CONSTRUCT_STORAGE_BACKEND = previousStorageBackend;
  }

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }

  if (previousDirectUrl === undefined) {
    delete process.env.DIRECT_URL;
  } else {
    process.env.DIRECT_URL = previousDirectUrl;
  }
});

test("ConstructAgentService creates question and plan jobs and persists the resulting state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-service-"));
  let tick = 0;
  const loggedStages: string[] = [];
  const installCalls: Array<{ projectRoot: string; fileCount: number }> = [];

  const service = new ConstructAgentService(root, {
    now: () => new Date(Date.UTC(2026, 2, 15, 0, 0, tick++)),
    logger: {
      info(_message, context) {
        if (typeof context?.stage === "string") {
          loggedStages.push(context.stage);
        }
      },
      debug() {},
      trace() {},
      warn(_message, context) {
        if (typeof context?.stage === "string") {
          loggedStages.push(context.stage);
        }
      },
      error(_message, context) {
        if (typeof context?.stage === "string") {
          loggedStages.push(context.stage);
        }
      }
    },
    projectInstaller: {
      async install(projectRoot, files) {
        installCalls.push({
          projectRoot,
          fileCount: Object.keys(files).length
        });

        return {
          status: "installed",
          packageManager: "pnpm",
          manifestPath: "package.json"
        };
      }
    },
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
        if (schemaName === "construct_goal_self_report_signals") {
          return schema.parse({
            signals: []
          });
        }

        if (schemaName === "construct_goal_scope") {
          return schema.parse({
            scopeSummary: "Large compiler project",
            artifactShape: "compiler pipeline",
            complexityScore: 90,
            shouldResearch: true,
            recommendedQuestionCount: 4,
            recommendedMinSteps: 1,
            recommendedMaxSteps: 8,
            rationale: "A compiler is a systems project and should use the full Architect path."
          });
        }

        if (schemaName === "construct_planning_question_draft") {
          return schema.parse({
            detectedLanguage: "rust",
            detectedDomain: "compiler",
            questions: [
              {
                conceptId: "rust.ownership",
                category: "language",
                prompt: "How comfortable are you with Rust ownership and borrowing?",
                options: [
                  {
                    id: "solid",
                    label: "I use ownership confidently",
                    description: "Moves, borrows, and lifetimes are usually not blockers for me.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "I know the idea but still stumble",
                    description: "I can read ownership-related code, but I still need guidance writing it.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "blocked",
                    label: "I need this taught from scratch",
                    description: "Ownership and borrowing are still new enough that I need first-principles help.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "rust.enums",
                category: "language",
                prompt: "How comfortable are you with Rust enums?",
                options: [
                  {
                    id: "solid",
                    label: "I use enums comfortably",
                    description: "I can model parser/token states with enums without much help.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "I understand them but need reminders",
                    description: "I know the syntax, but I still need guidance on variant design.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "Enums are still new to me",
                    description: "I need enums explained before I can rely on them in project code.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "domain.tokens",
                category: "domain",
                prompt: "How comfortable are you with token design?",
                options: [
                  {
                    id: "solid",
                    label: "I can design token models",
                    description: "I know how to choose token variants and metadata for a lexer.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "I know the concept but not the design tradeoffs",
                    description: "I understand what tokens are, but I need help choosing a clean token shape.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "Token design is new to me",
                    description: "I need the Architect to teach token modeling before implementation.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "domain.parser-design",
                category: "domain",
                prompt: "How comfortable are you with recursive descent parser design?",
                options: [
                  {
                    id: "solid",
                    label: "I can design recursive descent parsers",
                    description: "I am comfortable breaking grammar into parse functions and precedence layers.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "I know the outline but not the implementation details",
                    description: "I understand the parser shape, but I still need guidance building one.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "Parser design is new to me",
                    description: "I need parser design taught before I can implement it.",
                    confidenceSignal: "new"
                  }
                ]
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
                  path: ["rust", "ownership"],
                  labelPath: ["Rust", "Ownership"],
                  confidence: "new",
                  rationale: "The learner reported low confidence and the parser will rely on safe borrowing."
                },
                {
                  id: "domain.tokens",
                  label: "Token modeling",
                  category: "domain",
                  path: ["domain", "tokens"],
                  labelPath: ["Compiler design", "Token modeling"],
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
            supportFiles: [
              {
                path: "package.json",
                content: JSON.stringify({
                  name: "@construct/generated-compiler",
                  private: true,
                  type: "module",
                  scripts: {
                    test: "node ./node_modules/jest/bin/jest.js --runInBand"
                  }
                }, null, 2)
              },
              {
                path: "jest.config.cjs",
                content: "module.exports = { testEnvironment: 'node' };\n"
              },
              {
                path: "src/index.ts",
                content: "export * from './lexer';\n"
              },
              {
                path: "src/token.ts",
                content: "export type Token = { kind: string; lexeme: string };\n"
              }
            ],
            canonicalFiles: [
              {
                path: "src/lexer.ts",
                content: [
                "import type { Token } from './token';",
                "",
                "export function tokenize(source: string): Token[] {",
                "  return source",
                "    .split(/\\s+/)",
                "    .filter(Boolean)",
                "    .map((lexeme) => ({ kind: 'word', lexeme }));",
                "}"
                ].join("\n")
              }
            ],
            learnerFiles: [
              {
                path: "src/lexer.ts",
                content: [
                "import type { Token } from './token';",
                "",
                "export function tokenize(source: string): Token[] {",
                "  // TASK:lexer-tokenize",
                "  throw new Error('Implement tokenize');",
                "}"
                ].join("\n")
              }
            ],
            hiddenTests: [
              {
                path: "tests/lexer.test.ts",
                content: [
                "import { tokenize } from '../src/lexer';",
                "",
                "test('tokenize returns lexeme tokens in order', () => {",
                "  expect(tokenize('int main')).toEqual([",
                "    { kind: 'word', lexeme: 'int' },",
                "    { kind: 'word', lexeme: 'main' }",
                "  ]);",
                "});"
                ].join("\n")
              }
            ],
            steps: [
              {
                id: "step.lexer-tokenize",
                title: "Implement tokenize",
                summary: "Convert source text into ordered word tokens.",
                doc: "Edit src/lexer.ts so tokenize splits the incoming source into whitespace-delimited lexemes and returns Token objects in the same order. The hidden test verifies that the resulting array preserves source order and uses the shared Token shape.",
                lessonSlides: [
                  markdownSlide("## Why tokenization comes first\nA compiler never reads raw characters all the way through every later phase. The lexer creates a cleaner vocabulary for the parser by turning source text into small structured token objects. We start here because it is the first meaningful behavior that unlocks parsing while still being small enough to reason about on its own."),
                  markdownSlide("## What the lexer is modeling\nFor this tiny compiler step, every whitespace-delimited word becomes a token with two pieces of information: its kind and its original lexeme. The important idea is not just splitting a string, but creating a stable sequence that preserves source order so later phases can trust the token stream."),
                  markdownSlide("## Mental model for the implementation\nThink of `tokenize` as a transformation pipeline: raw source goes in, empty gaps are ignored, and each real lexeme becomes a `{ kind, lexeme }` record. If the lexer changes order or shape, the parser will read the wrong program, so deterministic mapping matters more than clever code.")
                ],
                anchor: {
                  file: "src/lexer.ts",
                  marker: "TASK:lexer-tokenize",
                  startLine: null,
                  endLine: null
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
                        label: "The parser consumes tokens in sequence.",
                        rationale: null
                      },
                      {
                        id: "b",
                        label: "It makes tests shorter.",
                        rationale: null
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

        if (schemaName === "construct_authored_blueprint_step") {
          return schema.parse({
            summary: "Convert source text into ordered word tokens.",
            doc: "Edit `src/lexer.ts` at the `TASK:lexer-tokenize` anchor. Implement `tokenize(source)` so it turns whitespace-delimited words into `Token` objects in the same order they appear in the source. The hidden test checks the output shape and preserves source order.",
            lessonSlides: [
              markdownSlide("## Why tokenization is the first real compiler behavior\n\nA compiler cannot reason directly about raw characters forever. The lexer creates the first stable interface for the rest of the pipeline by turning source text into structured tokens. That is why we start here: once tokenization works, the parser can depend on a predictable stream instead of re-reading raw text.\n\n## What matters in this small step\n\nFor this first version, we are intentionally keeping the token model tiny. Every non-empty whitespace-delimited word becomes a token with a `kind` and its original `lexeme`. The important lesson is not the regex itself. The important lesson is that later stages need a deterministic, ordered representation of the program."),
              markdownSlide("## The data shape the parser will trust\n\nThink of a token as a small contract between stages.\n\n- `kind` tells later code how to interpret the piece of syntax\n- `lexeme` preserves the original source fragment\n- array order preserves program order\n\n## Common mistakes\n\nIf the lexer changes the order, drops values incorrectly, or returns a different shape each time, every later stage becomes harder to build. That is why this exercise focuses on producing a stable array of small records rather than on advanced compiler behavior."),
              markdownSlide("## A worked mental model for `tokenize`\n\nThe implementation can be understood as a three-part pipeline:\n\n1. split the input on whitespace\n2. remove empty fragments\n3. map each real lexeme into a `Token`\n\n## Example\n\n```ts\nconst words = source.split(/\\s+/).filter(Boolean)\nreturn words.map((lexeme) => ({ kind: 'word', lexeme }))\n```\n\nThis sketch is not about cleverness. It is about making the transformation easy to read and easy to trust. Later compiler steps benefit from small, boring, deterministic code here.")
            ],
            checks: [
              {
                id: "check.lexer.1",
                type: "mcq",
                prompt: "Why is preserving token order part of the lexer contract?",
                options: [
                  {
                    id: "a",
                    label: "Because later compiler stages consume tokens in sequence.",
                    rationale: null
                  },
                  {
                    id: "b",
                    label: "Because order only matters for making tests shorter.",
                    rationale: null
                  }
                ],
                answer: "a"
              }
            ]
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
    assert.ok(loggedStages.includes("research-project-shape"));
    assert.ok(loggedStages.includes("research-prerequisites"));
    assert.ok(loggedStages.includes("research-merge"));

    const planJob = service.createPlanningPlanJob({
      sessionId: questionSession.session.sessionId,
      answers: questionSession.session.questions.map((question, index) => ({
        questionId: question.id,
        answerType: "option" as const,
        optionId: index === 0 ? "blocked" : "partial"
      }))
    });
    const planResult = await waitForJobCompletion(service, planJob.jobId);
    const planPayload = planResult.result as {
      plan: { steps: Array<{ id: string }>; suggestedFirstStepId: string };
    };

    assert.equal(planPayload.plan.steps.length, 2);
    assert.equal(planPayload.plan.suggestedFirstStepId, "step.skill.rust-ownership");
    assert.ok(loggedStages.includes("research-architecture"));
    assert.ok(loggedStages.includes("research-dependency-order"));
    assert.ok(loggedStages.includes("research-validation-strategy"));
    assert.ok(loggedStages.includes("research-merge"));
    assert.ok(loggedStages.includes("blueprint-layout"));
    assert.ok(loggedStages.includes("blueprint-support-files"));
    assert.ok(loggedStages.includes("blueprint-canonical-files"));
    assert.ok(loggedStages.includes("blueprint-hidden-tests"));
    assert.ok(loggedStages.includes("blueprint-learner-mask"));
    assert.ok(loggedStages.includes("blueprint-dependency-install"));
    assert.ok(loggedStages.includes("blueprint-activation"));
    assert.equal(installCalls.length, 1);

    const persistedPlanningState = await service.getCurrentPlanningState();
    assert.ok(persistedPlanningState.session);
    assert.ok(persistedPlanningState.plan);
    assert.equal(persistedPlanningState.answers.length, 4);

    const blueprintBuilds = await service.listBlueprintBuilds();
    const activeBuild =
      blueprintBuilds.find((build) => build.sessionId === questionSession.session.sessionId) ?? null;
    const blueprintBuildDetail = activeBuild
      ? await service.getBlueprintBuildDetail(activeBuild.id)
      : null;

    assert.equal(activeBuild?.status, "completed");
    assert.ok(blueprintBuildDetail?.events.some((event) => event.stage === "blueprint-activation"));
    assert.ok(blueprintBuildDetail?.stages.some((stage) => stage.stage === "plan-generation"));

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
      spine: { commitGraph: Array<{ id: string }> } | null;
      frontier: { steps: Array<{ id: string }>; activeStepId: string | null } | null;
    };
    assert.ok(generatedBlueprint.files["src/lexer.ts"]);
    assert.equal(generatedBlueprint.steps[0]?.id, "step.lexer-tokenize");
    assert.equal(
      generatedBlueprint.spine?.commitGraph[0]?.id,
      "commit.step-skill-rust-ownership"
    );
    assert.equal(generatedBlueprint.frontier?.steps[0]?.id, "step.lexer-tokenize");
    assert.equal(generatedBlueprint.frontier?.activeStepId, "step.lexer-tokenize");

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
      concepts: StoredKnowledgeConcept[];
      goals: Array<{ goal: string }>;
    };

    assert.ok(findKnowledgeConcept(knowledgeBase.concepts, "rust.ownership"));
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

test("ConstructAgentService advances the adaptive frontier after a passed step and grows the learner workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-frontier-"));
  let tick = 0;

  const service = new ConstructAgentService(root, {
    now: () => new Date(Date.UTC(2026, 2, 16, 0, 0, tick++)),
    logger: {
      info() {},
      debug() {},
      trace() {},
      warn() {},
      error() {}
    },
    projectInstaller: {
      async install() {
        return {
          status: "skipped",
          packageManager: "none",
          detail: "No install needed for this frontier test."
        };
      }
    },
    search: {
      async research(query) {
        return {
          query,
          answer: "Build the parser in small staged files.",
          sources: []
        };
      }
    },
    llm: {
      async parse({ schemaName, schema }) {
        if (schemaName === "construct_goal_self_report_signals") {
          return schema.parse({ signals: [] });
        }

        if (schemaName === "construct_goal_scope") {
          return schema.parse({
            scopeSummary: "Small staged parser project",
            artifactShape: "parser utility",
            complexityScore: 42,
            shouldResearch: false,
            recommendedQuestionCount: 2,
            recommendedMinSteps: 3,
            recommendedMaxSteps: 5,
            rationale: "The request is compact enough to skip broad research."
          });
        }

        if (schemaName === "construct_planning_question_draft") {
          return schema.parse({
            detectedLanguage: "typescript",
            detectedDomain: "parser",
            questions: [
              {
                conceptId: "typescript.functions",
                category: "language",
                prompt: "How comfortable are you with small TypeScript utility functions?",
                options: [
                  {
                    id: "solid",
                    label: "Comfortable",
                    description: "I can write small utility functions without much help.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "Need reminders",
                    description: "I know the shape, but I still want guidance.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "Need first-principles help",
                    description: "I need the implementation path broken down carefully.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "domain.parsers",
                category: "domain",
                prompt: "How comfortable are you with incremental parser construction?",
                options: [
                  {
                    id: "solid",
                    label: "Comfortable",
                    description: "I know how to stage parser pieces over a few commits.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "Somewhat comfortable",
                    description: "I understand the idea, but I want help sequencing it.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "New to me",
                    description: "I need the build path staged carefully.",
                    confidenceSignal: "new"
                  }
                ]
              }
            ]
          });
        }

        if (schemaName === "construct_generated_project_plan") {
          return schema.parse({
            summary: "Start with one import parser, then grow the repo with export and entrypoint parsing.",
            knowledgeGraph: {
              concepts: [
                {
                  id: "typescript.functions",
                  label: "TypeScript utility functions",
                  category: "language",
                  path: ["typescript", "functions"],
                  labelPath: ["TypeScript", "Functions"],
                  confidence: "shaky",
                  rationale: "The learner wants step-by-step help."
                }
              ],
              strengths: [],
              gaps: ["TypeScript utility functions"]
            },
            architecture: [
              {
                id: "component.imports",
                label: "Import parsing",
                kind: "component",
                summary: "Parse import lines into a tiny structure.",
                dependsOn: []
              },
              {
                id: "component.exports",
                label: "Export parsing",
                kind: "component",
                summary: "Parse export lines once import parsing exists.",
                dependsOn: ["component.imports"]
              },
              {
                id: "component.entrypoint",
                label: "Entrypoint parsing",
                kind: "component",
                summary: "Recognize the first executable statement after imports and exports.",
                dependsOn: ["component.exports"]
              }
            ],
            steps: [
              {
                id: "step.parse-imports",
                title: "Parse import lines",
                kind: "implementation",
                objective: "Parse import lines from a source file.",
                rationale: "Imports are the first real parser behavior and unlock the rest of the staged repo.",
                concepts: ["typescript.functions", "domain.parsers"],
                dependsOn: [],
                validationFocus: ["Returns one node per import line."],
                suggestedFiles: ["src/imports.ts"],
                implementationNotes: ["Keep the parser tiny and deterministic."],
                quizFocus: ["Why staged parsing keeps the repo coherent."],
                hiddenValidationFocus: ["Parses imports in source order."]
              },
              {
                id: "step.parse-exports",
                title: "Parse export lines",
                kind: "implementation",
                objective: "Extend the parser to recognize export lines.",
                rationale: "Exports are the next visible capability after imports.",
                concepts: ["domain.parsers"],
                dependsOn: ["step.parse-imports"],
                validationFocus: ["Returns one node per export line."],
                suggestedFiles: ["src/exports.ts"],
                implementationNotes: ["Reuse the tiny string scanning style from imports."],
                quizFocus: ["Why export parsing belongs in its own step."],
                hiddenValidationFocus: ["Keeps export parsing independent of imports."]
              },
              {
                id: "step.parse-entrypoint",
                title: "Parse the entrypoint statement",
                kind: "implementation",
                objective: "Identify the first executable statement after imports and exports.",
                rationale: "The entrypoint step makes the parser visibly more complete.",
                concepts: ["domain.parsers"],
                dependsOn: ["step.parse-exports"],
                validationFocus: ["Returns the first executable statement."],
                suggestedFiles: ["src/entrypoint.ts"],
                implementationNotes: ["Use the import/export helpers instead of duplicating scans."],
                quizFocus: ["Why the parser spine needs this after imports and exports."],
                hiddenValidationFocus: ["Skips import and export declarations when finding the entrypoint."]
              }
            ],
            suggestedFirstStepId: "step.parse-imports"
          });
        }

        if (schemaName === "construct_generated_blueprint_bundle") {
          return schema.parse({
            projectName: "Tiny Module Graph",
            projectSlug: "tiny-module-graph",
            description: "A staged parser project that grows file by file.",
            language: "typescript",
            entrypoints: ["src/index.ts"],
            supportFiles: [
              {
                path: "package.json",
                content: JSON.stringify({
                  name: "@construct/tiny-module-graph",
                  private: true,
                  type: "module"
                }, null, 2)
              },
              {
                path: "src/index.ts",
                content: [
                  "export * from './imports';",
                  "export * from './exports';",
                  "export * from './entrypoint';"
                ].join("\n")
              }
            ],
            canonicalFiles: [
              {
                path: "src/imports.ts",
                content: [
                  "export function parseImports(source: string): string[] {",
                  "  return source.split('\\n').filter((line) => line.startsWith('import '));",
                  "}"
                ].join("\n")
              },
              {
                path: "src/exports.ts",
                content: [
                  "export function parseExports(source: string): string[] {",
                  "  return source.split('\\n').filter((line) => line.startsWith('export '));",
                  "}"
                ].join("\n")
              },
              {
                path: "src/entrypoint.ts",
                content: [
                  "export function parseEntrypoint(source: string): string | null {",
                  "  return source.split('\\n').find((line) => !line.startsWith('import ') && !line.startsWith('export ')) ?? null;",
                  "}"
                ].join("\n")
              }
            ],
            learnerFiles: [
              {
                path: "src/imports.ts",
                content: [
                  "export function parseImports(source: string): string[] {",
                  "  // TASK:parse-imports",
                  "  throw new Error('Implement import parsing');",
                  "}"
                ].join("\n")
              }
            ],
            hiddenTests: [
              {
                path: "tests/imports.test.ts",
                content: [
                  "import { parseImports } from '../src/imports';",
                  "",
                  "test('parseImports keeps import lines in order', () => {",
                  "  expect(parseImports('import a\\nconst x = 1\\nimport b')).toEqual(['import a', 'import b']);",
                  "});"
                ].join("\n")
              }
            ],
            steps: [
              {
                id: "step.parse-imports",
                title: "Parse import lines",
                summary: "Implement the first staged parser capability.",
                doc: "Edit src/imports.ts at TASK:parse-imports and return import lines in order.",
                lessonSlides: [
                  markdownSlide("## Why imports come first\nThis is the first visible parser capability."),
                  markdownSlide("## What the parser must preserve\nKeep import lines in source order.")
                ],
                anchor: {
                  file: "src/imports.ts",
                  marker: "TASK:parse-imports",
                  startLine: null,
                  endLine: null
                },
                tests: ["tests/imports.test.ts"],
                concepts: ["typescript.functions", "domain.parsers"],
                constraints: ["Keep import lines in source order."],
                checks: [
                  {
                    id: "check.imports.1",
                    type: "mcq",
                    prompt: "Why should this parser keep source order?",
                    options: [
                      { id: "a", label: "Later parsing stages depend on the original order.", rationale: null },
                      { id: "b", label: "It only matters for prettier diffs.", rationale: null }
                    ],
                    answer: "a"
                  }
                ],
                estimatedMinutes: 10,
                difficulty: "intro"
              }
            ],
            dependencyGraph: {
              nodes: [
                { id: "component.imports", label: "Import parsing", kind: "component" },
                { id: "component.exports", label: "Export parsing", kind: "component" },
                { id: "component.entrypoint", label: "Entrypoint parsing", kind: "component" }
              ],
              edges: [
                { from: "component.imports", to: "component.exports", reason: "Exports build on the staged parser spine." },
                { from: "component.exports", to: "component.entrypoint", reason: "Entrypoint parsing depends on skipping imports and exports." }
              ]
            },
            tags: ["parser", "frontier"]
          });
        }

        if (schemaName === "construct_authored_blueprint_step") {
          return schema.parse({
            summary: "Implement the first staged parser capability.",
            doc: "Edit `src/imports.ts` at `TASK:parse-imports` and return import lines in source order.",
            lessonSlides: [
              markdownSlide("## Why this capability matters\nThe parser spine starts with a tiny import recognizer."),
              markdownSlide("## How the implementation works\nSplit on newlines, keep only import lines, and preserve order."),
              markdownSlide("## How this maps to the next capability\nOnce imports work, exports can grow as the next frontier.")
            ],
            checks: [
              {
                id: "check.imports.1",
                type: "mcq",
                prompt: "Why should the parser keep import lines in order?",
                options: [
                  { id: "a", label: "Later stages depend on source order.", rationale: null },
                  { id: "b", label: "It only affects formatting.", rationale: null }
                ],
                answer: "a"
              }
            ]
          });
        }

        if (schemaName === "construct_generated_adaptive_frontier") {
          return schema.parse({
            learnerFiles: [
              {
                path: "src/exports.ts",
                content: [
                  "export function parseExports(source: string): string[] {",
                  "  // TASK:parse-exports",
                  "  throw new Error('Implement export parsing');",
                  "}"
                ].join("\n")
              },
              {
                path: "src/entrypoint.ts",
                content: [
                  "export function parseEntrypoint(source: string): string | null {",
                  "  // TASK:parse-entrypoint",
                  "  throw new Error('Implement entrypoint parsing');",
                  "}"
                ].join("\n")
              }
            ],
            hiddenTests: [
              {
                path: "tests/exports.test.ts",
                content: [
                  "import { parseExports } from '../src/exports';",
                  "",
                  "test('parseExports keeps export lines in order', () => {",
                  "  expect(parseExports('export a\\nconst x = 1\\nexport b')).toEqual(['export a', 'export b']);",
                  "});"
                ].join("\n")
              },
              {
                path: "tests/entrypoint.test.ts",
                content: [
                  "import { parseEntrypoint } from '../src/entrypoint';",
                  "",
                  "test('parseEntrypoint skips imports and exports', () => {",
                  "  expect(parseEntrypoint('import a\\nexport b\\nrun()')).toBe('run()');",
                  "});"
                ].join("\n")
              }
            ],
            steps: [
              {
                id: "step.parse-exports",
                title: "Parse export lines",
                summary: "Grow the parser with export recognition.",
                doc: "Edit src/exports.ts at TASK:parse-exports and return export lines in order.",
                lessonSlides: [
                  markdownSlide("## Why exports are next\nThe visible repo grows once imports are stable."),
                  markdownSlide("## What stays the same\nUse the same deterministic line scanning style as the imports step.")
                ],
                anchor: {
                  file: "src/exports.ts",
                  marker: "TASK:parse-exports",
                  startLine: null,
                  endLine: null
                },
                tests: ["tests/exports.test.ts"],
                concepts: ["domain.parsers"],
                constraints: ["Keep export lines in source order."],
                checks: [
                  {
                    id: "check.exports.1",
                    type: "mcq",
                    prompt: "Why is this a separate frontier step instead of part of imports?",
                    options: [
                      { id: "a", label: "It adds one capability while keeping the staged repo runnable.", rationale: null },
                      { id: "b", label: "It only changes the project name.", rationale: null }
                    ],
                    answer: "a"
                  }
                ],
                estimatedMinutes: 10,
                difficulty: "core"
              },
              {
                id: "step.parse-entrypoint",
                title: "Parse the entrypoint statement",
                summary: "Add the next visible parser behavior after imports and exports.",
                doc: "Edit src/entrypoint.ts at TASK:parse-entrypoint and return the first executable statement.",
                lessonSlides: [
                  markdownSlide("## Why the entrypoint matters\nThis step makes the parser visibly more complete."),
                  markdownSlide("## How to scan for it\nSkip imports and exports, then keep the first executable line.")
                ],
                anchor: {
                  file: "src/entrypoint.ts",
                  marker: "TASK:parse-entrypoint",
                  startLine: null,
                  endLine: null
                },
                tests: ["tests/entrypoint.test.ts"],
                concepts: ["domain.parsers"],
                constraints: ["Skip imports and exports before choosing the entrypoint."],
                checks: [
                  {
                    id: "check.entrypoint.1",
                    type: "mcq",
                    prompt: "What should the parser skip before selecting the entrypoint?",
                    options: [
                      { id: "a", label: "Import and export declarations", rationale: null },
                      { id: "b", label: "Every line with text", rationale: null }
                    ],
                    answer: "a"
                  }
                ],
                estimatedMinutes: 12,
                difficulty: "core"
              }
            ]
          });
        }

        throw new Error(`Unexpected schema request: ${schemaName}`);
      }
    }
  });

  try {
    const questionJob = service.createPlanningQuestionsJob({
      goal: "build a tiny module graph parser",
      learningStyle: "build-first"
    });
    const questionResult = await waitForJobCompletion(service, questionJob.jobId);
    const questionSession = questionResult.result as {
      session: { sessionId: string; questions: Array<{ id: string }> };
    };

    const planJob = service.createPlanningPlanJob({
      sessionId: questionSession.session.sessionId,
      answers: questionSession.session.questions.map((question) => ({
        questionId: question.id,
        answerType: "option" as const,
        optionId: "partial"
      }))
    });
    await waitForJobCompletion(service, planJob.jobId);

    const generatedProjectDirectories = await readdir(
      path.join(root, ".construct", "generated-blueprints")
    );
    const generatedBlueprintPath = path.join(
      root,
      ".construct",
      "generated-blueprints",
      generatedProjectDirectories[0]!,
      "project-blueprint.json"
    );

    const prepared = await prepareLearnerWorkspace(generatedBlueprintPath);
    assert.equal(existsSync(path.join(prepared.learnerWorkspaceRoot, "src", "imports.ts")), true);
    assert.equal(existsSync(path.join(prepared.learnerWorkspaceRoot, "src", "exports.ts")), false);
    assert.equal(existsSync(path.join(prepared.learnerWorkspaceRoot, "src", "entrypoint.ts")), false);

    await writeFile(
      path.join(prepared.learnerWorkspaceRoot, "src", "imports.ts"),
      [
        "export function parseImports(source: string): string[] {",
        "  return source.split('\\n').filter((line) => line.startsWith('import '));",
        "}"
      ].join("\n"),
      "utf8"
    );

    const frontierUpdated = await service.syncProjectTaskProgress({
      canonicalBlueprintPath: generatedBlueprintPath,
      stepId: "step.parse-imports",
      markStepCompleted: true,
      lastAttemptStatus: "passed",
      telemetry: {
        hintsUsed: 1,
        pasteRatio: 0.05,
        typedChars: 120,
        pastedChars: 4
      }
    });

    assert.equal(frontierUpdated, true);

    const updatedBlueprint = JSON.parse(
      await readFile(generatedBlueprintPath, "utf8")
    ) as {
      files: Record<string, string>;
      frontier: { stepIds: string[]; activeStepId: string | null } | null;
    };
    assert.deepEqual(updatedBlueprint.frontier?.stepIds, [
      "step.parse-exports",
      "step.parse-entrypoint"
    ]);
    assert.equal(updatedBlueprint.frontier?.activeStepId, "step.parse-exports");
    assert.match(updatedBlueprint.files["src/imports.ts"] ?? "", /return source\.split/);
    assert.match(updatedBlueprint.files["src/exports.ts"] ?? "", /TASK:parse-exports/);
    assert.match(updatedBlueprint.files["src/entrypoint.ts"] ?? "", /TASK:parse-entrypoint/);

    assert.equal(existsSync(path.join(prepared.learnerWorkspaceRoot, "src", "exports.ts")), true);
    assert.equal(existsSync(path.join(prepared.learnerWorkspaceRoot, "src", "entrypoint.ts")), true);

    const dashboard = await service.listProjectsDashboard();
    const activeProject =
      dashboard.projects.find((project) => project.id === dashboard.activeProjectId) ?? null;
    assert.equal(activeProject?.currentStepId, "step.parse-exports");
    assert.equal(activeProject?.completedStepsCount, 1);
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

test("ConstructAgentService skips broad research for small local goals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-small-scope-"));
  let searchCalls = 0;
  const loggedStages: string[] = [];

  const service = new ConstructAgentService(root, {
    now: () => new Date("2026-03-15T00:00:00.000Z"),
    logger: {
      info(_message, context) {
        if (typeof context?.stage === "string") {
          loggedStages.push(`${context.stage}:${String(context.title ?? "")}`);
        }
      },
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    search: {
      async research(query) {
        searchCalls += 1;
        return {
          query,
          answer: "unused",
          sources: []
        };
      }
    },
    projectInstaller: {
      async install() {
        return {
          status: "skipped",
          packageManager: "none",
          detail: "No supported dependency manifest was generated."
        };
      }
    },
    llm: {
      async parse({ schemaName, schema }) {
        if (schemaName === "construct_goal_self_report_signals") {
          return schema.parse({
            signals: []
          });
        }

        if (schemaName === "construct_goal_scope") {
          return schema.parse({
            scopeSummary: "Tiny local class implementation",
            artifactShape: "todo class",
            complexityScore: 8,
            shouldResearch: false,
            recommendedQuestionCount: 2,
            recommendedMinSteps: 1,
            recommendedMaxSteps: 2,
            rationale: "The request is explicitly for a small local Python todo class."
          });
        }

        if (schemaName === "construct_planning_question_draft") {
          return schema.parse({
            detectedLanguage: "python",
            detectedDomain: "todo class",
            questions: [
              {
                conceptId: "python.classes",
                category: "language",
                prompt: "How comfortable are you with Python classes?",
                options: [
                  {
                    id: "fast",
                    label: "I can write classes already",
                    description: "Python classes and methods are not a blocker for me here.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "needs-reminder",
                    label: "I know them but want reminders",
                    description: "I understand the basics, but I want light guidance while building.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "I need classes taught from scratch",
                    description: "I want the Architect to assume I need explicit help with Python classes.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "python.state",
                category: "domain",
                prompt: "How comfortable are you with storing todo items in memory?",
                options: [
                  {
                    id: "fast",
                    label: "In-memory state is easy for me",
                    description: "I can model a small in-memory todo list without extra teaching.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "needs-reminder",
                    label: "I want a quick refresher",
                    description: "I understand lists and state, but I want the project path to stay guided.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "I need in-memory state explained first",
                    description: "I want Construct to teach the basics of representing todo items in memory.",
                    confidenceSignal: "new"
                  }
                ]
              }
            ]
          });
        }

        if (schemaName === "construct_generated_project_plan") {
          return schema.parse({
            summary: "Build a small todo class first, then add a minimal validation path.",
            knowledgeGraph: {
              concepts: [
                {
                  id: "python.classes",
                  label: "Python classes",
                  category: "language",
                  path: ["python", "classes"],
                  labelPath: ["Python", "Classes"],
                  confidence: "comfortable",
                  rationale: "The learner is already comfortable with simple Python class structure."
                }
              ],
              strengths: ["Python classes"],
              gaps: ["Python classes"]
            },
            architecture: [
              {
                id: "component.todo-class",
                label: "Todo class",
                kind: "component",
                summary: "A single class that manages todo items in memory.",
                dependsOn: []
              }
            ],
            steps: [
              {
                id: "step.todo-class",
                title: "Implement the todo class",
                kind: "implementation",
                objective: "Create a small TodoList class with add and list methods.",
                rationale: "The request is explicitly for a small class.",
                concepts: ["python.classes"],
                dependsOn: [],
                validationFocus: ["Class exists", "add/list behavior works"],
                suggestedFiles: ["todo.py"],
                implementationNotes: ["Keep everything in a single module."],
                quizFocus: ["Can explain how the class stores items."],
                hiddenValidationFocus: ["Validates constructor and method behavior."]
              }
            ],
            suggestedFirstStepId: "step.todo-class"
          });
        }

        if (schemaName === "construct_generated_blueprint_bundle") {
          return schema.parse({
            projectName: "Small Python Todo Class",
            projectSlug: "small-python-todo-class",
            description: "A minimal class-based todo implementation.",
            language: "python",
            entrypoints: ["todo.py"],
            supportFiles: [
              {
                path: "README.md",
                content: "# Small Python Todo Class\n"
              }
            ],
            canonicalFiles: [
              {
                path: "todo.py",
                content: "class TodoList:\n    def __init__(self):\n        self.items = []\n"
              }
            ],
            learnerFiles: [
              {
                path: "todo.py",
                content: "class TodoList:\n    # TASK:todo-class\n    raise NotImplementedError\n"
              }
            ],
            hiddenTests: [
              {
                path: "tests/test_todo.py",
                content: "def test_placeholder():\n    assert True\n"
              }
            ],
            steps: [
              {
                id: "step.todo-class",
                title: "Implement the todo class",
                summary: "Create the TodoList class.",
                doc: "Edit todo.py to define the TodoList class in a single module, store items in memory, and expose the constructor plus add/list behavior the tests exercise. The hidden test checks that a new instance starts empty and that added items are returned in insertion order.",
                lessonSlides: [
                  markdownSlide("## Why the class itself is the first lesson\nThe learner asked for a small Python todo class, so the real artifact is the class design itself, not packaging or setup. A good first step teaches how a class holds state and exposes behavior through a tiny, readable API."),
                  markdownSlide("## What state this class owns\n`TodoList` needs one simple responsibility: keep an ordered in-memory collection of todo items. That means the constructor should establish the internal list, and later methods should read from or append to that list without hiding where the data lives."),
                  markdownSlide("## Why insertion order matters\nA todo list feels correct only if it gives items back in the same order the user added them. That is why the first implementation step focuses on class state and predictable list behavior instead of adding extra abstractions.")
                ],
                anchor: {
                  file: "todo.py",
                  marker: "TASK:todo-class",
                  startLine: null,
                  endLine: null
                },
                tests: ["tests/test_todo.py"],
                concepts: ["python.classes"],
                constraints: ["Keep the implementation small and local."],
                checks: [],
                estimatedMinutes: 10,
                difficulty: "intro"
              }
            ],
            dependencyGraph: {
              nodes: [
                {
                  id: "component.todo-class",
                  label: "Todo class",
                  kind: "component"
                }
              ],
              edges: []
            },
            tags: ["python", "todo", "small"]
          });
        }

        if (schemaName === "construct_authored_blueprint_step") {
          return schema.parse({
            summary: "Create the TodoList class.",
            doc: "Edit `todo.py` at the `TASK:todo-class` anchor. Define the `TodoList` class in that single module, give it in-memory state for todo items, and implement the constructor and the add/list behavior the hidden test exercises. The hidden test checks that a new instance starts empty and that added items come back in insertion order.",
            lessonSlides: [
              markdownSlide("## Why the class itself is the project\n\nThe user asked for a small Python todo class, so the first lesson should teach the class, not setup work around it. A class gives us a place to store todo items and define the tiny API the rest of the project can call.\n\n## The design goal\n\nWe want one obvious object that owns the list of tasks and exposes a small set of behaviors for adding and reading them back."),
              markdownSlide("## What state this class owns\n\nA class is useful when it keeps related data and behavior together.\n\n- the constructor creates the initial empty list\n- one method appends a new todo item\n- one method returns the stored items in order\n\n## How this helps in the exercise\n\nThis is intentionally small, but it teaches a core design habit: put the data next to the behavior that manages it."),
              markdownSlide("## Why insertion order matters\n\nA todo list should feel predictable. If you add `buy milk` and then `ship package`, you expect to see them returned in that same sequence.\n\n## Common mistakes\n\nThat makes insertion order part of the class contract, not just an implementation detail. The hidden test checks this because the user experience depends on it.")
            ],
            checks: []
          });
        }

        throw new Error(`Unexpected schema request: ${schemaName}`);
      }
    }
  });

  try {
    const questionJob = service.createPlanningQuestionsJob({
      goal: "small python todo class",
      learningStyle: "build-first"
    });
    const questionResult = await waitForJobCompletion(service, questionJob.jobId);
    const questionSession = questionResult.result as {
      session: { sessionId: string; questions: Array<{ id: string }> };
    };

    const planJob = service.createPlanningPlanJob({
      sessionId: questionSession.session.sessionId,
      answers: questionSession.session.questions.map((question, index) =>
        index === 0
          ? {
              questionId: question.id,
              answerType: "custom" as const,
              customResponse: "I have built one tiny CLI before, but packaging and persistence are still fuzzy."
            }
          : {
              questionId: question.id,
              answerType: "option" as const,
              optionId: "fast"
            }
      )
    });
    const planResult = await waitForJobCompletion(service, planJob.jobId);
    const planPayload = planResult.result as {
      plan: { steps: Array<{ id: string }> };
    };

    assert.equal(searchCalls, 0);
    assert.equal(planPayload.plan.steps.length, 1);
    assert.ok(
      loggedStages.some((stage) =>
        stage.includes("research-project-shape:Research skipped for small local scope")
      )
    );
    assert.ok(
      loggedStages.some((stage) =>
        stage.includes("research-architecture:Research skipped for small local scope")
      )
    );

    const knowledgeBaseRaw = await readFile(
      path.join(root, ".construct", "state", "user-knowledge.json"),
      "utf8"
    );
    const knowledgeBase = JSON.parse(knowledgeBaseRaw) as {
      concepts: StoredKnowledgeConcept[];
    };
    const classesConcept = findKnowledgeConcept(knowledgeBase.concepts, "python.classes");

    assert.ok(classesConcept);
    assert.equal(classesConcept?.source, "self-report");
    assert.match(classesConcept?.rationale ?? "", /built one tiny CLI before/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ConstructAgentService generates lesson-first blueprints without a repair loop", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-blueprint-repair-"));
  let blueprintCalls = 0;
  let lessonAuthoringCalls = 0;

  const service = new ConstructAgentService(root, {
    now: () => new Date("2026-03-15T00:00:00.000Z"),
    search: {
      async research(query) {
        return {
          query,
          answer: "Use the smallest real code behavior first.",
          sources: []
        };
      }
    },
    projectInstaller: {
      async install() {
        return {
          status: "skipped",
          packageManager: "none",
          detail: "No supported dependency manifest was generated."
        };
      }
    },
    llm: {
      async parse({ schemaName, schema }) {
        if (schemaName === "construct_goal_self_report_signals") {
          return schema.parse({
            signals: []
          });
        }

        if (schemaName === "construct_goal_scope") {
          return schema.parse({
            scopeSummary: "Small local utility class",
            artifactShape: "single python class",
            complexityScore: 10,
            shouldResearch: false,
            recommendedQuestionCount: 2,
            recommendedMinSteps: 1,
            recommendedMaxSteps: 3,
            rationale: "This is a very small local class request."
          });
        }

        if (schemaName === "construct_planning_question_draft") {
          return schema.parse({
            detectedLanguage: "python",
            detectedDomain: "system info utility class",
            questions: [
              {
                conceptId: "python.classes",
                category: "language",
                prompt: "How comfortable are you with Python classes?",
                options: [
                  {
                    id: "comfortable",
                    label: "I can write simple classes",
                    description: "I understand constructors, methods, and instance state.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "shaky",
                    label: "I know the basics but need examples",
                    description: "I can follow class code, but I still want guidance writing it.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "Classes are new to me",
                    description: "I need the class structure taught first.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "python.stdlib.platform",
                category: "domain",
                prompt: "How comfortable are you with Python standard-library system introspection?",
                options: [
                  {
                    id: "comfortable",
                    label: "I know platform and os basics",
                    description: "I can read from the standard library to inspect the machine.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "shaky",
                    label: "I have seen it but need reminders",
                    description: "I know the modules exist, but I want help using them well.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "This is new to me",
                    description: "I need the Architect to teach the standard-library calls first.",
                    confidenceSignal: "new"
                  }
                ]
              }
            ]
          });
        }

        if (schemaName === "construct_generated_project_plan") {
          return schema.parse({
            summary: "Teach the first real SystemInfo behavior and then implement it in the class itself.",
            knowledgeGraph: {
              concepts: [
                {
                  id: "python.classes",
                  label: "Python classes",
                  category: "language",
                  path: ["python", "classes"],
                  labelPath: ["Python", "Classes"],
                  confidence: "shaky",
                  rationale: "The learner wants guidance, so the first step should teach the class shape before coding."
                }
              ],
              strengths: [],
              gaps: ["Python class design", "Using platform/os safely"]
            },
            architecture: [
              {
                id: "component.system-info",
                label: "SystemInfo",
                kind: "component",
                summary: "Expose read-only machine information from the Python standard library.",
                dependsOn: []
              }
            ],
            steps: [
              {
                id: "step.systeminfo-core",
                title: "Implement the first SystemInfo property",
                kind: "implementation",
                objective: "Teach the class shape and implement the first real property that reads macOS details.",
                rationale: "The first step should touch the actual artifact, not project setup.",
                concepts: ["python.classes", "python.stdlib.platform"],
                dependsOn: [],
                validationFocus: ["SystemInfo exists", "os_name property returns a string"],
                suggestedFiles: ["systeminfo.py"],
                implementationNotes: ["Keep the first step focused on one real property and the class structure around it."],
                quizFocus: ["Can explain why @property gives a read-only API."],
                hiddenValidationFocus: ["Validates constructor shape and first property behavior."]
              }
            ],
            suggestedFirstStepId: "step.systeminfo-core"
          });
        }

        if (schemaName === "construct_generated_blueprint_bundle") {
          blueprintCalls += 1;
          return schema.parse({
            projectName: "macos-systeminfo",
            projectSlug: "macos-systeminfo",
            description: "A tiny Python class for macOS system details.",
            language: "python",
            entrypoints: ["systeminfo.py"],
            supportFiles: [
              {
                path: "README.md",
                content: "# macos-systeminfo\n"
              }
            ],
            canonicalFiles: [
              {
                path: "systeminfo.py",
                content: "import platform\n\nclass SystemInfo:\n    @property\n    def os_name(self):\n        return platform.system()\n"
              }
            ],
            learnerFiles: [
              {
                path: "systeminfo.py",
                content: "import platform\n\nclass SystemInfo:\n    @property\n    def os_name(self):\n        # TASK:systeminfo-os-name\n        raise NotImplementedError('Implement os_name')\n"
              }
            ],
            hiddenTests: [
              {
                path: "tests/test_systeminfo.py",
                content: "from systeminfo import SystemInfo\n\ndef test_os_name_returns_a_string():\n    assert isinstance(SystemInfo().os_name, str)\n"
              }
            ],
            steps: [
              {
                id: "step.systeminfo-core",
                title: "Implement the first SystemInfo property",
                summary: "Teach the class shape, then implement the first real read-only property.",
                doc: "Edit systeminfo.py to complete the os_name property on SystemInfo.",
                lessonSlides: [
                  markdownSlide("A small first property on the class."),
                  markdownSlide("Use platform.system().")
                ],
                anchor: {
                  file: "systeminfo.py",
                  marker: "TASK:systeminfo-os-name",
                  startLine: null,
                  endLine: null
                },
                tests: ["tests/test_systeminfo.py"],
                concepts: ["python.classes", "python.stdlib.platform"],
                constraints: ["Use only the Python standard library.", "Keep the API read-only."],
                checks: [
                  {
                    id: "check.systeminfo.1",
                    type: "mcq",
                    prompt: "Why is `@property` a good fit?",
                    options: [
                      {
                        id: "a",
                        label: "It exposes a read-only value as an attribute-like API.",
                        rationale: null
                      },
                      {
                        id: "b",
                        label: "It makes the method run only once per class.",
                        rationale: null
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
                { id: "component.system-info", label: "SystemInfo", kind: "component" }
              ],
              edges: []
            },
            tags: ["python", "macos"]
          });
        }

        if (schemaName === "construct_authored_blueprint_step") {
          lessonAuthoringCalls += 1;
          return schema.parse({
            summary: "Teach the class shape, then implement the first real read-only property.",
            doc: "Edit `systeminfo.py` at the `TASK:systeminfo-os-name` anchor. Complete the `os_name` property on `SystemInfo` so it returns the operating-system name as a string using the Python standard library. The hidden test checks that the property can be read as `SystemInfo().os_name` and that it returns a string without exposing a write-oriented API.",
            lessonSlides: [
              markdownSlide("## Why the first step is a real property, not setup\n\nThe request is for a small Python class, so the lesson should begin where the class becomes useful: the first real piece of information it can report. `SystemInfo` starts to feel like a genuine artifact the moment it can answer one machine question behind a clean interface.\n\n## Why this matters\n\nThat is why we do **not** spend this first step on packaging, environment setup, or CLI wrappers. The learner should touch the real project behavior immediately."),
              markdownSlide("## What `@property` teaches in this design\n\nA property lets a class expose computed information through an attribute-like interface.\n\n- callers can read `SystemInfo().os_name` like data\n- the class still performs the lookup internally\n- the public API stays read-only and simple\n\n## Common mistakes\n\nThat is a good fit for system information because the class is presenting facts about the machine, not asking the caller to perform an action."),
              markdownSlide("## How the standard library supports the implementation\n\nPython's `platform` module already knows how to report the operating-system name. The job of this step is not to invent a new lookup mechanism. It is to wrap the standard-library call inside the class so later code can depend on a stable interface.\n\n## Example\n\n```python\nimport platform\n\nplatform.system()\n```\n\nThe exercise is teaching an important design habit: use the standard library to get the fact, then place that fact behind the small API your project wants to expose.")
            ],
            checks: [
              {
                id: "check.systeminfo.1",
                type: "mcq",
                prompt: "Why is `@property` a good fit for `os_name` in this design?",
                options: [
                  {
                    id: "a",
                    label: "It exposes computed machine data through a read-only attribute-like API.",
                    rationale: null
                  },
                  {
                    id: "b",
                    label: "It guarantees the lookup runs only once for the entire class.",
                    rationale: null
                  }
                ],
                answer: "a"
              }
            ]
          });
        }

        throw new Error(`Unexpected schema request: ${schemaName}`);
      }
    }
  });

  try {
    const questionJob = service.createPlanningQuestionsJob({
      goal: "small python class that reports macOS system details",
      learningStyle: "concept-first"
    });
    const questionResult = await waitForJobCompletion(service, questionJob.jobId);
    const questionSession = questionResult.result as {
      session: { sessionId: string; questions: Array<{ id: string; options: Array<{ id: string }> }> };
    };

    const planJob = service.createPlanningPlanJob({
      sessionId: questionSession.session.sessionId,
      answers: questionSession.session.questions.map((question) => ({
        questionId: question.id,
        answerType: "option" as const,
        optionId: question.options[1]?.id ?? question.options[0]!.id
      }))
    });

    await waitForJobCompletion(service, planJob.jobId);

    assert.equal(blueprintCalls, 1);
    assert.equal(lessonAuthoringCalls, 1);

    const generatedProjectDirectories = await readdir(
      path.join(root, ".construct", "generated-blueprints")
    );
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
      steps: Array<{
        title: string;
        lessonSlides: Array<{
          blocks: Array<
            | { type: "markdown"; markdown: string }
            | { type: "check"; check: { id: string } }
          >;
        }>;
        doc: string;
      }>;
    };

    assert.match(generatedBlueprint.steps[0]!.title, /SystemInfo property/i);
    assert.ok(generatedBlueprint.steps[0]!.lessonSlides.length >= 3);
    const firstSlideMarkdown =
      generatedBlueprint.steps[0]!.lessonSlides[0]!.blocks.find(
        (block) => block.type === "markdown"
      )?.markdown ?? "";
    assert.match(firstSlideMarkdown, /^## /m);
    assert.ok((firstSlideMarkdown.match(/^## /gm) ?? []).length >= 1);
    assert.ok(
      generatedBlueprint.steps[0]!.lessonSlides.some((slide) =>
        slide.blocks.some(
          (block) => block.type === "markdown" && block.markdown.includes("```")
        )
      )
    );
    assert.ok(
      generatedBlueprint.steps[0]!.lessonSlides.some(
        (slide) =>
          slide.blocks.some(
            (block) =>
              block.type === "markdown" &&
              (block.markdown.includes("Why") ||
                block.markdown.includes("Example") ||
                block.markdown.includes("Common mistakes") ||
                block.markdown.includes("How it"))
          )
      )
    );
    assert.doesNotMatch(generatedBlueprint.steps[0]!.title, /bootstrap|environment/i);
    assert.match(generatedBlueprint.steps[0]!.doc, /Edit `?systeminfo\.py`?/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ConstructAgentService resumes blueprint creation from the last saved stage after a late persistence failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-agent-plan-resume-"));
  let planCalls = 0;
  let blueprintCalls = 0;
  let lessonAuthoringCalls = 0;
  let activationFailures = 0;

  const basePersistence = createAgentPersistence({
    rootDirectory: root,
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  const persistence: AgentPersistence = {
    getPlanningState: () => basePersistence.getPlanningState(),
    setPlanningState: (state) => basePersistence.setPlanningState(state),
    getPlanningBuildCheckpoint: (sessionId) =>
      basePersistence.getPlanningBuildCheckpoint(sessionId),
    setPlanningBuildCheckpoint: (sessionId, checkpoint) =>
      basePersistence.setPlanningBuildCheckpoint(sessionId, checkpoint),
    clearPlanningBuildCheckpoint: (sessionId) =>
      basePersistence.clearPlanningBuildCheckpoint(sessionId),
    getKnowledgeBase: () => basePersistence.getKnowledgeBase(),
    setKnowledgeBase: (knowledgeBase) => basePersistence.setKnowledgeBase(knowledgeBase),
    getActiveBlueprintState: () => basePersistence.getActiveBlueprintState(),
    setActiveBlueprintState: (state) => basePersistence.setActiveBlueprintState(state),
    getGeneratedBlueprintRecord: (sessionId) =>
      basePersistence.getGeneratedBlueprintRecord(sessionId),
    async saveGeneratedBlueprintRecord(record) {
      if (activationFailures === 0) {
        activationFailures += 1;
        throw new Error("Simulated activation failure");
      }
    },
    listProjects: () => basePersistence.listProjects(),
    getActiveProject: () => basePersistence.getActiveProject(),
    getProject: (projectId) => basePersistence.getProject(projectId),
    setActiveProject: (projectId) => basePersistence.setActiveProject(projectId),
    updateProjectProgress: (update) => basePersistence.updateProjectProgress(update),
    getBlueprintBuild: (buildId) => basePersistence.getBlueprintBuild(buildId),
    getBlueprintBuildBySession: (sessionId) =>
      basePersistence.getBlueprintBuildBySession(sessionId),
    upsertBlueprintBuild: (build) => basePersistence.upsertBlueprintBuild(build),
    upsertBlueprintBuildStage: (stage) => basePersistence.upsertBlueprintBuildStage(stage),
    appendBlueprintBuildEvent: (event) => basePersistence.appendBlueprintBuildEvent(event),
    getBlueprintBuildDetail: (buildId) => basePersistence.getBlueprintBuildDetail(buildId),
    listBlueprintBuilds: () => basePersistence.listBlueprintBuilds()
  };

  const service = new ConstructAgentService(root, {
    now: () => new Date("2026-03-17T12:00:00.000Z"),
    persistence,
    search: {
      async research(query) {
        return {
          query,
          answer: "Start with the first meaningful project behavior and keep the initial scope small.",
          sources: []
        };
      }
    },
    projectInstaller: {
      async install() {
        return {
          status: "skipped",
          packageManager: "none",
          detail: "No install step needed for the regression."
        };
      }
    },
    llm: {
      async parse({ schemaName, schema }) {
        if (schemaName === "construct_goal_self_report_signals") {
          return schema.parse({ signals: [] });
        }

        if (schemaName === "construct_goal_scope") {
          return schema.parse({
            scopeSummary: "Small single-module project",
            artifactShape: "single file module",
            complexityScore: 15,
            shouldResearch: false,
            recommendedQuestionCount: 2,
            recommendedMinSteps: 1,
            recommendedMaxSteps: 3,
            rationale: "The project is compact enough to avoid broad external research."
          });
        }

        if (schemaName === "construct_planning_question_draft") {
          return schema.parse({
            detectedLanguage: "typescript",
            detectedDomain: "tiny parser utility",
            questions: [
              {
                conceptId: "typescript.functions",
                category: "language",
                prompt: "How comfortable are you with small TypeScript utility functions?",
                options: [
                  {
                    id: "solid",
                    label: "I write them comfortably",
                    description: "I can work with small functions and types without much help.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "I know the basics but still want guidance",
                    description: "I can follow examples, but I still want support while implementing.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "This is still new to me",
                    description: "I need the fundamentals taught clearly before I code.",
                    confidenceSignal: "new"
                  }
                ]
              },
              {
                conceptId: "domain.module-graph",
                category: "domain",
                prompt: "How familiar are you with a simple module graph?",
                options: [
                  {
                    id: "solid",
                    label: "I know the idea well",
                    description: "I understand modules, imports, and dependency edges clearly.",
                    confidenceSignal: "comfortable"
                  },
                  {
                    id: "partial",
                    label: "I know the idea but need examples",
                    description: "I understand the concept, but I still want concrete walkthroughs.",
                    confidenceSignal: "shaky"
                  },
                  {
                    id: "new",
                    label: "This is new to me",
                    description: "I need the project to teach the concept from scratch.",
                    confidenceSignal: "new"
                  }
                ]
              }
            ]
          });
        }

        if (schemaName === "construct_generated_project_plan") {
          planCalls += 1;
          return schema.parse({
            summary: "Teach a tiny module-graph parser and then implement the first real function.",
            knowledgeGraph: {
              concepts: [
                {
                  id: "typescript.functions",
                  label: "TypeScript utility functions",
                  category: "language",
                  path: ["typescript", "functions"],
                  labelPath: ["TypeScript", "Functions"],
                  confidence: "shaky",
                  rationale: "The learner wants guidance on small function design."
                }
              ],
              strengths: [],
              gaps: ["Module graph basics"]
            },
            architecture: [
              {
                id: "component.parser",
                label: "Import parser",
                kind: "component",
                summary: "Parses import edges from a tiny TypeScript file.",
                dependsOn: []
              }
            ],
            steps: [
              {
                id: "step.parse-imports",
                title: "Parse imports from one file",
                kind: "implementation",
                objective: "Teach the import-extraction concept and implement the first parser function.",
                rationale: "The first step should produce the first real dependency edge.",
                concepts: ["typescript.functions", "domain.module-graph"],
                dependsOn: [],
                validationFocus: ["returns an import edge for one import"],
                suggestedFiles: ["src/parser.ts"],
                implementationNotes: ["Keep the regex narrow and educational."],
                quizFocus: ["Can explain what an import edge represents."],
                hiddenValidationFocus: ["single import path is captured"]
              }
            ],
            suggestedFirstStepId: "step.parse-imports"
          });
        }

        if (schemaName === "construct_generated_blueprint_bundle") {
          blueprintCalls += 1;
          return schema.parse({
            projectName: "tiny-module-graph",
            projectSlug: "tiny-module-graph",
            description: "A tiny TypeScript project that extracts import edges from one file.",
            language: "typescript",
            entrypoints: ["src/parser.ts"],
            supportFiles: [
              {
                path: "package.json",
                content: "{\n  \"name\": \"tiny-module-graph\"\n}\n"
              }
            ],
            canonicalFiles: [
              {
                path: "src/parser.ts",
                content: "export function parseImports(source: string): string[] {\n  return Array.from(source.matchAll(/from\\s+['\\\"]([^'\\\"]+)['\\\"]/g)).map((match) => match[1] ?? \"\");\n}\n"
              }
            ],
            learnerFiles: [
              {
                path: "src/parser.ts",
                content: "export function parseImports(source: string): string[] {\n  // TASK:parse-imports\n  throw new Error(\"Implement parseImports\");\n}\n"
              }
            ],
            hiddenTests: [
              {
                path: "tests/parser.test.ts",
                content: "import { parseImports } from '../src/parser';\n\ntest('captures a single import path', () => {\n  expect(parseImports(\"import { x } from './dep';\")).toEqual(['./dep']);\n});\n"
              }
            ],
            steps: [
              {
                id: "step.parse-imports",
                title: "Parse imports from one file",
                summary: "Teach the first import edge and implement the parser function.",
                doc: "Edit `src/parser.ts` and implement `parseImports`.",
                lessonSlides: [
                  markdownSlide("## Start with one edge\n\nWe only need one file and one import edge for the first pass."),
                  markdownSlide("## Keep the parser tiny\n\nA narrow regex is fine for this educational step.")
                ],
                anchor: {
                  file: "src/parser.ts",
                  marker: "TASK:parse-imports",
                  startLine: null,
                  endLine: null
                },
                tests: ["tests/parser.test.ts"],
                concepts: ["typescript.functions", "domain.module-graph"],
                constraints: ["Keep the implementation intentionally small."],
                checks: [
                  {
                    id: "check.import-edge",
                    type: "mcq",
                    prompt: "What does the first parser return?",
                    options: [
                      { id: "a", label: "A list of import paths", rationale: null },
                      { id: "b", label: "A full AST", rationale: null }
                    ],
                    answer: "a"
                  }
                ],
                estimatedMinutes: 15,
                difficulty: "intro"
              }
            ],
            dependencyGraph: {
              nodes: [
                { id: "component.parser", label: "Import parser", kind: "component" }
              ],
              edges: []
            },
            tags: ["typescript", "parser"]
          });
        }

        if (schemaName === "construct_authored_blueprint_step") {
          lessonAuthoringCalls += 1;
          return schema.parse({
            summary: "Teach one import edge and then implement the parser function.",
            doc: "Edit `src/parser.ts` at the `TASK:parse-imports` anchor. Implement `parseImports(source)` so it returns the relative import paths it finds in the source text. The hidden test checks a single import first, so the goal is one correct edge, not a production parser.",
            lessonSlides: [
              markdownSlide("## What this function is really doing\n\nA module graph starts when one file points to another. In this first step, the parser only needs to discover that edge."),
              markdownSlide("## Why a tiny regex is acceptable here\n\nWe are teaching the shape of the problem first, not building a production TypeScript parser."),
              markdownSlide("## How the exercise connects\n\nOnce you can return one import path from one source string, the next steps can scale that idea into a graph.")
            ],
            checks: [
              {
                id: "check.import-edge",
                type: "mcq",
                prompt: "What should the first parser return?",
                options: [
                  { id: "a", label: "A list of import paths", rationale: null },
                  { id: "b", label: "A full syntax tree", rationale: null }
                ],
                answer: "a"
              }
            ]
          });
        }

        throw new Error(`Unexpected schema request: ${schemaName}`);
      }
    }
  });

  try {
    const questionJob = service.createPlanningQuestionsJob({
      goal: "small typescript parser utility",
      learningStyle: "concept-first"
    });
    const questionResult = await waitForJobCompletion(service, questionJob.jobId);
    const questionSession = questionResult.result as {
      session: { sessionId: string; questions: Array<{ id: string; options: Array<{ id: string }> }> };
    };

    const request = {
      sessionId: questionSession.session.sessionId,
      answers: questionSession.session.questions.map((question) => ({
        questionId: question.id,
        answerType: "option" as const,
        optionId: question.options[1]?.id ?? question.options[0]!.id
      }))
    };

    const firstPlanJob = service.createPlanningPlanJob(request);
    await assert.rejects(
      () => waitForJobCompletion(service, firstPlanJob.jobId),
      /Simulated activation failure/
    );

    const savedCheckpoint = await basePersistence.getPlanningBuildCheckpoint(
      questionSession.session.sessionId
    );

    assert.ok(savedCheckpoint);
    assert.equal(planCalls, 1);
    assert.equal(blueprintCalls, 1);
    assert.equal(lessonAuthoringCalls, 1);

    const retryPlanJob = service.createPlanningPlanJob(request);
    const retryResult = await waitForJobCompletion(service, retryPlanJob.jobId);
    const planPayload = retryResult.result as { plan: { steps: Array<{ id: string }> } };

    assert.equal(planPayload.plan.steps.length, 1);
    assert.equal(planCalls, 1);
    assert.equal(blueprintCalls, 1);
    assert.equal(lessonAuthoringCalls, 1);
    assert.equal(
      await basePersistence.getPlanningBuildCheckpoint(questionSession.session.sessionId),
      null
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForJobCompletion(
  service: ConstructAgentService,
  jobId: string
) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const snapshot = service.getJob(jobId);

    if (snapshot.status === "completed") {
      return snapshot;
    }

    if (snapshot.status === "failed") {
      throw new Error(snapshot.error ?? `Agent job ${jobId} failed.`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(`Timed out waiting for agent job ${jobId}.`);
}
