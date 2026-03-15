import { spawn } from "node:child_process";
import type http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { ChatOpenAI } from "@langchain/openai";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  AgentEventSchema,
  AgentJobCreatedResponseSchema,
  AgentJobSnapshotSchema,
  BlueprintStepSchema,
  CurrentPlanningSessionResponseSchema,
  DependencyGraphSchema,
  GeneratedProjectPlanSchema,
  KnowledgeGraphSchema,
  PlanningQuestionSchema,
  PlanningSessionCompleteRequestSchema,
  PlanningSessionCompleteResponseSchema,
  PlanningSessionSchema,
  PlanningSessionStartRequestSchema,
  PlanningSessionStartResponseSchema,
  ProjectBlueprintSchema,
  RuntimeGuideRequestSchema,
  RuntimeGuideResponseSchema,
  UserKnowledgeBaseSchema,
  type AgentEvent,
  type AgentJobCreatedResponse,
  type AgentJobKind,
  type AgentJobSnapshot,
  type ArchitectureComponent,
  type ConceptConfidence,
  type GeneratedProjectPlan,
  type KnowledgeGraph,
  type LearningStyle,
  type PlanningQuestion,
  type PlanningSession,
  type PlanningSessionCompleteRequest,
  type PlanningSessionCompleteResponse,
  type PlanningSessionStartRequest,
  type PlanningSessionStartResponse,
  type ProjectBlueprint,
  type RuntimeGuideRequest,
  type RuntimeGuideResponse,
  type StoredKnowledgeConcept,
  type StoredKnowledgeGoal,
  type UserKnowledgeBase
} from "@construct/shared";
import { tavily } from "@tavily/core";
import { z } from "zod";

import {
  createAgentPersistence,
  type AgentPersistence,
  type PersistedGeneratedBlueprintRecord
} from "./agentPersistence";
import {
  getActiveBlueprintPath as getActiveBlueprintPathFromFile,
  setActiveBlueprintPath
} from "./activeBlueprint";
import { zodToJsonSchema } from "zod-to-json-schema";

type PlanningStateFile = {
  session: PlanningSession | null;
  plan: GeneratedProjectPlan | null;
};

type JobListener = (eventName: string, payload: unknown) => void;

type AgentJobRecord = {
  jobId: string;
  kind: AgentJobKind;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  events: AgentEvent[];
  result: unknown | null;
  error?: string;
  listeners: Set<JobListener>;
};

type ResearchSource = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
};

type ResearchDigest = {
  query: string;
  answer?: string;
  sources: ResearchSource[];
};

type AgentConfig = {
  provider: "openai";
  searchProvider: "tavily" | "exa";
  openAiModel: string;
  openAiApiKey: string;
  openAiBaseUrl?: string;
  tavilyApiKey: string;
  tavilySearchDepth: "basic" | "advanced" | "fast" | "ultra-fast";
};

type AgentDependencies = {
  now?: () => Date;
  llm?: StructuredLanguageModel;
  search?: SearchProvider;
  logger?: AgentLogger;
  persistence?: AgentPersistence;
  projectInstaller?: ProjectInstaller;
};

type AgentLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug?(message: string, context?: Record<string, unknown>): void;
  trace?(message: string, context?: Record<string, unknown>): void;
};

type StructuredLanguageModel = {
  parse<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
  }): Promise<z.infer<T>>;
};

type LanguageModelMessage = [role: "system" | "user", content: string];

type LanguageModelClient = {
  withStructuredOutput<T extends z.ZodTypeAny>(
    schema: T,
    options: { name: string; method: "jsonSchema" }
  ): {
    invoke(messages: LanguageModelMessage[], config?: LanguageModelInvokeConfig): Promise<unknown>;
  };
  invoke(messages: LanguageModelMessage[], config?: LanguageModelInvokeConfig): Promise<{
    content: unknown;
  }>;
};

type LanguageModelInvokeConfig = {
  callbacks?: BaseCallbackHandler[];
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
} & Partial<RunnableConfig<Record<string, unknown>>>;

type SearchProvider = {
  research(query: string): Promise<ResearchDigest>;
};

type DependencyInstallResult = {
  status: "installed" | "skipped" | "failed";
  packageManager: string;
  manifestPath?: string;
  detail?: string;
};

type ProjectInstaller = {
  install(projectRoot: string, files: Record<string, string>): Promise<DependencyInstallResult>;
};

type QuestionGraphState = {
  jobId: string;
  request: PlanningSessionStartRequest;
  knowledgeBase: UserKnowledgeBase;
  goalScope: GoalScope | null;
  projectShapeResearch: ResearchDigest | null;
  prerequisiteResearch: ResearchDigest | null;
  mergedResearch: ResearchDigest | null;
  session: PlanningSession | null;
};

type PlanGraphState = {
  jobId: string;
  request: PlanningSessionCompleteRequest;
  session: PlanningSession;
  knowledgeBase: UserKnowledgeBase;
  goalScope: GoalScope | null;
  architectureResearch: ResearchDigest | null;
  dependencyResearch: ResearchDigest | null;
  validationResearch: ResearchDigest | null;
  mergedResearch: ResearchDigest | null;
  plan: GeneratedProjectPlan | null;
  activeBlueprintPath: string | null;
};

type RuntimeGuideGraphState = {
  jobId: string;
  request: RuntimeGuideRequest;
  knowledgeBase: UserKnowledgeBase;
  guide: RuntimeGuideResponse | null;
};

type ResolvedPlanningAnswer = {
  questionId: string;
  conceptId: string;
  category: "language" | "domain" | "workflow";
  prompt: string;
  answerType: "option" | "custom";
  selectedOption: {
    id: string;
    label: string;
    description: string;
    confidenceSignal: ConceptConfidence;
  } | null;
  customResponse: string | null;
  availableOptions: Array<{
    id: string;
    label: string;
    description: string;
    confidenceSignal: ConceptConfidence;
  }>;
};

type GoalScope = {
  scopeSummary: string;
  artifactShape: string;
  complexityScore: number;
  shouldResearch: boolean;
  recommendedQuestionCount: number;
  recommendedMinSteps: number;
  recommendedMaxSteps: number;
  rationale: string;
};

const GOAL_SCOPE_DRAFT_SCHEMA = z.object({
  scopeSummary: z.string().min(1),
  artifactShape: z.string().min(1),
  complexityScore: z.number().int().min(0).max(100),
  shouldResearch: z.boolean(),
  recommendedQuestionCount: z.number().int().min(2).max(8),
  recommendedMinSteps: z.number().int().min(1).max(12),
  recommendedMaxSteps: z.number().int().min(1).max(16),
  rationale: z.string().min(1)
}).superRefine((value, context) => {
  if (value.recommendedMaxSteps < value.recommendedMinSteps) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "recommendedMaxSteps must be greater than or equal to recommendedMinSteps.",
      path: ["recommendedMaxSteps"]
    });
  }
});

const PLANNING_QUESTION_DRAFT_SCHEMA = z.object({
  detectedLanguage: z.string().min(1),
  detectedDomain: z.string().min(1),
  questions: z.array(
    z.object({
      conceptId: z.string().min(1),
      category: z.enum(["language", "domain", "workflow"]),
      prompt: z.string().min(1),
      options: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1),
          confidenceSignal: z.enum(["comfortable", "shaky", "new"])
        })
      ).length(3)
    })
  ).min(2).max(8)
});

const GENERATED_PROJECT_PLAN_DRAFT_SCHEMA = z.object({
  summary: z.string().min(1),
  knowledgeGraph: KnowledgeGraphSchema,
  architecture: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.enum(["component", "skill"]),
      summary: z.string().min(1),
      dependsOn: z.array(z.string().min(1)).default([])
    })
  ).min(1),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      kind: z.enum(["skill", "implementation"]),
      objective: z.string().min(1),
      rationale: z.string().min(1),
      concepts: z.array(z.string().min(1)).default([]),
      dependsOn: z.array(z.string().min(1)).default([]),
      validationFocus: z.array(z.string().min(1)).default([]),
      suggestedFiles: z.array(z.string().min(1)).default([]),
      implementationNotes: z.array(z.string().min(1)).default([]),
      quizFocus: z.array(z.string().min(1)).default([]),
      hiddenValidationFocus: z.array(z.string().min(1)).default([])
    })
  ).min(1),
  suggestedFirstStepId: z.string().min(1)
});

const GENERATED_FILE_ENTRY_SCHEMA = z.object({
  path: z.string().min(1),
  content: z.string().min(1)
});

const FILE_CONTENTS_SCHEMA = z.array(GENERATED_FILE_ENTRY_SCHEMA);
const NON_EMPTY_FILE_CONTENTS_SCHEMA = FILE_CONTENTS_SCHEMA.refine(
  (files) => files.length > 0,
  {
    message: "At least one file is required."
  }
);

const GENERATED_ANCHOR_DRAFT_SCHEMA = z.object({
  file: z.string().min(1),
  marker: z.string().min(1),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable()
});

const GENERATED_CHECK_OPTION_DRAFT_SCHEMA = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1).nullable()
});

const GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("mcq"),
    prompt: z.string().min(1),
    options: z.array(GENERATED_CHECK_OPTION_DRAFT_SCHEMA).min(2),
    answer: z.string().min(1)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("short-answer"),
    prompt: z.string().min(1),
    rubric: z.array(z.string().min(1)).min(1),
    placeholder: z.string().min(1).nullable()
  })
]);

const GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  doc: z.string().min(1),
  anchor: GENERATED_ANCHOR_DRAFT_SCHEMA,
  tests: z.array(z.string().min(1)).min(1),
  concepts: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)),
  checks: z.array(GENERATED_COMPREHENSION_CHECK_DRAFT_SCHEMA),
  estimatedMinutes: z.number().int().positive(),
  difficulty: z.enum(["intro", "core", "advanced"])
});

const GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA = z.object({
  projectName: z.string().min(1),
  projectSlug: z.string().min(1),
  description: z.string().min(1),
  language: z.string().min(1),
  entrypoints: z.array(z.string().min(1)).min(1).max(5),
  supportFiles: FILE_CONTENTS_SCHEMA,
  canonicalFiles: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  learnerFiles: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  hiddenTests: NON_EMPTY_FILE_CONTENTS_SCHEMA,
  steps: z.array(GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA).min(1),
  dependencyGraph: DependencyGraphSchema,
  tags: z.array(z.string().min(1))
});

