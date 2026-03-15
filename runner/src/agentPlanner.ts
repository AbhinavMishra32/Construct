import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CurrentPlanningSessionResponseSchema,
  GeneratedProjectPlanSchema,
  PlanningSessionCompleteRequestSchema,
  PlanningSessionCompleteResponseSchema,
  PlanningSessionSchema,
  PlanningSessionStartRequestSchema,
  PlanningSessionStartResponseSchema,
  type ArchitectureComponent,
  type ConceptConfidence,
  type ConceptNode,
  type GeneratedPlanStep,
  type GeneratedProjectPlan,
  type LearningStyle,
  type PlanningAnswer,
  type PlanningQuestion,
  type PlanningSession,
  type PlanningSessionCompleteRequest,
  type PlanningSessionCompleteResponse,
  type PlanningSessionStartRequest,
  type PlanningSessionStartResponse
} from "@construct/shared";

type GoalAnalysis = {
  normalizedGoal: string;
  language: string;
  domain: string;
};

type PlannerState = {
  session: PlanningSession | null;
  plan: GeneratedProjectPlan | null;
};

type ComponentTemplate = {
  id: string;
  label: string;
  summary: string;
  dependsOn: string[];
  concepts: string[];
  suggestedFiles: string[];
  validationFocus: string[];
};

const CONFIDENCE_OPTIONS = [
  {
    id: "comfortable",
    label: "Comfortable",
    description: "I can use this without much support.",
    confidenceSignal: "comfortable" as const
  },
  {
    id: "shaky",
    label: "Shaky",
    description: "I know the shape of it, but I still need help.",
    confidenceSignal: "shaky" as const
  },
  {
    id: "new",
    label: "New",
    description: "I would need this taught from first principles.",
    confidenceSignal: "new" as const
  }
] as const;

