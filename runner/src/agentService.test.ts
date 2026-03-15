import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConstructAgentService } from "./agentService";

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
        if (schemaName === "construct_goal_scope") {
          return schema.parse({
            scopeSummary: "Large compiler project",
            artifactShape: "compiler pipeline",
            complexityScore: 90,
            shouldResearch: true,
            recommendedQuestionCount: 4,
            recommendedMinSteps: 4,
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
                doc: "Start the project by defining the first real lexer behavior.",
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
                doc: "Implement the class in a single module.",
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