export class ConstructAgentService {
  private readonly rootDirectory: string;
  private readonly generatedPlansDirectory: string;
  private readonly generatedBlueprintsDirectory: string;
  private readonly now: () => Date;
  private readonly logger: AgentLogger;
  private readonly persistence: AgentPersistence;
  private readonly llmOverride: StructuredLanguageModel | null;
  private readonly searchOverride: SearchProvider | null;
  private readonly installerOverride: ProjectInstaller | null;
  private resolvedConfig: AgentConfig | null = null;
  private llm: StructuredLanguageModel | null = null;
  private search: SearchProvider | null = null;
  private projectInstaller: ProjectInstaller | null = null;
  private readonly jobs = new Map<string, AgentJobRecord>();

  constructor(
    rootDirectory: string,
    dependencies: AgentDependencies = {}
  ) {
    this.rootDirectory = rootDirectory;
    this.generatedPlansDirectory = path.join(
      rootDirectory,
      ".construct",
      "generated-plans"
    );
    this.generatedBlueprintsDirectory = path.join(
      rootDirectory,
      ".construct",
      "generated-blueprints"
    );
    this.now = dependencies.now ?? (() => new Date());
    this.logger = dependencies.logger ?? createConsoleAgentLogger();
    this.persistence =
      dependencies.persistence ??
      createAgentPersistence({
        rootDirectory,
        logger: this.logger
    });
    this.llmOverride = dependencies.llm ?? null;
    this.searchOverride = dependencies.search ?? null;
    this.installerOverride = dependencies.projectInstaller ?? null;
  }

  async getCurrentPlanningState(): Promise<PlanningStateFile> {
    const state = await this.readPlanningState();
    return CurrentPlanningSessionResponseSchema.parse(state);
  }

  async getActiveBlueprintPath(): Promise<string | null> {
    const activeState = await this.persistence.getActiveBlueprintState();
    const candidatePath = activeState?.blueprintPath?.trim();

    if (candidatePath) {
      const resolvedPath = path.resolve(candidatePath);

      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }

      if (activeState?.sessionId) {
        const restoredPath = await this.restoreGeneratedBlueprint(activeState.sessionId);
        if (restoredPath) {
          return restoredPath;
        }
      }
    }