const COMPONENT_TEMPLATES: Record<string, ComponentTemplate[]> = {
  compiler: [
    {
      id: "component.token-model",
      label: "Token model",
      summary: "Define the token representation and the minimal public lexer contract.",
      dependsOn: [],
      concepts: ["lang.types", "domain.tokens"],
      suggestedFiles: ["src/token.ts", "src/lexer.ts"],
      validationFocus: ["Token enum/struct exists", "Token metadata is strongly typed"]
    },
    {
      id: "component.lexer",
      label: "Lexer",
      summary: "Scan source text into a deterministic token stream.",
      dependsOn: ["component.token-model"],
      concepts: ["domain.tokens", "domain.lexer-rules"],
      suggestedFiles: ["src/lexer.ts"],
      validationFocus: ["Lexer emits token stream", "Whitespace and punctuation rules hold"]
    },
    {
      id: "component.ast",
      label: "AST",
      summary: "Define the syntax tree nodes the parser will construct.",
      dependsOn: ["component.token-model"],
      concepts: ["lang.types", "domain.ast"],
      suggestedFiles: ["src/ast.ts"],
      validationFocus: ["AST node types exist", "Core variants carry typed payloads"]
    },
    {
      id: "component.parser",
      label: "Parser",
      summary: "Consume tokens recursively into an AST with clear entry points.",
      dependsOn: ["component.lexer", "component.ast"],
      concepts: ["domain.parser-design", "domain.recursion"],
      suggestedFiles: ["src/parser.ts"],
      validationFocus: ["Parser builds AST nodes", "Recursive descent handles precedence"]
    },
    {
      id: "component.semantic",
      label: "Semantic pass",
      summary: "Validate names, types, or invariants over the parsed tree.",
      dependsOn: ["component.parser"],
      concepts: ["domain.semantic-analysis"],
      suggestedFiles: ["src/semantic.ts"],
      validationFocus: ["Semantic errors surface", "Resolved symbols/types are tracked"]
    },
    {
      id: "component.codegen",
      label: "Code generation",
      summary: "Transform validated structures into the first executable or lower-level form.",
      dependsOn: ["component.semantic"],
      concepts: ["domain.codegen"],
      suggestedFiles: ["src/codegen.ts"],
      validationFocus: ["Generated output matches a minimal fixture", "Lowering is deterministic"]
    }
  ],
  workflow: [
    {
      id: "component.state",
      label: "Workflow state",
      summary: "Define the immutable state model the runtime will carry between nodes.",
      dependsOn: [],
      concepts: ["lang.types", "domain.state-modeling"],
      suggestedFiles: ["src/state.ts", "src/types.ts"],
      validationFocus: ["State shape exists", "Updates preserve type safety"]
    },
    {
      id: "component.nodes",
      label: "Workflow nodes",
      summary: "Create the executable node contract and node implementations.",
      dependsOn: ["component.state"],
      concepts: ["lang.interfaces", "domain.async-flow"],
      suggestedFiles: ["src/node.ts"],
      validationFocus: ["Node interface exists", "Node execution returns typed state"]
    },
    {
      id: "component.graph",
      label: "Workflow graph",
      summary: "Model the edges and traversal contract between runtime nodes.",
      dependsOn: ["component.nodes"],
      concepts: ["domain.graph-traversal"],
      suggestedFiles: ["src/graph.ts", "src/edge.ts"],
      validationFocus: ["Traversal order is deterministic", "Conditional edge resolution works"]
    },
    {
      id: "component.runner",
      label: "Workflow runner",
      summary: "Execute the graph loop safely from start to termination.",
      dependsOn: ["component.graph"],
      concepts: ["domain.async-flow", "domain.runtime-orchestration"],
      suggestedFiles: ["src/runner.ts"],
      validationFocus: ["Runner visits nodes in order", "Execution halts correctly"]
    }
  ],
  generic: [
    {
      id: "component.core-types",
      label: "Core types",
      summary: "Define the central data structures and public interfaces for the project.",
      dependsOn: [],
      concepts: ["lang.types"],
      suggestedFiles: ["src/types.ts"],
      validationFocus: ["Core interfaces exist", "Shared types compile cleanly"]
    },
    {
      id: "component.core-module",
      label: "Core module",
      summary: "Implement the first functional module that all later work depends on.",
      dependsOn: ["component.core-types"],
      concepts: ["workflow.decomposition"],
      suggestedFiles: ["src/core.ts"],
      validationFocus: ["Primary contract works", "Downstream modules can depend on it"]
    },
    {
      id: "component.integration",
      label: "Integration layer",
      summary: "Wire the core module into a runnable end-to-end slice.",
      dependsOn: ["component.core-module"],
      concepts: ["workflow.integration"],
      suggestedFiles: ["src/index.ts"],
      validationFocus: ["End-to-end flow runs", "Interfaces remain stable"]
    }
  ]
};

const CONCEPT_LIBRARY: Record<
  string,
  { label: string; category: "language" | "domain" | "workflow" }
> = {
  "rust.structs": { label: "Rust structs", category: "language" },
  "rust.enums": { label: "Rust enums", category: "language" },
  "rust.ownership": { label: "Rust ownership", category: "language" },
  "rust.pattern-matching": { label: "Rust pattern matching", category: "language" },
  "ts.interfaces": { label: "TypeScript interfaces", category: "language" },
  "ts.unions": { label: "TypeScript unions", category: "language" },
  "ts.generics": { label: "TypeScript generics", category: "language" },
  "ts.async": { label: "TypeScript async flow", category: "language" },
  "lang.types": { label: "Core type modeling", category: "language" },
  "lang.interfaces": { label: "Interface design", category: "language" },
  "domain.tokens": { label: "Token modeling", category: "domain" },
  "domain.lexer-rules": { label: "Tokenization rules", category: "domain" },
  "domain.ast": { label: "AST design", category: "domain" },
  "domain.parser-design": { label: "Parser design", category: "domain" },
  "domain.recursion": { label: "Recursive descent", category: "domain" },
  "domain.semantic-analysis": { label: "Semantic analysis", category: "domain" },
  "domain.codegen": { label: "Code generation", category: "domain" },
  "domain.state-modeling": { label: "State modeling", category: "domain" },
  "domain.async-flow": { label: "Async flow", category: "domain" },
  "domain.graph-traversal": { label: "Graph traversal", category: "domain" },
  "domain.runtime-orchestration": { label: "Runtime orchestration", category: "domain" },
  "workflow.decomposition": { label: "System decomposition", category: "workflow" },
  "workflow.integration": { label: "Integration workflow", category: "workflow" }
};