    return getActiveBlueprintPathFromFile(this.rootDirectory);
  }

  private getLlm(): StructuredLanguageModel {
    if (this.llmOverride) {
      return this.llmOverride;
    }

    if (!this.llm) {
      const config = this.getAgentConfig();
      this.llm = new OpenAIStructuredLanguageModel({
        apiKey: config.openAiApiKey,
        baseUrl: config.openAiBaseUrl,
        model: config.openAiModel,
        logger: this.logger
      });
    }

    return this.llm;
  }

  private getSearch(): SearchProvider {
    if (this.searchOverride) {
      return this.searchOverride;
    }

    if (!this.search) {
      const config = this.getAgentConfig();
      this.search = buildSearchProvider({
        provider: config.searchProvider,
        tavilyApiKey: config.tavilyApiKey,
        depth: config.tavilySearchDepth,
        logger: this.logger
      });
    }

    return this.search;
  }

  private getProjectInstaller(): ProjectInstaller {
    if (this.installerOverride) {
      return this.installerOverride;
    }

    if (!this.projectInstaller) {
      this.projectInstaller = createProjectInstaller(this.logger);
    }

    return this.projectInstaller;
  }

  private getAgentConfig(): AgentConfig {
    if (!this.resolvedConfig) {
      this.resolvedConfig = resolveAgentConfig();
    }

    return this.resolvedConfig;
  }

  createPlanningQuestionsJob(
    input: PlanningSessionStartRequest
  ): AgentJobCreatedResponse {
    const request = PlanningSessionStartRequestSchema.parse(input);
    const job = this.createJob("planning-questions");
    this.logger.info("Queued planning questions job.", {
      jobId: job.jobId,
      kind: job.kind,
      goal: request.goal,
      learningStyle: request.learningStyle
    });

    void this.runJob(job, async () => {
      const result = await this.runPlanningQuestionGraph(job.jobId, request);
      return PlanningSessionStartResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  createPlanningPlanJob(
    input: PlanningSessionCompleteRequest
  ): AgentJobCreatedResponse {
    const request = PlanningSessionCompleteRequestSchema.parse(input);
    const job = this.createJob("planning-plan");
    this.logger.info("Queued planning roadmap job.", {
      jobId: job.jobId,
      kind: job.kind,
      sessionId: request.sessionId,
      answerCount: request.answers.length
    });

    void this.runJob(job, async () => {
      const result = await this.runPlanningPlanGraph(job.jobId, request);
      return PlanningSessionCompleteResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  createRuntimeGuideJob(input: RuntimeGuideRequest): AgentJobCreatedResponse {
    const request = RuntimeGuideRequestSchema.parse(input);
    const job = this.createJob("runtime-guide");
    this.logger.info("Queued runtime guide job.", {
      jobId: job.jobId,
      kind: job.kind,
      stepId: request.stepId,
      filePath: request.filePath,
      tests: request.tests
    });

    void this.runJob(job, async () => {
      const result = await this.runRuntimeGuideGraph(job.jobId, request);
      return RuntimeGuideResponseSchema.parse(result);
    });

    return AgentJobCreatedResponseSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      streamPath: `/agent/jobs/${job.jobId}/stream`,
      resultPath: `/agent/jobs/${job.jobId}`
    });
  }

  getJob(jobId: string): AgentJobSnapshot {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    return AgentJobSnapshotSchema.parse({
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      result: job.result
    });
  }

  openJobStream(jobId: string, response: http.ServerResponse): void {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (eventName: string, payload: unknown) => {
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);

      if (eventName === "agent-end") {
        response.end();
      }
    };

    send("agent-state", this.getJob(jobId));

    for (const event of job.events) {
      send("agent-event", event);
    }

    if (job.status === "completed") {
      send("agent-complete", {
        jobId,
        result: job.result
      });
      response.end();
      return;
    }

    if (job.status === "failed") {
      send("agent-error", {
        jobId,
        error: job.error ?? "Unknown agent failure."
      });
      response.end();
      return;
    }

    job.listeners.add(send);

    response.on("close", () => {
      job.listeners.delete(send);
    });
  }

  private createJob(kind: AgentJobKind): AgentJobRecord {
    const timestamp = this.now().toISOString();
    const record: AgentJobRecord = {
      jobId: randomUUID(),
      kind,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      events: [],
      result: null,
      listeners: new Set()
    };

    this.jobs.set(record.jobId, record);
    return record;
  }

  private async runJob<T>(job: AgentJobRecord, task: () => Promise<T>): Promise<void> {
    const startedAt = Date.now();
    this.updateJobStatus(job, "running");
    this.logger.info("Started agent job.", {
      jobId: job.jobId,
      kind: job.kind
    });

    try {
      const result = await task();
      job.result = result;
      this.updateJobStatus(job, "completed");
      this.logger.info("Completed agent job.", {
        jobId: job.jobId,
        kind: job.kind,
        durationMs: Date.now() - startedAt,
        result: summarizeJobResult(job.kind, result)
      });
      this.broadcast(job, "agent-complete", {
        jobId: job.jobId,
        result
      });
      this.closeListeners(job);
    } catch (error) {
      job.error = error instanceof Error ? error.message : "Unknown agent failure.";
      this.updateJobStatus(job, "failed");
      this.logger.error("Agent job failed.", {
        jobId: job.jobId,
        kind: job.kind,
        durationMs: Date.now() - startedAt,
        error: job.error
      });
      this.emitEvent(job, {
        stage: "failed",
        title: "Agent run failed",
        detail: job.error,
        level: "error"
      });
      this.broadcast(job, "agent-error", {
        jobId: job.jobId,
        error: job.error
      });
      this.closeListeners(job);
    }
  }

  private updateJobStatus(
    job: AgentJobRecord,
    status: AgentJobRecord["status"]
  ): void {
    const previousStatus = job.status;
    job.status = status;
    job.updatedAt = this.now().toISOString();
    if (previousStatus !== status) {
      this.logger.info("Agent job status changed.", {
        jobId: job.jobId,
        kind: job.kind,
        from: previousStatus,
        to: status
      });
    }
    this.broadcast(job, "agent-state", this.getJob(job.jobId));
  }

  private closeListeners(job: AgentJobRecord): void {
    for (const listener of job.listeners) {
      listener("agent-end", {
        jobId: job.jobId,
        status: job.status
      });
    }

    job.listeners.clear();
  }

  private emitEvent(
    job: AgentJobRecord,
    input: Omit<AgentEvent, "id" | "jobId" | "kind" | "timestamp">
  ): void {
    const event = AgentEventSchema.parse({
      id: randomUUID(),
      jobId: job.jobId,
      kind: job.kind,
      timestamp: this.now().toISOString(),
      ...input
    });

    job.events.push(event);
    job.updatedAt = event.timestamp;
    this.logAgentEvent(job, event);
    this.broadcast(job, "agent-event", event);
  }

  private logAgentEvent(job: AgentJobRecord, event: AgentEvent): void {
    const payloadSummary = summarizeAgentEventPayload(event);
    const context: Record<string, unknown> = {
      jobId: job.jobId,
      kind: job.kind,
      stage: event.stage,
      level: event.level,
      title: event.title
    };

    if (event.detail) {
      context.detail = event.detail;
    }

    if (payloadSummary) {
      context.payload = payloadSummary;
    }

    if (event.level === "error") {
      this.logger.error("Agent emitted event.", context);
      return;
    }

    if (event.level === "warning") {
      this.logger.warn("Agent emitted event.", context);
      return;
    }

    this.logger.info("Agent emitted event.", context);
  }

  private broadcast(job: AgentJobRecord, eventName: string, payload: unknown): void {
    for (const listener of job.listeners) {
      listener(eventName, payload);
    }
  }

  private async runPlanningQuestionGraph(
    jobId: string,
    request: PlanningSessionStartRequest
  ): Promise<PlanningSessionStartResponse> {
    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<PlanningSessionStartRequest>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      goalScope: Annotation<GoalScope | null>(),
      projectShapeResearch: Annotation<ResearchDigest | null>(),
      prerequisiteResearch: Annotation<ResearchDigest | null>(),
      mergedResearch: Annotation<ResearchDigest | null>(),
      session: Annotation<PlanningSession | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async (state) => ({
        knowledgeBase: await this.withStage(jobId, "knowledge-base", "Loading learner knowledge", "Pulling stored concept history and past goals.", async () => {
          return this.readKnowledgeBase();
        })
      }))
      .addNode("determineScope", async (state) => ({
        goalScope: await this.withStage(jobId, "scope-analysis", "Scoping the request", "The Architect is deciding how large the project should be and whether broad external research is justified.", async () => {
          return this.determineGoalScope(state.request.goal, state.request.learningStyle);
        })
      }))
      .addNode("researchProjectShape", async (state) => ({
        projectShapeResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-project-shape",
              "Skipping broad project-shape research",
              state.goalScope.rationale,
              `Local-scope shape for: ${state.request.goal}`
            )
          : await this.withStage(jobId, "research-project-shape", "Researching the target project shape", "Fetching architecture references, major subsystems, and implementation constraints from Tavily.", async () => {
              return this.getSearch().research(
                `Project architecture, core subsystems, and implementation constraints for: ${state.request.goal}`
              );
            })
      }))
      .addNode("researchPrerequisites", async (state) => ({
        prerequisiteResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-prerequisites",
              "Skipping broad prerequisite research",
              state.goalScope.rationale,
              `Local-scope prerequisites for: ${state.request.goal}`
            )
          : await this.withStage(jobId, "research-prerequisites", "Researching prerequisite skills", "Identifying the language, compiler, and systems concepts this project depends on.", async () => {
              return this.getSearch().research(
                `Prerequisite language, compiler, and systems skills needed for: ${state.request.goal}`
              );
            })
      }))
      .addNode("mergeResearch", async (state) => ({
        mergedResearch: await this.withStage(jobId, "research-merge", "Combining research signals", "Merging architecture and prerequisite findings into a single planning context.", async () => {
          return mergeResearchDigests("Combined project-shape and prerequisite research", [
            state.projectShapeResearch,
            state.prerequisiteResearch
          ]);
        })
      }))
      .addNode("generateQuestions", async (state) => ({
        session: await this.withStage(jobId, "question-generation", "Generating targeted knowledge questions", "OpenAI is turning the goal and stored knowledge into concept-level intake questions.", async () => {
          const stream = this.createModelStreamForwarder(jobId, "question-generation", "question generation");
          try {
            const questionDraft = await this.getLlm().parse({
              schema: PLANNING_QUESTION_DRAFT_SCHEMA,
              schemaName: "construct_planning_question_draft",
              instructions: buildQuestionGenerationInstructions(),
              prompt: JSON.stringify(
                {
                  goal: state.request.goal,
                  goalScope: state.goalScope,
                  learningStyle: state.request.learningStyle,
                  priorKnowledge: compactKnowledgeBase(state.knowledgeBase),
                  research: compactResearchDigest(state.mergedResearch)
                },
                null,
                2
              ),
              maxOutputTokens: 2_500,
              verbosity: "medium",
              stream
            });

            return this.buildPlanningSession(state.request, questionDraft);
          } finally {
            stream.onComplete?.();
          }
        })
      }))
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "determineScope")
      .addEdge("determineScope", "researchProjectShape")
      .addEdge("determineScope", "researchPrerequisites")
      .addEdge("researchProjectShape", "mergeResearch")
      .addEdge("researchPrerequisites", "mergeResearch")
      .addEdge("mergeResearch", "generateQuestions")
      .addEdge("generateQuestions", END)
      .compile();

    const result = await graph.invoke({
      jobId,
      request,
      knowledgeBase: emptyKnowledgeBase(this.now),
      goalScope: null,
      projectShapeResearch: null,
      prerequisiteResearch: null,
      mergedResearch: null,
      session: null
    });

    await this.writePlanningState({
      session: result.session,
      plan: null
    });

    return PlanningSessionStartResponseSchema.parse({
      session: result.session
    });
  }

  private async runPlanningPlanGraph(
    jobId: string,
    request: PlanningSessionCompleteRequest
  ): Promise<PlanningSessionCompleteResponse> {
    const planningState = await this.readPlanningState();

    if (!planningState.session || planningState.session.sessionId !== request.sessionId) {
      throw new Error(`Unknown planning session ${request.sessionId}.`);
    }

    const session = planningState.session;
    const resolvedAnswers = this.resolvePlanningAnswers(session, request.answers);

    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<PlanningSessionCompleteRequest>(),
      session: Annotation<PlanningSession>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      goalScope: Annotation<GoalScope | null>(),
      architectureResearch: Annotation<ResearchDigest | null>(),
      dependencyResearch: Annotation<ResearchDigest | null>(),
      validationResearch: Annotation<ResearchDigest | null>(),
      mergedResearch: Annotation<ResearchDigest | null>(),
      plan: Annotation<GeneratedProjectPlan | null>(),
      activeBlueprintPath: Annotation<string | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async () => ({
        knowledgeBase: await this.withStage(jobId, "knowledge-base", "Loading learner knowledge", "Combining stored knowledge with the current self-reported answers.", async () => {
          return this.readKnowledgeBase();
        })
      }))
      .addNode("determineScope", async (state) => ({
        goalScope: await this.withStage(jobId, "scope-analysis", "Scoping the request", "The Architect is deciding how large the generated project should be before it spends tokens on research and blueprint synthesis.", async () => {
          return this.determineGoalScope(state.session.goal, state.session.learningStyle);
        })
      }))
      .addNode("researchArchitecture", async (state) => ({
        architectureResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-architecture",
              "Skipping broad architecture research",
              state.goalScope.rationale,
              `Local architecture outline for: ${state.session.goal}`
            )
          : await this.withStage(jobId, "research-architecture", "Researching architecture", "Fetching reference material for the requested system shape and major component boundaries.", async () => {
              return this.getSearch().research(
                `${state.session.goal} architecture, core modules, component boundaries`
              );
            })
      }))
      .addNode("researchDependencies", async (state) => ({
        dependencyResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-dependency-order",
              "Skipping broad dependency-order research",
              state.goalScope.rationale,
              `Local dependency order for: ${state.session.goal}`
            )
          : await this.withStage(jobId, "research-dependency-order", "Researching dependency order", "Tracing which modules must exist first and how the build should be sequenced.", async () => {
              return this.getSearch().research(
                `${state.session.goal} dependency order, implementation sequence, bootstrap plan`
              );
            })
      }))
      .addNode("researchValidation", async (state) => ({
        validationResearch: state.goalScope && !state.goalScope.shouldResearch
          ? await this.skipResearchStage(
              jobId,
              "research-validation-strategy",
              "Skipping broad validation research",
              state.goalScope.rationale,
              `Local validation seams for: ${state.session.goal}`
            )
          : await this.withStage(jobId, "research-validation-strategy", "Researching validation strategy", "Finding good validation seams, harness patterns, and per-component test boundaries.", async () => {
              return this.getSearch().research(
                `${state.session.goal} validation strategy, test harness, component-level testing approach`
              );
            })
      }))
      .addNode("mergeResearch", async (state) => ({
        mergedResearch: await this.withStage(jobId, "research-merge", "Combining research signals", "Fusing architecture, dependency, and validation research into a single generation context.", async () => {
          return mergeResearchDigests("Combined architecture, dependency-order, and validation research", [
            state.architectureResearch,
            state.dependencyResearch,
            state.validationResearch
          ]);
        })
      }))
      .addNode("generatePlan", async (state) => ({
        plan: await this.withStage(jobId, "plan-generation", "Synthesizing the personalized roadmap", "OpenAI is merging the project dependencies, learner profile, and research into a detailed build path.", async () => {
          const stream = this.createModelStreamForwarder(jobId, "plan-generation", "plan generation");
          try {
            const planDraft = await this.getLlm().parse({
              schema: GENERATED_PROJECT_PLAN_DRAFT_SCHEMA,
              schemaName: "construct_generated_project_plan",
              instructions: buildPlanGenerationInstructions(),
              prompt: JSON.stringify(
                {
                  session: state.session,
                  goalScope: state.goalScope,
                  answers: resolvedAnswers,
                  priorKnowledge: compactKnowledgeBase(state.knowledgeBase),
                  research: compactResearchDigest(state.mergedResearch)
                },
                null,
                2
              ),
              maxOutputTokens: 16_000,
              verbosity: "medium",
              stream
            });

            const plan = this.buildGeneratedPlan(state.session, planDraft);
            await this.persistPlanningArtifacts(state.session, plan);
            await this.writePlanningState({
              session: state.session,
              plan
            });
            await this.mergeKnowledgeBase(state.knowledgeBase, state.session, plan);

            return plan;
          } finally {
            stream.onComplete?.();
          }
        })
      }))
      .addNode("generateBlueprint", async (state) => ({
        activeBlueprintPath: await this.withStage(jobId, "blueprint-generation", "Generating the runnable project blueprint", "Construct is generating the canonical project, masked learner files, and hidden tests for the personalized path.", async () => {
          if (!state.plan) {
            throw new Error("Cannot generate a blueprint before the project plan exists.");
          }

          const blueprintRequestContext = {
            stepCount: state.plan.steps.length,
            architectureNodeCount: state.plan.architecture.length,
            suggestedFirstStepId: state.plan.suggestedFirstStepId,
            firstStepTitle: state.plan.steps[0]?.title ?? null
          };

          const job = this.jobs.get(jobId);
          if (job) {
            this.emitEvent(job, {
              stage: "blueprint-synthesis",
              title: "Drafting the project bundle",
              detail: "The Architect is asking the model to write the completed project files, derive the learner-owned files, and attach hidden tests to each task.",
              level: "info",
              payload: blueprintRequestContext
            });
          }
          this.logger.info("Submitting blueprint synthesis request.", {
            jobId,
            sessionId: state.session.sessionId,
            goal: state.session.goal,
            ...blueprintRequestContext
          });

          const stream = this.createModelStreamForwarder(
            jobId,
            "blueprint-synthesis",
            "project bundle synthesis"
          );

          const bundleDraft = await this.getLlm().parse({
            schema: GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA,
            schemaName: "construct_generated_blueprint_bundle",
            instructions: buildBlueprintGenerationInstructions(),
            prompt: JSON.stringify(
              {
                session: state.session,
                goalScope: state.goalScope,
                answers: resolvedAnswers,
                plan: state.plan,
                priorKnowledge: compactKnowledgeBase(state.knowledgeBase),
                research: compactResearchDigest(state.mergedResearch)
              },
              null,
              2
            ),
            maxOutputTokens: 20_000,
            verbosity: "medium",
            stream
          }).finally(() => {
            stream.onComplete?.();
          });

          if (job) {
            this.emitEvent(job, {
              stage: "blueprint-synthesis",
              title: "Project bundle drafted",
              detail: "The Architect has returned a candidate project bundle and Construct is now materializing it into a runnable workspace.",
              level: "success",
              payload: {
                supportFileCount: bundleDraft.supportFiles.length,
                canonicalFileCount: bundleDraft.canonicalFiles.length,
                learnerFileCount: bundleDraft.learnerFiles.length,
                hiddenTestCount: bundleDraft.hiddenTests.length,
                stepCount: bundleDraft.steps.length
              }
            });
          }
          this.logger.info("Received blueprint synthesis response.", {
            jobId,
            sessionId: state.session.sessionId,
            supportFileCount: bundleDraft.supportFiles.length,
            canonicalFileCount: bundleDraft.canonicalFiles.length,
            learnerFileCount: bundleDraft.learnerFiles.length,
            hiddenTestCount: bundleDraft.hiddenTests.length,
            stepCount: bundleDraft.steps.length
          });

          return this.persistGeneratedBlueprint(jobId, state.session, state.plan, bundleDraft);
        })
      }))
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "determineScope")
      .addEdge("determineScope", "researchArchitecture")
      .addEdge("determineScope", "researchDependencies")
      .addEdge("determineScope", "researchValidation")
      .addEdge("researchArchitecture", "mergeResearch")
      .addEdge("researchDependencies", "mergeResearch")
      .addEdge("researchValidation", "mergeResearch")
      .addEdge("mergeResearch", "generatePlan")
      .addEdge("generatePlan", "generateBlueprint")
      .addEdge("generateBlueprint", END)
      .compile();

    const result = await graph.invoke({
      jobId,
      request,
      session,
      knowledgeBase: emptyKnowledgeBase(this.now),
      goalScope: null,
      architectureResearch: null,
      dependencyResearch: null,
      validationResearch: null,
      mergedResearch: null,
      plan: null,
      activeBlueprintPath: null
    });

    return PlanningSessionCompleteResponseSchema.parse({
      session,
      plan: result.plan
    });
  }

  private async runRuntimeGuideGraph(
    jobId: string,
    request: RuntimeGuideRequest
  ): Promise<RuntimeGuideResponse> {
    const StateAnnotation = Annotation.Root({
      jobId: Annotation<string>(),
      request: Annotation<RuntimeGuideRequest>(),
      knowledgeBase: Annotation<UserKnowledgeBase>(),
      guide: Annotation<RuntimeGuideResponse | null>()
    });

    const graph = new StateGraph(StateAnnotation)
      .addNode("loadKnowledgeBase", async () => ({
        knowledgeBase: await this.withStage(jobId, "knowledge-base", "Loading learner context", "Reading stored knowledge so guidance matches prior signals.", async () => {
          return this.readKnowledgeBase();
        })
      }))
      .addNode("generateGuidance", async (state) => ({
        guide: await this.withStage(jobId, "runtime-guide", "Analyzing the current implementation", "OpenAI is reviewing the anchored code, constraints, and latest test result to prepare Socratic guidance.", async () => {
          const stream = this.createModelStreamForwarder(
            jobId,
            "runtime-guide",
            "runtime guidance"
          );

          try {
            return this.getLlm().parse({
              schema: RuntimeGuideResponseSchema,
              schemaName: "construct_runtime_guide",
              instructions: buildRuntimeGuideInstructions(),
              prompt: JSON.stringify(
                {
                  request: state.request,
                  priorKnowledge: compactKnowledgeBase(state.knowledgeBase)
                },
                null,
                2
              ),
              maxOutputTokens: 3_000,
              verbosity: "medium",
              stream
            });
          } finally {
            stream.onComplete?.();
          }
        })
      }))
      .addEdge(START, "loadKnowledgeBase")
      .addEdge("loadKnowledgeBase", "generateGuidance")
      .addEdge("generateGuidance", END)
      .compile();

    const result = await graph.invoke({
      jobId,
      request,
      knowledgeBase: emptyKnowledgeBase(this.now),
      guide: null
    });

    return RuntimeGuideResponseSchema.parse(result.guide);
  }

  private async withStage<T>(
    jobId: string,
    stage: string,
    title: string,
    detail: string,
    task: () => Promise<T>
  ): Promise<T> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "info"
    });

    const result = await task();

    if (stage.startsWith("research")) {
      const research = result as ResearchDigest;
      this.emitEvent(job, {
        stage,
        title: "Research references loaded",
        detail: `Collected ${research.sources.length} sources through ${research.query}.`,
        level: "success",
        payload: {
          query: research.query,
          sources: research.sources
        }
      });
      return result;
    }

    this.emitEvent(job, {
      stage,
      title: `${title} complete`,
      detail,
      level: "success"
    });

    return result;
  }

  private async withPayloadStage<T extends Record<string, unknown>>(
    jobId: string,
    stage: string,
    title: string,
    detail: string,
    task: () => Promise<T>
  ): Promise<T> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "info"
    });

    const result = await task();

    this.emitEvent(job, {
      stage,
      title: `${title} complete`,
      detail,
      level: "success",
      payload: result
    });

    return result;
  }

  private async determineGoalScope(
    goal: string,
    learningStyle: LearningStyle
  ): Promise<GoalScope> {
    try {
      return await this.getLlm().parse({
        schema: GOAL_SCOPE_DRAFT_SCHEMA,
        schemaName: "construct_goal_scope",
        instructions: buildGoalScopeInstructions(),
        prompt: JSON.stringify(
          {
            goal,
            learningStyle
          },
          null,
          2
        ),
        maxOutputTokens: 800,
        verbosity: "low"
      });
    } catch (error) {
      const fallback = inferGoalScopeFallback(goal);
      this.logger.warn("Goal-scope analysis failed. Falling back to heuristic scope.", {
        goal,
        learningStyle,
        error: error instanceof Error ? error.message : "Unknown scope-analysis failure.",
        fallback
      });
      return fallback;
    }
  }

  private async skipResearchStage(
    jobId: string,
    stage: string,
    title: string,
    detail: string,
    query: string
  ): Promise<ResearchDigest> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    this.emitEvent(job, {
      stage,
      title,
      detail,
      level: "info"
    });

    const result: ResearchDigest = {
      query,
      answer: detail,
      sources: []
    };

    this.emitEvent(job, {
      stage,
      title: "Research skipped for small local scope",
      detail,
      level: "success",
      payload: {
        query,
        skipped: true,
        reason: "small-local-scope"
      }
    });

    return result;
  }

  private createModelStreamForwarder(
    jobId: string,
    stage: string,
    label: string
  ): NonNullable<Parameters<StructuredLanguageModel["parse"]>[0]["stream"]> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    let buffer = "";
    let flushHandle: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (!buffer) {
        return;
      }

      const chunk = buffer;
      buffer = "";

      this.logger.trace?.("Streaming model output chunk.", {
        jobId,
        kind: job.kind,
        stage,
        label,
        chunk
      });

      this.emitEvent(job, {
        stage: `${stage}-stream`,
        title: `Live draft: ${label}`,
        detail: chunk,
        level: "info",
        payload: {
          stream: true,
          label,
          text: chunk
        }
      });
    };

    const clearScheduledFlush = () => {
      if (!flushHandle) {
        return;
      }

      clearTimeout(flushHandle);
      flushHandle = null;
    };

    const scheduleFlush = () => {
      if (flushHandle) {
        return;
      }

      flushHandle = setTimeout(() => {
        flushHandle = null;
        flush();
      }, 180);
    };

    return {
      stage,
      label,
      onToken: (chunk) => {
        if (!chunk) {
          return;
        }

        buffer += chunk;

        if (buffer.length >= 120 || chunk.includes("\n")) {
          clearScheduledFlush();
          flush();
          return;
        }

        scheduleFlush();
      },
      onComplete: () => {
        clearScheduledFlush();
        flush();
      }
    };
  }

  private buildPlanningSession(
    request: PlanningSessionStartRequest,
    questionDraft: z.infer<typeof PLANNING_QUESTION_DRAFT_SCHEMA>
  ): PlanningSession {
    const normalizedGoal = request.goal.trim().replace(/\s+/g, " ");

    const questions = questionDraft.questions.map((question) =>
      PlanningQuestionSchema.parse({
        id: `question.${slugify(question.conceptId)}`,
        conceptId: question.conceptId,
        category: question.category,
        prompt: question.prompt,
        options: question.options
      })
    );

    const session = PlanningSessionSchema.parse({
      sessionId: randomUUID(),
      goal: normalizedGoal,
      normalizedGoal,
      learningStyle: request.learningStyle,
      detectedLanguage: questionDraft.detectedLanguage,
      detectedDomain: questionDraft.detectedDomain,
      createdAt: this.now().toISOString(),
      questions
    });

    return session;
  }

  private buildGeneratedPlan(
    session: PlanningSession,
    draft: z.infer<typeof GENERATED_PROJECT_PLAN_DRAFT_SCHEMA>
  ): GeneratedProjectPlan {
    return GeneratedProjectPlanSchema.parse({
      sessionId: session.sessionId,
      goal: session.goal,
      language: session.detectedLanguage,
      domain: session.detectedDomain,
      learningStyle: session.learningStyle,
      summary: draft.summary,
      knowledgeGraph: draft.knowledgeGraph,
      architecture: draft.architecture,
      steps: draft.steps,
      suggestedFirstStepId: draft.suggestedFirstStepId
    });
  }

  private resolvePlanningAnswers(
    session: PlanningSession,
    answers: PlanningSessionCompleteRequest["answers"]
  ): ResolvedPlanningAnswer[] {
    return answers.map((answer) => {
      const question = session.questions.find((entry) => entry.id === answer.questionId);

      if (!question) {
        throw new Error(`Unknown planning question ${answer.questionId}.`);
      }

      if (answer.answerType === "custom") {
        return {
          questionId: question.id,
          conceptId: question.conceptId,
          category: question.category,
          prompt: question.prompt,
          answerType: "custom",
          selectedOption: null,
          customResponse: answer.customResponse.trim(),
          availableOptions: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            confidenceSignal: option.confidenceSignal
          }))
        };
      }

      const selectedOption = question.options.find((option) => option.id === answer.optionId);

      if (!selectedOption) {
        throw new Error(
          `Unknown option ${answer.optionId} for planning question ${answer.questionId}.`
        );
      }

      return {
        questionId: question.id,
        conceptId: question.conceptId,
        category: question.category,
        prompt: question.prompt,
        answerType: "option",
        selectedOption: {
          id: selectedOption.id,
          label: selectedOption.label,
          description: selectedOption.description,
          confidenceSignal: selectedOption.confidenceSignal
        },
        customResponse: null,
        availableOptions: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description,
          confidenceSignal: option.confidenceSignal
        }))
      };
    });
  }

  private async persistGeneratedBlueprint(
    jobId: string,
    session: PlanningSession,
    plan: GeneratedProjectPlan,
    draft: z.infer<typeof GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA>
  ): Promise<string> {
    const supportFiles = fileEntriesToRecord(draft.supportFiles);
    const canonicalFiles = fileEntriesToRecord(draft.canonicalFiles);
    const learnerFiles = fileEntriesToRecord(draft.learnerFiles);
    const hiddenTests = fileEntriesToRecord(draft.hiddenTests);
    const projectSlug = slugify(draft.projectSlug || draft.projectName || session.goal) || "generated-project";
    const projectRoot = path.join(
      this.generatedBlueprintsDirectory,
      `${session.sessionId}-${projectSlug}`
    );
    const blueprintPath = path.join(projectRoot, "project-blueprint.json");

    await this.withPayloadStage(
      jobId,
      "blueprint-layout",
      "Preparing the generated project layout",
      "Creating the canonical project directory and scaffold destination.",
      async () => {
        await rm(projectRoot, { recursive: true, force: true });
        await mkdir(projectRoot, { recursive: true });

        return {
          projectRoot,
          entrypointCount: draft.entrypoints.length,
          entrypoints: draft.entrypoints.slice(0, 4)
        };
      }
    );

    await this.withPayloadStage(
      jobId,
      "blueprint-support-files",
      "Writing support files",
      "Creating manifests, configs, and shared support files for the completed project.",
      async () => {
        await this.writeProjectFiles(projectRoot, supportFiles);
        return summarizeFileBatch(supportFiles);
      }
    );

    await this.withPayloadStage(
      jobId,
      "blueprint-canonical-files",
      "Writing the completed reference implementation",
      "Materializing the solved project files that define the canonical working system.",
      async () => {
        await this.writeProjectFiles(projectRoot, canonicalFiles);
        return summarizeFileBatch(canonicalFiles);
      }
    );

    await this.withPayloadStage(
      jobId,
      "blueprint-hidden-tests",
      "Creating hidden validation tests",
      "Writing targeted validations that will check only the learner-owned work for each task.",
      async () => {
        await this.writeProjectFiles(projectRoot, hiddenTests);
        return {
          ...summarizeFileBatch(hiddenTests),
          testCount: Object.keys(hiddenTests).length
        };
      }
    );

    const blueprint: ProjectBlueprint = ProjectBlueprintSchema.parse({
      id: `construct.generated.${session.sessionId}.${projectSlug}`,
      name: draft.projectName,
      version: "0.1.0",
      description: draft.description,
      projectRoot,
      sourceProjectRoot: projectRoot,
      language: draft.language,
      entrypoints: draft.entrypoints,
      files: learnerFiles,
      steps: normalizeGeneratedBlueprintSteps(draft.steps),
      dependencyGraph: draft.dependencyGraph,
      metadata: {
        createdBy: "Construct Architect agent",
        createdAt: this.now().toISOString(),
        targetLanguage: draft.language,
        tags: Array.from(new Set([
          ...draft.tags,
          session.detectedDomain,
          session.detectedLanguage,
          "agent-generated"
        ]))
      }
    });
    const timestamp = this.now().toISOString();

    await this.withPayloadStage(
      jobId,
      "blueprint-learner-mask",
      "Packaging learner-owned tasks",
      "Masking selected regions, attaching anchors, and mapping each hidden validation to the learner-facing steps.",
      async () => {
        await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
        return {
          stepCount: blueprint.steps.length,
          maskedFileCount: Object.keys(learnerFiles).length,
          samplePaths: Object.keys(learnerFiles).slice(0, 4),
          firstStepId: plan.suggestedFirstStepId
        };
      }
    );

    await this.runDependencyInstallStage(jobId, projectRoot, {
      ...supportFiles,
      ...canonicalFiles,
      ...hiddenTests
    });

    await this.withPayloadStage(
      jobId,
      "blueprint-activation",
      "Activating the generated workspace",
      "Saving the blueprint record, selecting it as active, and preparing the learner workspace for the first step.",
      async () => {
        await this.persistence.saveGeneratedBlueprintRecord({
          sessionId: session.sessionId,
          goal: session.goal,
          blueprintId: blueprint.id,
          blueprintPath,
          projectRoot,
          blueprintJson: JSON.stringify(blueprint),
          planJson: JSON.stringify(plan),
          bundleJson: JSON.stringify(draft),
          createdAt: timestamp,
          updatedAt: timestamp,
          isActive: true
        });
        await this.persistence.setActiveBlueprintState({
          blueprintPath,
          sessionId: session.sessionId,
          updatedAt: timestamp
        });
        await setActiveBlueprintPath({
          rootDirectory: this.rootDirectory,
          blueprintPath,
          sessionId: session.sessionId,
          now: this.now
        });

        return {
          blueprintId: blueprint.id,
          stepCount: blueprint.steps.length,
          hiddenTestCount: Object.keys(hiddenTests).length,
          suggestedFirstStepId: plan.suggestedFirstStepId
        };
      }
    );
    this.logger.info("Persisted generated blueprint and activated it.", {
      sessionId: session.sessionId,
      blueprintPath,
      projectRoot,
      goal: session.goal,
      stepCount: blueprint.steps.length,
      canonicalFileCount: Object.keys(canonicalFiles).length,
      learnerFileCount: Object.keys(learnerFiles).length,
      hiddenTestCount: Object.keys(hiddenTests).length,
      suggestedFirstStepId: plan.suggestedFirstStepId
    });

    return blueprintPath;
  }

  private async persistPlanningArtifacts(
    session: PlanningSession,
    plan: GeneratedProjectPlan
  ): Promise<void> {
    await mkdir(this.generatedPlansDirectory, { recursive: true });
    const artifactPath = path.join(this.generatedPlansDirectory, `${session.sessionId}.json`);
    await writeFile(artifactPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    this.logger.info("Persisted generated planning artifact.", {
      sessionId: session.sessionId,
      artifactPath,
      stepCount: plan.steps.length,
      architectureNodeCount: plan.architecture.length
    });
  }

  private async writeProjectFiles(
    projectRoot: string,
    files: Record<string, string>
  ): Promise<void> {
    for (const [relativePath, contents] of Object.entries(files)) {
      const destinationPath = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, contents, "utf8");
    }
  }

  private async readPlanningState(): Promise<PlanningStateFile> {
    return (
      (await this.persistence.getPlanningState()) ?? {
        session: null,
        plan: null
      }
    );
  }

  private async writePlanningState(state: PlanningStateFile): Promise<void> {
    await this.persistence.setPlanningState(
      CurrentPlanningSessionResponseSchema.parse(state)
    );
  }

  private async readKnowledgeBase(): Promise<UserKnowledgeBase> {
    return (await this.persistence.getKnowledgeBase()) ?? emptyKnowledgeBase(this.now);
  }

  private async mergeKnowledgeBase(
    current: UserKnowledgeBase,
    session: PlanningSession,
    plan: GeneratedProjectPlan
  ): Promise<void> {
    const conceptMap = new Map(current.concepts.map((concept) => [concept.id, concept]));
    const timestamp = this.now().toISOString();

    for (const concept of plan.knowledgeGraph.concepts) {
      conceptMap.set(concept.id, {
        id: concept.id,
        label: concept.label,
        category: concept.category,
        confidence: concept.confidence,
        rationale: concept.rationale,
        source: "self-report",
        updatedAt: timestamp
      });
    }

    const goals = current.goals.filter((goal) => goal.goal !== session.goal);
    goals.unshift({
      goal: session.goal,
      language: session.detectedLanguage,
      domain: session.detectedDomain,
      lastPlannedAt: timestamp
    });

    const nextKnowledgeBase = UserKnowledgeBaseSchema.parse({
      updatedAt: timestamp,
      concepts: Array.from(conceptMap.values()),
      goals: goals.slice(0, 25)
    });

    await this.persistence.setKnowledgeBase(nextKnowledgeBase);
    this.logger.info("Merged planning signals into learner knowledge base.", {
      sessionId: session.sessionId,
      goal: session.goal,
      conceptCount: nextKnowledgeBase.concepts.length,
      goalCount: nextKnowledgeBase.goals.length
    });
  }

  private async runDependencyInstallStage(
    jobId: string,
    projectRoot: string,
    files: Record<string, string>
  ): Promise<DependencyInstallResult> {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw new Error(`Unknown agent job ${jobId}.`);
    }

    this.emitEvent(job, {
      stage: "blueprint-dependency-install",
      title: "Preparing project dependencies",
      detail: "Installing the generated project's dependencies when a supported manifest is present.",
      level: "info"
    });

    const result = await this.getProjectInstaller().install(projectRoot, files);

    this.emitEvent(job, {
      stage: "blueprint-dependency-install",
      title:
        result.status === "installed"
          ? "Project dependencies installed"
          : result.status === "skipped"
            ? "Dependency installation skipped"
            : "Dependency installation needs attention",
      detail:
        result.detail ??
        (result.status === "installed"
          ? "The generated project dependencies are ready."
          : result.status === "skipped"
            ? "No supported dependency manifest was generated."
            : "The generated project was activated, but dependency installation did not finish cleanly."),
      level: result.status === "failed" ? "warning" : "success",
      payload: result
    });

    return result;
  }

  private async restoreGeneratedBlueprint(sessionId: string): Promise<string | null> {
    const record = await this.persistence.getGeneratedBlueprintRecord(sessionId);

    if (!record) {
      return null;
    }

    const restoredPath = await this.materializePersistedBlueprint(record);
    const updatedAt = this.now().toISOString();

    await this.persistence.setActiveBlueprintState({
      blueprintPath: restoredPath,
      sessionId,
      updatedAt
    });
    await setActiveBlueprintPath({
      rootDirectory: this.rootDirectory,
      blueprintPath: restoredPath,
      sessionId,
      now: this.now
    });

    this.logger.info("Restored active blueprint from persisted record.", {
      sessionId,
      blueprintPath: restoredPath
    });

    return restoredPath;
  }

  private async materializePersistedBlueprint(
    record: PersistedGeneratedBlueprintRecord
  ): Promise<string> {
    const bundle = GENERATED_BLUEPRINT_BUNDLE_DRAFT_SCHEMA.parse(
      JSON.parse(record.bundleJson)
    );
    const blueprint = ProjectBlueprintSchema.parse(JSON.parse(record.blueprintJson));
    const projectRoot = record.projectRoot;
    const blueprintPath = path.join(projectRoot, "project-blueprint.json");

    await rm(projectRoot, { recursive: true, force: true });
    await mkdir(projectRoot, { recursive: true });
    await this.writeProjectFiles(projectRoot, fileEntriesToRecord(bundle.supportFiles));
    await this.writeProjectFiles(projectRoot, fileEntriesToRecord(bundle.canonicalFiles));
    await this.writeProjectFiles(projectRoot, fileEntriesToRecord(bundle.hiddenTests));

    const nextBlueprint = ProjectBlueprintSchema.parse({
      ...blueprint,
      projectRoot,
      sourceProjectRoot: projectRoot
    });

    await writeFile(
      blueprintPath,
      `${JSON.stringify(nextBlueprint, null, 2)}\n`,
      "utf8"
    );

    return blueprintPath;
  }
}

export class OpenAIStructuredLanguageModel implements StructuredLanguageModel {
  private readonly client: LanguageModelClient;
  private readonly model: string;
  private readonly logger: AgentLogger;

  constructor(input: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    logger: AgentLogger;
    client?: LanguageModelClient;
  }) {
    this.client =
      input.client ??
      new ChatOpenAI({
        apiKey: input.apiKey,
        model: input.model,
        configuration: input.baseUrl
          ? {
              baseURL: input.baseUrl
            }
          : undefined
      });
    this.model = input.model;
    this.logger = input.logger;
  }

  async parse<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
  }): Promise<z.infer<T>> {
    const startedAt = Date.now();
    this.logger.info("Starting OpenAI structured generation.", {
      model: this.model,
      schemaName: input.schemaName,
      promptChars: input.prompt.length,
      maxOutputTokens: input.maxOutputTokens ?? 4_000,
      verbosity: input.verbosity ?? "medium"
    });
    this.logger.trace?.("OpenAI generation request trace.", {
      model: this.model,
      schemaName: input.schemaName,
      instructions: input.instructions,
      prompt: input.prompt
    });
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const parsed = await this.invokeStructuredResponse(input);
        this.logger.info("Completed OpenAI structured generation.", {
          model: this.model,
          schemaName: input.schemaName,
          durationMs: Date.now() - startedAt,
          attempt,
          mode: "structured",
          response: summarizeStructuredOutput(input.schemaName, parsed)
        });
        return parsed;
      } catch (error) {
        lastError = toError(error);

        if (isStructuredOutputSchemaCompatibilityError(lastError)) {
          this.logger.warn("Structured output schema was incompatible. Retrying with JSON fallback.", {
            model: this.model,
            schemaName: input.schemaName,
            attempt,
            error: lastError.message
          });
          break;
        }

        if (attempt >= 2 || !isRetryableModelError(lastError)) {
          throw lastError;
        }

        this.logger.warn("Structured generation failed. Retrying request.", {
          model: this.model,
          schemaName: input.schemaName,
          attempt,
          error: lastError.message
        });
      }
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const parsed = await this.invokeJsonFallback(input);
        this.logger.info("Completed OpenAI structured generation.", {
          model: this.model,
          schemaName: input.schemaName,
          durationMs: Date.now() - startedAt,
          attempt,
          mode: "json-fallback",
          response: summarizeStructuredOutput(input.schemaName, parsed)
        });
        return parsed;
      } catch (error) {
        lastError = toError(error);

        if (attempt >= 2) {
          throw lastError;
        }

        this.logger.warn("JSON fallback generation failed. Retrying request.", {
          model: this.model,
          schemaName: input.schemaName,
          attempt,
          error: lastError.message
        });
      }
    }

    throw lastError ?? new Error("Structured generation failed.");
  }

  private async invokeStructuredResponse<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
  }): Promise<z.infer<T>> {
    const structuredModel = this.client.withStructuredOutput(input.schema, {
      name: input.schemaName,
      method: "jsonSchema"
    });
    const callbacks = this.buildStreamingCallbacks(input);
    const response = await structuredModel.invoke([
      [
        "system",
        [
          input.instructions,
          "Return only data that satisfies the requested schema.",
          `Keep the response concise and fit within ${input.maxOutputTokens ?? 4_000} output tokens.`,
          `Preferred verbosity: ${input.verbosity ?? "medium"}.`
        ].join("\n\n")
      ],
      ["user", input.prompt]
    ], {
      callbacks,
      runName: input.schemaName,
      tags: ["construct", "structured-output", input.schemaName],
      metadata: {
        schemaName: input.schemaName,
        mode: "structured"
      }
    });
    this.logger.trace?.("OpenAI structured response trace.", {
      model: this.model,
      schemaName: input.schemaName,
      response
    });

    return input.schema.parse(response);
  }

  private async invokeJsonFallback<T extends z.ZodTypeAny>(input: {
    schema: T;
    schemaName: string;
    instructions: string;
    prompt: string;
    maxOutputTokens?: number;
    verbosity?: "low" | "medium" | "high";
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
  }): Promise<z.infer<T>> {
    const schemaContract = zodToJsonSchema(input.schema, input.schemaName);
    const callbacks = this.buildStreamingCallbacks(input);
    const response = await this.client.invoke([
      [
        "system",
        [
          input.instructions,
          "The structured output path failed. Recover by returning only a valid JSON object with no markdown fences or commentary.",
          "The JSON must satisfy this schema contract:",
          JSON.stringify(schemaContract, null, 2),
          `Keep the response concise and fit within ${input.maxOutputTokens ?? 4_000} output tokens.`,
          `Preferred verbosity: ${input.verbosity ?? "medium"}.`
        ].join("\n\n")
      ],
      ["user", input.prompt]
    ], {
      callbacks,
      runName: `${input.schemaName}:json-fallback`,
      tags: ["construct", "json-fallback", input.schemaName],
      metadata: {
        schemaName: input.schemaName,
        mode: "json-fallback"
      }
    });

    const text = extractModelText(response.content);
    this.logger.trace?.("OpenAI JSON fallback response trace.", {
      model: this.model,
      schemaName: input.schemaName,
      content: text
    });
    const jsonPayload = JSON.parse(extractJsonObject(text));
    return input.schema.parse(jsonPayload);
  }

  private buildStreamingCallbacks(input: {
    schemaName: string;
    stream?: {
      stage: string;
      label: string;
      onToken?: (chunk: string) => void;
      onComplete?: () => void;
    };
  }): BaseCallbackHandler[] | undefined {
    if (!input.stream?.onToken) {
      return undefined;
    }

    const handler = BaseCallbackHandler.fromMethods({
      handleLLMNewToken: (token) => {
        if (!token) {
          return;
        }

        input.stream?.onToken?.(token);
      }
    }) as BaseCallbackHandler & { lc_prefer_streaming?: boolean };

    Object.defineProperty(handler, "lc_prefer_streaming", {
      value: true,
      configurable: true
    });

    return [handler];
  }
}