export class AgentPlannerService {
  private readonly statePath: string;
  private readonly now: () => Date;

  constructor(
    rootDirectory: string,
    options?: {
      statePath?: string;
      now?: () => Date;
    }
  ) {
    this.statePath =
      options?.statePath ??
      path.join(path.resolve(rootDirectory), ".construct", "state", "agent-planner.json");
    this.now = options?.now ?? (() => new Date());
  }

  async startPlanningSession(
    input: PlanningSessionStartRequest
  ): Promise<PlanningSessionStartResponse> {
    const request = PlanningSessionStartRequestSchema.parse(input);
    const analysis = analyzeGoal(request.goal);
    const session = PlanningSessionSchema.parse({
      sessionId: randomUUID(),
      goal: request.goal.trim(),
      normalizedGoal: analysis.normalizedGoal,
      learningStyle: request.learningStyle,
      detectedLanguage: analysis.language,
      detectedDomain: analysis.domain,
      createdAt: this.now().toISOString(),
      questions: buildQuestions(analysis)
    });

    await this.writeState({
      session,
      plan: null
    });

    return PlanningSessionStartResponseSchema.parse({
      session
    });
  }

  async completePlanningSession(
    input: PlanningSessionCompleteRequest
  ): Promise<PlanningSessionCompleteResponse> {
    const request = PlanningSessionCompleteRequestSchema.parse(input);
    const state = await this.readState();

    if (!state.session || state.session.sessionId !== request.sessionId) {
      throw new Error(`Unknown planning session ${request.sessionId}.`);
    }

    const answerMap = new Map(request.answers.map((answer) => [answer.questionId, answer]));

    for (const question of state.session.questions) {
      if (!answerMap.has(question.id)) {
        throw new Error(`Missing answer for ${question.id}.`);
      }
    }

    const plan = generateProjectPlan(state.session, request.answers);
    await this.writeState({
      session: state.session,
      plan
    });

    return PlanningSessionCompleteResponseSchema.parse({
      session: state.session,
      plan
    });
  }

  async getCurrentPlanningState(): Promise<{
    session: PlanningSession | null;
    plan: GeneratedProjectPlan | null;
  }> {
    const state = await this.readState();
    return CurrentPlanningSessionResponseSchema.parse(state);
  }

  private async readState(): Promise<PlannerState> {
    if (!existsSync(this.statePath)) {
      return {
        session: null,
        plan: null
      };
    }

    const rawState = await readFile(this.statePath, "utf8");
    return CurrentPlanningSessionResponseSchema.parse(JSON.parse(rawState));
  }