class TavilySearchProvider implements SearchProvider {
  private readonly client;
  private readonly logger: AgentLogger;

  constructor(
    private readonly apiKey: string,
    private readonly depth: "basic" | "advanced" | "fast" | "ultra-fast",
    logger: AgentLogger
  ) {
    this.client = tavily({
      apiKey: this.apiKey
    });
    this.logger = logger;
  }

  async research(query: string): Promise<ResearchDigest> {
    const startedAt = Date.now();
    this.logger.info("Starting Tavily research.", {
      provider: "tavily",
      depth: this.depth,
      query
    });
    const response = await this.client.search(query, {
      searchDepth: this.depth,
      maxResults: 5,
      includeAnswer: "advanced",
      includeRawContent: false
    });

    const digest = {
      query,
      answer: response.answer,
      sources: response.results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.content,
        publishedDate: result.publishedDate
      }))
    };
    this.logger.info("Completed Tavily research.", {
      provider: "tavily",
      depth: this.depth,
      query,
      durationMs: Date.now() - startedAt,
      sourceCount: digest.sources.length,
      sources: digest.sources.map((source) => source.title)
    });
    return digest;
  }
}

function buildSearchProvider(input: {
  provider: "tavily" | "exa";
  tavilyApiKey: string;
  depth: "basic" | "advanced" | "fast" | "ultra-fast";
  logger: AgentLogger;
}): SearchProvider {
  if (input.provider === "exa") {
    throw new Error("Search provider EXA is not implemented yet. Set CONSTRUCT_SEARCH_PROVIDER=tavily.");
  }

  return new TavilySearchProvider(input.tavilyApiKey, input.depth, input.logger);
}

function resolveAgentConfig(): AgentConfig {
  const provider = (process.env.CONSTRUCT_AGENT_PROVIDER ?? "openai").trim().toLowerCase();
  const searchProvider = (process.env.CONSTRUCT_SEARCH_PROVIDER ?? "tavily")
    .trim()
    .toLowerCase();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const tavilyApiKey = process.env.TAVILY_API_KEY?.trim();

  if (provider !== "openai") {
    throw new Error(
      `Unsupported agent provider "${provider}". Construct currently supports CONSTRUCT_AGENT_PROVIDER=openai.`
    );
  }

  if (searchProvider !== "tavily" && searchProvider !== "exa") {
    throw new Error(
      `Unsupported search provider "${searchProvider}". Use CONSTRUCT_SEARCH_PROVIDER=tavily or exa.`
    );
  }

  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for the real Construct agent stack.");
  }

  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is required for Construct agent research.");
  }

  return {
    provider: "openai",
    searchProvider,
    openAiApiKey,
    openAiBaseUrl: process.env.CONSTRUCT_OPENAI_BASE_URL?.trim(),
    openAiModel: process.env.CONSTRUCT_OPENAI_MODEL?.trim() || "gpt-5.4",
    tavilyApiKey,
    tavilySearchDepth:
      (process.env.CONSTRUCT_TAVILY_SEARCH_DEPTH?.trim() as
        | "basic"
        | "advanced"
        | "fast"
        | "ultra-fast"
        | undefined) ?? "advanced"
  };
}