  private async writeState(state: PlannerState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

function analyzeGoal(goal: string): GoalAnalysis {
  const normalizedGoal = goal.trim().replace(/\s+/g, " ");
  const lowerGoal = normalizedGoal.toLowerCase();
  const language = lowerGoal.includes("rust")
    ? "rust"
    : lowerGoal.includes("typescript") || /\bts\b/.test(lowerGoal)
      ? "typescript"
      : lowerGoal.includes("python")
        ? "python"
        : "unknown";
  const domain = lowerGoal.includes("compiler")
    ? "compiler"
    : lowerGoal.includes("workflow") || lowerGoal.includes("graph")
      ? "workflow"
      : "generic";

  return {
    normalizedGoal,
    language,
    domain
  };
}

function buildQuestions(analysis: GoalAnalysis): PlanningQuestion[] {
  const languageQuestions =
    analysis.language === "rust"
      ? [
          makeQuestion("rust.structs", "How comfortable are you with Rust structs?"),
          makeQuestion("rust.enums", "How comfortable are you with Rust enums?"),
          makeQuestion(
            "rust.ownership",
            "How comfortable are you with Rust ownership and borrowing?"
          ),
          makeQuestion(
            "rust.pattern-matching",
            "How comfortable are you with Rust pattern matching?"
          )
        ]
      : analysis.language === "typescript"
        ? [
            makeQuestion("ts.interfaces", "How comfortable are you with TypeScript interfaces?"),
            makeQuestion("ts.unions", "How comfortable are you with TypeScript unions?"),
            makeQuestion("ts.generics", "How comfortable are you with TypeScript generics?"),
            makeQuestion("ts.async", "How comfortable are you with async/await in TypeScript?")
          ]
        : [makeQuestion("lang.types", "How comfortable are you with designing core types?")];

  const domainQuestions =
    analysis.domain === "compiler"
      ? [
          makeQuestion("domain.tokens", "How comfortable are you with token design?"),
          makeQuestion("domain.lexer-rules", "How comfortable are you with lexer rules?"),
          makeQuestion("domain.parser-design", "How comfortable are you with parser design?"),
          makeQuestion("domain.recursion", "How comfortable are you with recursion in parsers?")
        ]
      : analysis.domain === "workflow"
        ? [
            makeQuestion("domain.state-modeling", "How comfortable are you with immutable state models?"),
            makeQuestion("domain.graph-traversal", "How comfortable are you with graph traversal?"),
            makeQuestion("domain.async-flow", "How comfortable are you with async execution flows?"),
            makeQuestion(
              "domain.runtime-orchestration",
              "How comfortable are you with runtime orchestration?"
            )
          ]
        : [
            makeQuestion("workflow.decomposition", "How comfortable are you with decomposing a system into modules?"),
            makeQuestion("workflow.integration", "How comfortable are you with integration sequencing?")
          ];

  return [...languageQuestions, ...domainQuestions];
}

function generateProjectPlan(
  session: PlanningSession,
  answers: PlanningAnswer[]
): GeneratedProjectPlan {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
  const knowledgeGraph = buildKnowledgeGraph(session.questions, answerMap);
  const componentTemplates = COMPONENT_TEMPLATES[session.detectedDomain] ?? COMPONENT_TEMPLATES.generic;
  const architecture = buildArchitecture(componentTemplates, knowledgeGraph);
  const steps = buildSteps(componentTemplates, knowledgeGraph, session.learningStyle);

  return GeneratedProjectPlanSchema.parse({
    sessionId: session.sessionId,
    goal: session.goal,
    language: session.detectedLanguage,
    domain: session.detectedDomain,
    learningStyle: session.learningStyle,
    summary: summarizePlan(session, knowledgeGraph, steps),
    architecture,
    knowledgeGraph,
    steps,
    suggestedFirstStepId: steps[0].id
  });
}

function buildKnowledgeGraph(
  questions: PlanningQuestion[],
  answerMap: Map<string, PlanningAnswer>
): { concepts: ConceptNode[]; strengths: string[]; gaps: string[] } {
  const concepts = questions.map((question) => {
    const conceptMeta = CONCEPT_LIBRARY[question.conceptId] ?? {
      label: question.conceptId,
      category: question.category
    };
    const answer = answerMap.get(question.id);
    const confidence = inferPlanningAnswerConfidence(question, answer);

    return {
      id: question.conceptId,
      label: conceptMeta.label,
      category: conceptMeta.category,
      confidence,
      rationale:
        confidence === "comfortable"
          ? `The learner reported confidence in ${conceptMeta.label}.`
          : confidence === "shaky"
            ? `The learner has partial familiarity with ${conceptMeta.label}.`
            : `The learner needs explicit support for ${conceptMeta.label}.`
    };
  });

  return {
    concepts,
    strengths: concepts
      .filter((concept) => concept.confidence === "comfortable")
      .map((concept) => concept.label),
    gaps: concepts
      .filter((concept) => concept.confidence !== "comfortable")
      .map((concept) => concept.label)
  };
}

function inferPlanningAnswerConfidence(
  question: PlanningQuestion,
  answer: PlanningAnswer | undefined
): ConceptConfidence {
  if (!answer) {
    return "new";
  }

  if (answer.answerType === "option") {
    return question.options.find((option) => option.id === answer.optionId)?.confidenceSignal ?? "new";
  }

  const normalized = answer.customResponse.toLowerCase();

  if (
    normalized.includes("comfortable") ||
    normalized.includes("confident") ||
    normalized.includes("daily") ||
    normalized.includes("strong")
  ) {
    return "comfortable";
  }

  if (
    normalized.includes("new") ||
    normalized.includes("never") ||
    normalized.includes("beginner") ||
    normalized.includes("from scratch")
  ) {
    return "new";
  }

  return "shaky";
}

function buildArchitecture(
  templates: ComponentTemplate[],
  knowledgeGraph: { concepts: ConceptNode[] }
): ArchitectureComponent[] {
  const gapConceptIds = new Set(
    knowledgeGraph.concepts
      .filter((concept) => concept.confidence !== "comfortable")
      .map((concept) => concept.id)
  );
  const skillNodes = Array.from(
    new Set(
      templates.flatMap((template) => template.concepts).filter((conceptId) => gapConceptIds.has(conceptId))
    )
  ).map((conceptId) => {
    const conceptMeta = CONCEPT_LIBRARY[conceptId];

    return {
      id: `skill.${conceptId}`,
      label: conceptMeta?.label ?? conceptId,
      kind: "skill" as const,
      summary: `Prerequisite concept support for ${conceptMeta?.label ?? conceptId}.`,
      dependsOn: []
    };
  });
  const componentNodes = templates.map((template) => ({
    id: template.id,
    label: template.label,
    kind: "component" as const,
    summary: template.summary,
    dependsOn: template.dependsOn
  }));

  return [...skillNodes, ...componentNodes];
}

function buildSteps(
  templates: ComponentTemplate[],
  knowledgeGraph: { concepts: ConceptNode[] },
  learningStyle: LearningStyle
): GeneratedPlanStep[] {
  const conceptsById = new Map(knowledgeGraph.concepts.map((concept) => [concept.id, concept]));
  const insertedSkillSteps = new Set<string>();
  const steps: GeneratedPlanStep[] = [];

  if (learningStyle === "example-first") {
    steps.push({
      id: "step.architecture-overview",
      title: "Map the first runnable slice",
      kind: "skill",
      objective: "Build a mental model of the major modules and the first end-to-end slice.",
      rationale: "Example-first learners benefit from seeing the execution path before drilling into fundamentals.",
      concepts: ["workflow.decomposition"],
      dependsOn: [],
      validationFocus: ["Can explain the first runnable slice", "Can identify the first dependency chain"],
      suggestedFiles: ["docs/architecture.md"],
      implementationNotes: ["Trace the execution flow before implementing code."],
      quizFocus: ["Can describe the dependency chain in the correct order."],
      hiddenValidationFocus: ["Explains which module unlocks the next one."]
    });
  }

  for (const template of templates) {
    const missingConcepts = template.concepts.filter((conceptId) => {
      const concept = conceptsById.get(conceptId);
      return concept && concept.confidence !== "comfortable";
    });

    if (learningStyle === "concept-first") {
      for (const conceptId of missingConcepts) {
        if (insertedSkillSteps.has(conceptId)) {
          continue;
        }

        steps.push(buildSkillStep(conceptId, template.id));
        insertedSkillSteps.add(conceptId);
      }
    } else if (learningStyle === "build-first") {
      const shakyConcept = missingConcepts.find((conceptId) => {
        const concept = conceptsById.get(conceptId);
        return concept?.confidence === "shaky";
      });

      if (shakyConcept && !insertedSkillSteps.has(shakyConcept)) {
        steps.push(buildSkillStep(shakyConcept, template.id));
        insertedSkillSteps.add(shakyConcept);
      }
    } else {
      const firstMissingConcept = missingConcepts[0];

      if (firstMissingConcept && !insertedSkillSteps.has(firstMissingConcept)) {
        steps.push(buildSkillStep(firstMissingConcept, template.id));
        insertedSkillSteps.add(firstMissingConcept);
      }
    }

    steps.push({
      id: `step.${template.id.replace(/^component\./, "")}`,
      title: `Implement ${template.label}`,
      kind: "implementation",
      objective: template.summary,
      rationale: `This unlocks the next dependent module(s): ${template.dependsOn.length > 0 ? template.dependsOn.join(", ") : "the first runnable slice"}.`,
      concepts: template.concepts,
      dependsOn: template.dependsOn.map((dependency) => `step.${dependency.replace(/^component\./, "")}`),
      validationFocus: template.validationFocus,
      suggestedFiles: template.suggestedFiles,
      implementationNotes: [
        `Implement the real ${template.label.toLowerCase()} slice in-place.`,
        "Keep the public contract stable for downstream steps."
      ],
      quizFocus: template.concepts.map((conceptId) => `Can explain how ${conceptId} applies here.`),
      hiddenValidationFocus: template.validationFocus
    });

    if (learningStyle === "build-first") {
      for (const conceptId of missingConcepts) {
        if (insertedSkillSteps.has(conceptId)) {
          continue;
        }

        steps.push(buildSkillStep(conceptId, template.id));
        insertedSkillSteps.add(conceptId);
      }
    }
  }

  return steps;
}

function buildSkillStep(conceptId: string, anchorComponentId: string): GeneratedPlanStep {
  const conceptMeta = CONCEPT_LIBRARY[conceptId] ?? {
    label: conceptId
  };

  return {
    id: `step.skill.${conceptId}`,
    title: `Strengthen ${conceptMeta.label}`,
    kind: "skill",
    objective: `Close the gap in ${conceptMeta.label} before or alongside ${anchorComponentId}.`,
    rationale: `${conceptMeta.label} is a prerequisite for the next implementation slice.`,
    concepts: [conceptId],
    dependsOn: [],
    validationFocus: [
      `${conceptMeta.label} can be explained correctly`,
      `${conceptMeta.label} can be used in the next task without copying`
    ],
    suggestedFiles: [],
    implementationNotes: [`Review ${conceptMeta.label} in the context of ${anchorComponentId}.`],
    quizFocus: [`Can explain ${conceptMeta.label} in their own words.`],
    hiddenValidationFocus: [`Applies ${conceptMeta.label} without direct copying.`]
  };
}

function summarizePlan(
  session: PlanningSession,
  knowledgeGraph: { strengths: string[]; gaps: string[] },
  steps: GeneratedPlanStep[]
): string {
  const strengthsSummary =
    knowledgeGraph.strengths.length > 0
      ? `Leans on existing strengths in ${knowledgeGraph.strengths.slice(0, 3).join(", ")}.`
      : "Assumes minimal prior comfort and front-loads support.";
  const gapsSummary =
    knowledgeGraph.gaps.length > 0
      ? `Early support is inserted for ${knowledgeGraph.gaps.slice(0, 3).join(", ")}.`
      : "No major concept blockers were detected in the intake.";

  return `Construct generated a ${session.detectedDomain} roadmap for ${session.goal}. ${strengthsSummary} ${gapsSummary} The first path contains ${steps.length} personalized steps.`;
}

function makeQuestion(conceptId: string, prompt: string): PlanningQuestion {
  const concept = CONCEPT_LIBRARY[conceptId];

  return {
    id: `question.${conceptId}`,
    conceptId,
    category: concept?.category ?? "workflow",
    prompt,
    options: [...CONFIDENCE_OPTIONS]
  };
}