function createConsoleAgentLogger(): AgentLogger {
  const debugLevel = resolveDebugLevel();

  return {
    info(message, context) {
      if (debugLevel < 1) {
        return;
      }
      console.log(formatAgentLogLine("INFO", message, context));
    },
    warn(message, context) {
      console.warn(formatAgentLogLine("WARN", message, context));
    },
    error(message, context) {
      console.error(formatAgentLogLine("ERROR", message, context));
    },
    debug(message, context) {
      if (debugLevel < 2) {
        return;
      }
      console.debug(formatAgentLogLine("DEBUG", message, context));
    },
    trace(message, context) {
      if (debugLevel < 3) {
        return;
      }
      console.debug(formatAgentLogLine("TRACE", message, context));
    }
  };
}

function formatAgentLogLine(
  level: "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE",
  message: string,
  context?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();

  if (!context || Object.keys(context).length === 0) {
    return `[construct-agent] ${timestamp} ${level} ${message}`;
  }

  return `[construct-agent] ${timestamp} ${level} ${message} ${formatLogContext(context)}`;
}

function resolveDebugLevel(): 0 | 1 | 2 | 3 {
  const raw = Number.parseInt(process.env.CONSTRUCT_DEBUG_LEVEL?.trim() ?? "1", 10);

  if (!Number.isFinite(raw)) {
    return 1;
  }

  if (raw <= 0) {
    return 0;
  }

  if (raw >= 3) {
    return 3;
  }

  return raw as 1 | 2;
}

function formatLogContext(context: Record<string, unknown>): string {
  return Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${stringifyLogValue(value)}`)
    .join(" ");
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isStructuredOutputSchemaCompatibilityError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    (message.includes("optional()") && message.includes("nullable()")) ||
    message.includes("all fields must be required") ||
    message.includes("structured outputs") ||
    message.includes("json schema is invalid") ||
    message.includes("invalid schema for response_format") ||
    message.includes("missing properties")
  );
}

function isRetryableModelError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes("rate limit") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("temporarily unavailable") ||
    message.includes("internal server error") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

function extractModelText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object" && "text" in (content as Record<string, unknown>)) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  return String(content ?? "");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) {
    return trimmed.slice(jsonStart);
  }

  throw new Error("Model fallback response did not contain a JSON object.");
}

function summarizeAgentEventPayload(event: AgentEvent): Record<string, unknown> | null {
  if (!event.payload) {
    return null;
  }

  if (event.stage.startsWith("research")) {
    const payload = event.payload as {
      query?: unknown;
      sources?: Array<{ title?: string; url?: string }>;
    };

    return {
      query: typeof payload.query === "string" ? truncateText(payload.query, 180) : undefined,
      sourceCount: Array.isArray(payload.sources) ? payload.sources.length : undefined,
      sourceTitles: Array.isArray(payload.sources)
        ? payload.sources.slice(0, 5).map((source) => truncateText(String(source.title ?? ""), 80))
        : undefined
    };
  }

  if (event.stage.startsWith("blueprint")) {
    const payload = event.payload as Record<string, unknown>;

    return {
      fileCount: typeof payload.fileCount === "number" ? payload.fileCount : undefined,
      stepCount: typeof payload.stepCount === "number" ? payload.stepCount : undefined,
      architectureNodeCount:
        typeof payload.architectureNodeCount === "number"
          ? payload.architectureNodeCount
          : undefined,
      supportFileCount:
        typeof payload.supportFileCount === "number" ? payload.supportFileCount : undefined,
      canonicalFileCount:
        typeof payload.canonicalFileCount === "number" ? payload.canonicalFileCount : undefined,
      learnerFileCount:
        typeof payload.learnerFileCount === "number" ? payload.learnerFileCount : undefined,
      testCount: typeof payload.testCount === "number" ? payload.testCount : undefined,
      hiddenTestCount:
        typeof payload.hiddenTestCount === "number" ? payload.hiddenTestCount : undefined,
      packageManager:
        typeof payload.packageManager === "string" ? payload.packageManager : undefined,
      status: typeof payload.status === "string" ? payload.status : undefined,
      samplePaths: Array.isArray(payload.samplePaths)
        ? payload.samplePaths.slice(0, 4).map((entry) => truncateText(String(entry), 80))
        : undefined
    };
  }

  return {
    keys: Object.keys(event.payload)
  };
}

function summarizeJobResult(kind: AgentJobKind, result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  if (kind === "planning-questions") {
    const payload = result as {
      session?: { sessionId?: string; detectedLanguage?: string; detectedDomain?: string; questions?: unknown[] };
    };

    return {
      sessionId: payload.session?.sessionId,
      detectedLanguage: payload.session?.detectedLanguage,
      detectedDomain: payload.session?.detectedDomain,
      questionCount: Array.isArray(payload.session?.questions) ? payload.session.questions.length : undefined
    };
  }

  if (kind === "planning-plan") {
    const payload = result as {
      session?: { sessionId?: string };
      plan?: { suggestedFirstStepId?: string; steps?: unknown[]; architecture?: unknown[] };
    };

    return {
      sessionId: payload.session?.sessionId,
      suggestedFirstStepId: payload.plan?.suggestedFirstStepId,
      stepCount: Array.isArray(payload.plan?.steps) ? payload.plan.steps.length : undefined,
      architectureNodeCount: Array.isArray(payload.plan?.architecture)
        ? payload.plan.architecture.length
        : undefined
    };
  }

  if (kind === "runtime-guide") {
    const payload = result as {
      summary?: string;
      socraticQuestions?: unknown[];
      nextAction?: string;
    };

    return {
      summary: typeof payload.summary === "string" ? truncateText(payload.summary, 120) : undefined,
      socraticQuestionCount: Array.isArray(payload.socraticQuestions)
        ? payload.socraticQuestions.length
        : undefined,
      nextAction: typeof payload.nextAction === "string"
        ? truncateText(payload.nextAction, 120)
        : undefined
    };
  }

  return {
    keys: Object.keys(result)
  };
}

function summarizeStructuredOutput(schemaName: string, response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    return {
      schemaName,
      resultType: typeof response
    };
  }

  const payload = response as Record<string, unknown>;
  return {
    schemaName,
    keys: Object.keys(payload),
    summary: typeof payload.summary === "string" ? truncateText(payload.summary, 120) : undefined,
    questionCount: Array.isArray(payload.questions) ? payload.questions.length : undefined,
    stepCount: Array.isArray(payload.steps) ? payload.steps.length : undefined,
    architectureNodeCount: Array.isArray(payload.architecture) ? payload.architecture.length : undefined,
    canonicalFileCount: Array.isArray(payload.canonicalFiles) ? payload.canonicalFiles.length : undefined,
    learnerFileCount: Array.isArray(payload.learnerFiles) ? payload.learnerFiles.length : undefined,
    hiddenTestCount: Array.isArray(payload.hiddenTests) ? payload.hiddenTests.length : undefined,
    socraticQuestionCount: Array.isArray(payload.socraticQuestions)
      ? payload.socraticQuestions.length
      : undefined
  };
}

function summarizeFileBatch(files: Record<string, string>): {
  fileCount: number;
  samplePaths: string[];
} {
  return {
    fileCount: Object.keys(files).length,
    samplePaths: Object.keys(files).slice(0, 4)
  };
}

function fileEntriesToRecord(
  files: Array<z.infer<typeof GENERATED_FILE_ENTRY_SCHEMA>>
): Record<string, string> {
  const record: Record<string, string> = {};

  for (const file of files) {
    record[file.path] = file.content;
  }

  return record;
}

function compactKnowledgeBase(knowledgeBase: UserKnowledgeBase): {
  updatedAt: string;
  concepts: Array<Pick<
    StoredKnowledgeConcept,
    "id" | "label" | "category" | "confidence" | "rationale" | "updatedAt"
  >>;
  goals: Array<Pick<StoredKnowledgeGoal, "goal" | "language" | "domain" | "lastPlannedAt">>;
} {
  return {
    updatedAt: knowledgeBase.updatedAt,
    concepts: knowledgeBase.concepts
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20)
      .map((concept) => ({
        id: concept.id,
        label: concept.label,
        category: concept.category,
        confidence: concept.confidence,
        rationale: truncateText(concept.rationale, 220),
        updatedAt: concept.updatedAt
      })),
    goals: knowledgeBase.goals
      .slice()
      .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
      .slice(0, 10)
      .map((goal) => ({
        goal: truncateText(goal.goal, 180),
        language: goal.language,
        domain: goal.domain,
        lastPlannedAt: goal.lastPlannedAt
      }))
  };
}

function mergeResearchDigests(query: string, digests: Array<ResearchDigest | null>): ResearchDigest {
  const mergedSources = new Map<string, ResearchSource>();
  const answerParts: string[] = [];

  for (const digest of digests) {
    if (!digest) {
      continue;
    }

    if (digest.answer) {
      answerParts.push(digest.answer.trim());
    }

    for (const source of digest.sources) {
      const key = source.url || `${source.title}:${source.snippet}`;
      if (!mergedSources.has(key)) {
        mergedSources.set(key, source);
      }
    }
  }

  return {
    query,
    answer: answerParts.length > 0 ? answerParts.join("\n\n") : undefined,
    sources: Array.from(mergedSources.values())
  };
}

function createProjectInstaller(logger: AgentLogger): ProjectInstaller {
  return {
    async install(projectRoot, files) {
      if (files["package.json"]) {
        return runProjectInstallCommand({
          command: "pnpm",
          args: ["install", "--ignore-workspace", "--frozen-lockfile=false"],
          projectRoot,
          manifestPath: "package.json",
          packageManager: "pnpm",
          logger
        });
      }

      if (files["Cargo.toml"]) {
        return runProjectInstallCommand({
          command: "cargo",
          args: ["fetch"],
          projectRoot,
          manifestPath: "Cargo.toml",
          packageManager: "cargo",
          logger
        });
      }

      return {
        status: "skipped",
        packageManager: "none",
        detail: "No supported dependency manifest was generated."
      };
    }
  };
}

async function runProjectInstallCommand(input: {
  command: string;
  args: string[];
  projectRoot: string;
  manifestPath: string;
  packageManager: string;
  logger: AgentLogger;
}): Promise<DependencyInstallResult> {
  const { command, args, projectRoot, manifestPath, packageManager, logger } = input;

  logger.info("Starting generated project dependency install.", {
    projectRoot,
    packageManager,
    manifestPath
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
      });
    });

    logger.info("Completed generated project dependency install.", {
      projectRoot,
      packageManager,
      manifestPath
    });

    return {
      status: "installed",
      packageManager,
      manifestPath
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dependency install error.";
    logger.warn("Generated project dependency install failed.", {
      projectRoot,
      packageManager,
      manifestPath,
      detail: truncateText(message, 240)
    });

    return {
      status: "failed",
      packageManager,
      manifestPath,
      detail: truncateText(message, 240)
    };
  }
}

function compactResearchDigest(
  research: ResearchDigest | null
): {
  query: string;
  answer?: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
  }>;
} | null {
  if (!research) {
    return null;
  }

  return {
    query: truncateText(research.query, 220),
    answer: research.answer ? truncateText(research.answer, 800) : undefined,
    sources: research.sources.slice(0, 5).map((source) => ({
      title: truncateText(source.title, 140),
      url: source.url,
      snippet: truncateText(source.snippet, 320),
      publishedDate: source.publishedDate
    }))
  };
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function emptyKnowledgeBase(now: () => Date): UserKnowledgeBase {
  return UserKnowledgeBaseSchema.parse({
    updatedAt: now().toISOString(),
    concepts: [],
    goals: []
  });
}

function normalizeGeneratedBlueprintSteps(
  steps: Array<z.infer<typeof GENERATED_BLUEPRINT_STEP_DRAFT_SCHEMA>>
): ProjectBlueprint["steps"] {
  return steps.map((step) =>
    BlueprintStepSchema.parse({
      ...step,
      anchor: {
        file: step.anchor.file,
        marker: step.anchor.marker,
        ...(step.anchor.startLine === null ? {} : { startLine: step.anchor.startLine }),
        ...(step.anchor.endLine === null ? {} : { endLine: step.anchor.endLine })
      },
      checks: step.checks.map((check) => {
        if (check.type === "mcq") {
          return {
            id: check.id,
            type: check.type,
            prompt: check.prompt,
            answer: check.answer,
            options: check.options.map((option) => ({
              id: option.id,
              label: option.label,
              ...(option.rationale === null ? {} : { rationale: option.rationale })
            }))
          };
        }

        const { placeholder: _placeholder, ...rest } = check;
        return {
          ...rest,
          ...(check.placeholder === null ? {} : { placeholder: check.placeholder })
        };
      })
    })
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferGoalScopeFallback(goal: string): GoalScope {
  const normalized = goal.trim().toLowerCase();
  const smallScopeHints = [
    "small",
    "simple",
    "tiny",
    "basic",
    "minimal",
    "class",
    "single class",
    "single file",
    "module",
    "function"
  ];
  const complexScopeHints = [
    "compiler",
    "database",
    "distributed",
    "multi-agent",
    "ide",
    "operating system",
    "interpreter",
    "framework",
    "backend",
    "frontend",
    "full stack",
    "web app",
    "desktop app"
  ];

  const mentionsSmallScope = smallScopeHints.some((hint) => normalized.includes(hint));
  const mentionsComplexScope = complexScopeHints.some((hint) => normalized.includes(hint));
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (mentionsSmallScope && !mentionsComplexScope && wordCount <= 8) {
    return {
      scopeSummary: "Very small local artifact",
      artifactShape: normalized.includes("class") ? "class" : "module",
      complexityScore: 12,
      shouldResearch: false,
      recommendedQuestionCount: 2,
      recommendedMinSteps: 1,
      recommendedMaxSteps: 2,
      rationale: "The fallback scope check detected an explicitly small local request, so broad research should be skipped."
    };
  }

  if (mentionsComplexScope || wordCount >= 10) {
    return {
      scopeSummary: "Large multi-part project",
      artifactShape: "system",
      complexityScore: 82,
      shouldResearch: true,
      recommendedQuestionCount: 6,
      recommendedMinSteps: 5,
      recommendedMaxSteps: 10,
      rationale: "The fallback scope check detected a larger systems-style request, so full research is warranted."
    };
  }

  return {
    scopeSummary: "Normal project-sized request",
    artifactShape: normalized.includes("class") ? "class" : "app",
    complexityScore: 45,
    shouldResearch: true,
    recommendedQuestionCount: 4,
    recommendedMinSteps: 3,
    recommendedMaxSteps: 6,
    rationale: "The fallback scope check treated this as a normal project-sized request."
  };
}

function buildGoalScopeInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Decide how large the requested project should be before planning or research begins.",
    "Do not force the request into canned scope labels. Describe the scope in your own words using scopeSummary and artifactShape.",
    "artifactShape should be your own concise description of the primary artifact to build, such as 'todo class', 'single module', 'cli app', or 'compiler pipeline'.",
    "complexityScore is a 0-100 estimate of how large and multi-part the project really is.",
    "shouldResearch should be false only when broad web research would clearly be wasteful for this specific request.",
    "recommendedQuestionCount should be the minimum number of intake questions needed to personalize the path.",
    "recommendedMinSteps and recommendedMaxSteps should define the step budget the Architect should aim for.",
    "Be conservative with scope expansion. If the user asks for something small, keep it small unless the request itself requires more."
  ].join("\n");
}

function buildQuestionGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Your job is to prepare the intake phase for a serious local AI developer IDE.",
    "Given a project goal, prior stored learner knowledge, and optional lightweight web research, generate concept-level knowledge questions.",
    "Ask only the minimum questions needed to personalize the build path.",
    "Questions must be exact and technical, not generic confidence surveys.",
    "For every question, generate exactly 3 answer options. Options should be specific to the question, not generic repeated wording.",
    "Each option must include a confidenceSignal of comfortable, shaky, or new so Construct can normalize the answer without losing the richer user-facing wording.",
    "Do not generate a custom-answer option in the schema. The UI always provides a fourth freeform answer path separately.",
    "Detected language and domain must match the target project.",
    "Favor prerequisite concepts that affect implementation order.",
    "Use goalScope.recommendedQuestionCount as the target number of questions.",
    "Use goalScope.scopeSummary and goalScope.artifactShape to decide how local or broad the intake should be.",
    "Do not ask about concepts that are already clearly comfortable in the prior knowledge base unless the new goal materially changes their meaning."
  ].join("\n");
}

function buildPlanGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Generate a detailed personalized project roadmap for a serious learning-first IDE.",
    "The learner will build the real project in-place, so every step must contribute to the final system.",
    "Use the learner's answers and prior knowledge to change step order, not just explanations.",
    "The answers payload includes the original question, the available options, and either a selected option or a custom freeform learner response. Use that full context rather than treating answers as generic scores.",
    "Architecture components must reflect true dependency order.",
    "Each step must include concrete validation focus, implementation notes, quiz focus, and hidden validation focus.",
    "Prefer steps that unlock later modules and make the dependency chain explicit.",
    "If the learner is weak in a prerequisite concept, insert a skill step immediately before the implementation step that needs it.",
    "Keep the total number of steps within goalScope.recommendedMinSteps and goalScope.recommendedMaxSteps.",
    "Use goalScope.scopeSummary and goalScope.artifactShape to decide how narrow or broad the plan should be.",
    "Do not produce toy exercises disconnected from the project.",
    "Suggested first step must reference one of the generated steps."
  ].join("\n");
}

function buildBlueprintGenerationInstructions(): string {
  return [
    "You are Construct's Architect agent.",
    "Generate a real project blueprint for the learner to implement in-place.",
    "Return a runnable canonical project split into supportFiles, canonicalFiles, learnerFiles, and hiddenTests.",
    "Each of those file groups must be an array of objects shaped exactly like { path, content }.",
    "supportFiles are unmasked project files such as package.json, pyproject.toml, tsconfig, helper modules, and fixed runtime scaffolding.",
    "canonicalFiles are the solved versions of the learner-owned implementation files.",
    "learnerFiles must correspond to the same file paths as canonicalFiles, but with focused TASK markers and incomplete implementations the learner must fill in.",
    "hiddenTests must validate the learner tasks and stay runnable without exposing full solutions in the learnerFiles.",
    "The answers payload includes the original question, the available options, and either a selected option or a custom freeform learner response. Use that context to tune scope, docs, checks, and task ordering.",
    "Every step must point to a real learnerFile anchor and include doc text, comprehension checks, constraints, and targeted tests.",
    "Keep the implementation inside the step budget defined by goalScope.recommendedMinSteps and goalScope.recommendedMaxSteps.",
    "Use goalScope.scopeSummary and goalScope.artifactShape to decide how small or broad the generated project should be.",
    "Choose build order from true project dependencies and the learner profile, not a generic tutorial order.",
    "For TypeScript and JavaScript projects, generate Jest tests and the minimum package/tooling files required to run them.",
    "Do not emit placeholder prose instead of code. Return concrete file contents."
  ].join("\n");
}

function buildRuntimeGuideInstructions(): string {
  return [
    "You are Construct's runtime Guide agent, a calm senior engineer helping the learner implement real project code.",
    "Use Socratic guidance first.",
    "Never give a full runnable solution.",
    "Return exactly 1 to 3 Socratic questions.",
    "Hints must escalate from a light nudge to pseudocode to a concrete scaffold description without fully solving the task.",
    "Observations should reference the test result, constraints, or code snippet when possible.",
    "Next action must be a single practical move the learner can take immediately."
  ].join("\n");
}
