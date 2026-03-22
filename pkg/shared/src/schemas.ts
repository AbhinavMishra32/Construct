import { z } from "zod";

export const APP_NAME = "Construct";

export const AnchorSchema = z.object({
  file: z.string().min(1),
  marker: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
});

export const WorkspaceFileEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative()
});

export const CheckOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1).optional()
});

export const ComprehensionCheckSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("mcq"),
    prompt: z.string().min(1),
    options: z.array(CheckOptionSchema).min(2),
    answer: z.string().min(1)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("short-answer"),
    prompt: z.string().min(1),
    rubric: z.array(z.string().min(1)).min(1),
    placeholder: z.string().min(1).optional()
  })
]);

export const LessonSlideBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markdown"),
    markdown: z.string().min(1)
  }),
  z.object({
    type: z.literal("check"),
    placement: z.enum(["inline", "end"]).default("inline"),
    check: ComprehensionCheckSchema
  })
]);

export const LessonSlideSchema = z.object({
  blocks: z.array(LessonSlideBlockSchema).min(1)
});

const LegacyLessonSlideSchema = z.string().min(1).transform((markdown) =>
  LessonSlideSchema.parse({
    blocks: [
      {
        type: "markdown",
        markdown
      }
    ]
  })
);

export const CheckReviewStatusSchema = z.enum([
  "complete",
  "needs-revision",
  "skipped"
]);

export const CheckReviewSchema = z.object({
  status: CheckReviewStatusSchema,
  message: z.string().min(1),
  coveredCriteria: z.array(z.string().min(1)).default([]),
  missingCriteria: z.array(z.string().min(1)).default([])
});

export const CheckReviewRequestSchema = z.object({
  stepId: z.string().min(1),
  stepTitle: z.string().min(1),
  stepSummary: z.string().min(1),
  concepts: z.array(z.string().min(1)).default([]),
  check: ComprehensionCheckSchema,
  response: z.string().min(1),
  attemptCount: z.number().int().nonnegative().default(0)
});

export const CheckReviewResponseSchema = z.object({
  review: CheckReviewSchema
});

export const ProjectPreviewKindSchema = z.enum([
  "cli",
  "api",
  "ui",
  "trace",
  "graph",
  "state"
]);

export const ProjectPreviewSchema = z.object({
  kind: ProjectPreviewKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  command: z.string().min(1).nullable().default(null),
  entrypoint: z.string().min(1).nullable().default(null),
  sampleOutput: z.string().min(1).nullable().default(null)
});

export const MaskedRegionSchema = z.object({
  anchor: AnchorSchema,
  strategy: z.enum(["todo-stub", "placeholder-return", "hidden-region"]),
  intent: z.string().min(1),
  learnerVisible: z.boolean().default(true)
});

export const StableCapabilitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([]),
  concepts: z.array(z.string().min(1)).default([]),
  visibleOutcome: z.string().min(1)
});

export const StableMilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  visibleOutcome: z.string().min(1),
  capabilityIds: z.array(z.string().min(1)).min(1),
  preview: ProjectPreviewSchema.nullable().default(null)
});

export const StableCommitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  commitMessage: z.string().min(1),
  capabilityIds: z.array(z.string().min(1)).default([]),
  milestoneId: z.string().min(1).nullable().default(null),
  dependsOn: z.array(z.string().min(1)).default([]),
  visibleFiles: z.array(z.string().min(1)).default([]),
  maskedRegions: z.array(MaskedRegionSchema).default([]),
  visibleOutcome: z.string().min(1),
  runnable: z.boolean().default(true),
  preview: ProjectPreviewSchema.nullable().default(null)
});

export const RecommendedBuildRouteSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  commitIds: z.array(z.string().min(1)).min(1),
  capabilityIds: z.array(z.string().min(1)).default([]),
  personalizedFor: z.array(z.string().min(1)).default([])
});

export const ProjectSpineSchema = z.object({
  finalEntrypoints: z.array(z.string().min(1)).min(1),
  capabilities: z.array(StableCapabilitySchema).min(1),
  milestones: z.array(StableMilestoneSchema).min(1),
  commitGraph: z.array(StableCommitSchema).min(1),
  routes: z.array(RecommendedBuildRouteSchema).min(1),
  activeRouteId: z.string().min(1).nullable().default(null),
  activeCommitId: z.string().min(1).nullable().default(null),
  alwaysVisibleFiles: z.array(z.string().min(1)).default([])
});

export const DiagnosticSignalSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "check-answer",
    "submission-result",
    "repeat-failure",
    "hint-usage",
    "runtime-question",
    "inactivity",
    "rewrite-gate",
    "debug-trace"
  ]),
  summary: z.string().min(1),
  evidence: z.string().min(1),
  conceptIds: z.array(z.string().min(1)).default([]),
  recordedAt: z.string().datetime()
});

export const MentorInterventionSchema = z.object({
  kind: z.enum([
    "continue-to-code",
    "deepen-explanation",
    "targeted-check",
    "diagnostic-question",
    "micro-practice",
    "split-step",
    "insert-prerequisite",
    "mutate-frontier",
    "return-to-code"
  ]),
  summary: z.string().min(1),
  reason: z.string().min(1)
});

export const BlueprintStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  doc: z.string().min(1),
  capabilityId: z.string().min(1).nullable().default(null),
  milestoneId: z.string().min(1).nullable().default(null),
  commitId: z.string().min(1).nullable().default(null),
  lessonSlides: z
    .array(z.union([LessonSlideSchema, LegacyLessonSlideSchema]))
    .default([]),
  explanationSlides: z
    .array(z.union([LessonSlideSchema, LegacyLessonSlideSchema]))
    .default([]),
  anchor: AnchorSchema,
  tests: z.array(z.string().min(1)).min(1),
  concepts: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)).default([]),
  checks: z.array(ComprehensionCheckSchema).default([]),
  visibleFiles: z.array(z.string().min(1)).default([]),
  maskedRegions: z.array(MaskedRegionSchema).default([]),
  preview: ProjectPreviewSchema.nullable().default(null),
  estimatedMinutes: z.number().int().positive(),
  difficulty: z.enum(["intro", "core", "advanced"])
});

export const DependencyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["component", "skill"])
});

export const DependencyEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.string().min(1)
});

export const DependencyGraphSchema = z.object({
  nodes: z.array(DependencyNodeSchema),
  edges: z.array(DependencyEdgeSchema)
});

export const AdaptiveFrontierSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: z.string().min(1),
  activeStepId: z.string().min(1).nullable().default(null),
  activeCommitId: z.string().min(1).nullable().default(null),
  stepIds: z.array(z.string().min(1)).min(1).max(3),
  steps: z.array(BlueprintStepSchema).min(1).max(3),
  diagnostics: z.array(DiagnosticSignalSchema).default([]),
  intervention: MentorInterventionSchema.nullable().default(null),
  updating: z.boolean().default(false)
});

const ProjectBlueprintBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  projectRoot: z.string().min(1),
  sourceProjectRoot: z.string().min(1),
  language: z.string().min(1),
  entrypoints: z.array(z.string().min(1)).min(1),
  files: z.record(z.string().min(1)),
  steps: z.array(BlueprintStepSchema).min(1),
  spine: ProjectSpineSchema.nullable().default(null),
  frontier: AdaptiveFrontierSchema.nullable().default(null),
  dependencyGraph: DependencyGraphSchema,
  metadata: z.object({
    createdBy: z.string().min(1),
    createdAt: z.string().datetime(),
    targetLanguage: z.string().min(1),
    tags: z.array(z.string().min(1)).default([])
  })
});

export const ProjectBlueprintSchema = ProjectBlueprintBaseSchema.transform((blueprint) => {
  const explanationNormalizedSteps = blueprint.steps.map((step) => {
    const explanationSlides =
      step.explanationSlides.length > 0 ? step.explanationSlides : step.lessonSlides;
    const lessonSlides =
      step.lessonSlides.length > 0 ? step.lessonSlides : step.explanationSlides;

    return {
      ...step,
      lessonSlides,
      explanationSlides
    };
  });

  const normalizedFrontier =
    blueprint.frontier === null
      ? null
      : {
          ...blueprint.frontier,
          steps: blueprint.frontier.steps.map((step) => {
            const explanationSlides =
              step.explanationSlides.length > 0 ? step.explanationSlides : step.lessonSlides;
            const lessonSlides =
              step.lessonSlides.length > 0 ? step.lessonSlides : step.explanationSlides;

            return {
              ...step,
              lessonSlides,
              explanationSlides
            };
          })
        };

  return {
    ...blueprint,
    steps: explanationNormalizedSteps,
    frontier: normalizedFrontier
  };
});

export const ProjectStatusSchema = z.enum([
  "draft",
  "in-progress",
  "completed",
  "archived"
]);

export const ProjectAttemptStatusSchema = z.enum([
  "failed",
  "passed",
  "needs-review"
]);

export const ProjectSummarySchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  language: z.string().min(1),
  blueprintPath: z.string().min(1),
  projectRoot: z.string().min(1),
  currentStepId: z.string().min(1).nullable().default(null),
  currentStepTitle: z.string().min(1).nullable().default(null),
  currentStepIndex: z.number().int().nonnegative().nullable().default(null),
  totalSteps: z.number().int().nonnegative().default(0),
  completedStepsCount: z.number().int().nonnegative().default(0),
  status: ProjectStatusSchema,
  lastAttemptStatus: ProjectAttemptStatusSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime().nullable().default(null),
  isActive: z.boolean().default(false)
});

export const ProjectsDashboardResponseSchema = z.object({
  userId: z.string().min(1),
  activeProjectId: z.string().min(1).nullable().default(null),
  projects: z.array(ProjectSummarySchema).default([])
});

export const ProjectSelectionRequestSchema = z.object({
  projectId: z.string().min(1)
});

export const ProjectSelectionResponseSchema = z.object({
  activeProjectId: z.string().min(1).nullable().default(null),
  project: ProjectSummarySchema.nullable().default(null)
});

export const ProjectCurrentStepRequestSchema = z.object({
  stepId: z.string().min(1)
});

export const TaskFailureSchema = z.object({
  testName: z.string().min(1),
  message: z.string().min(1),
  stackTrace: z.string().min(1).optional()
});

export const TestAdapterSchema = z.enum(["jest", "cargo", "pytest"]);

export const TaskExecutionRequestSchema = z.object({
  stepId: z.string().min(1),
  projectRoot: z.string().min(1),
  tests: z.array(z.string().min(1)).min(1),
  adapter: TestAdapterSchema.default("jest"),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000)
});

export const BlueprintTaskRequestSchema = z.object({
  blueprintPath: z.string().min(1),
  stepId: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000)
});

export const TaskResultSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["passed", "failed"]),
  adapter: TestAdapterSchema,
  durationMs: z.number().int().nonnegative(),
  testsRun: z.array(z.string().min(1)).min(1),
  failures: z.array(TaskFailureSchema).default([]),
  exitCode: z.number().int().nullable().default(null),
  timedOut: z.boolean().default(false),
  stdout: z.string().default(""),
  stderr: z.string().default("")
});

export const TaskTelemetrySchema = z.object({
  hintsUsed: z.number().int().nonnegative().default(0),
  pasteRatio: z.number().min(0).max(1).default(0),
  typedChars: z.number().int().nonnegative().default(0),
  pastedChars: z.number().int().nonnegative().default(0)
});

export const LearnerHistoryEntrySchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["started", "failed", "passed", "needs-review"]),
  attempt: z.number().int().positive(),
  timeSpentMs: z.number().int().nonnegative(),
  hintsUsed: z.number().int().nonnegative(),
  pasteRatio: z.number().min(0).max(1),
  recordedAt: z.string().datetime()
});

export const LearnerModelSchema = z.object({
  skills: z.record(z.number().min(0).max(1)),
  history: z.array(LearnerHistoryEntrySchema),
  hintsUsed: z.record(z.number().int().nonnegative()),
  reflections: z.record(z.string())
});

export const SnapshotSchema = z.object({
  commitId: z.string().min(1),
  timestamp: z.string().datetime(),
  message: z.string().min(1),
  fileDiffs: z.array(z.string().min(1)).default([])
});

export const RewriteGateSchema = z.object({
  reason: z.string().min(1),
  guidance: z.string().min(1),
  activatedAt: z.string().datetime(),
  pasteRatio: z.number().min(0).max(1),
  pasteRatioThreshold: z.number().min(0).max(1),
  pastedChars: z.number().int().nonnegative(),
  requiredTypedChars: z.number().int().positive(),
  maxPastedChars: z.number().int().nonnegative(),
  requiredPasteRatio: z.number().min(0).max(1)
});

export const TaskSessionStatusSchema = z.enum(["active", "passed"]);

export const TaskSessionSchema = z.object({
  sessionId: z.string().min(1),
  stepId: z.string().min(1),
  blueprintPath: z.string().min(1),
  status: TaskSessionStatusSchema,
  startedAt: z.string().datetime(),
  latestAttempt: z.number().int().nonnegative().default(0),
  preTaskSnapshot: SnapshotSchema,
  rewriteGate: RewriteGateSchema.nullable().default(null)
});

export const TaskAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  sessionId: z.string().min(1),
  stepId: z.string().min(1),
  status: z.enum(["failed", "passed", "needs-review"]),
  recordedAt: z.string().datetime(),
  timeSpentMs: z.number().int().nonnegative(),
  telemetry: TaskTelemetrySchema,
  result: TaskResultSchema,
  postTaskSnapshot: SnapshotSchema.optional()
});

export const TaskProgressSchema = z.object({
  stepId: z.string().min(1),
  totalAttempts: z.number().int().nonnegative(),
  activeSession: TaskSessionSchema.nullable(),
  latestAttempt: TaskAttemptSchema.nullable()
});

export const TaskStartRequestSchema = z.object({
  blueprintPath: z.string().min(1),
  stepId: z.string().min(1)
});

export const TaskStartResponseSchema = z.object({
  session: TaskSessionSchema,
  progress: TaskProgressSchema,
  learnerModel: LearnerModelSchema
});

export const TaskSubmitRequestSchema = z.object({
  blueprintPath: z.string().min(1),
  stepId: z.string().min(1),
  sessionId: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  telemetry: TaskTelemetrySchema.default({
    hintsUsed: 0,
    pasteRatio: 0,
    typedChars: 0,
    pastedChars: 0
  })
});

export const TaskSubmitResponseSchema = z.object({
  session: TaskSessionSchema,
  attempt: TaskAttemptSchema,
  progress: TaskProgressSchema,
  learnerModel: LearnerModelSchema
});

export const PlanMutationSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  insertedAfterStepId: z.string().min(1),
  insertedStepIds: z.array(z.string().min(1)).min(1),
  recordedAt: z.string().datetime()
});

export function getBlueprintRuntimeSteps(
  blueprint: Pick<ProjectBlueprint, "steps" | "frontier">
): BlueprintStep[] {
  if (blueprint.frontier?.steps.length) {
    return blueprint.frontier.steps;
  }

  return blueprint.steps;
}

export function getBlueprintStepDeck(step: Pick<BlueprintStep, "explanationSlides" | "lessonSlides">): Array<
  z.infer<typeof LessonSlideSchema> | string
> {
  return step.explanationSlides.length > 0 ? step.explanationSlides : step.lessonSlides;
}

export function getBlueprintVisibleFilePaths(
  blueprint: Pick<ProjectBlueprint, "entrypoints" | "files" | "steps" | "frontier" | "spine">
): string[] {
  const visiblePaths = new Set<string>();

  for (const entrypoint of blueprint.entrypoints) {
    visiblePaths.add(normalizeBlueprintPath(entrypoint));
  }

  for (const relativePath of blueprint.spine?.alwaysVisibleFiles ?? []) {
    visiblePaths.add(normalizeBlueprintPath(relativePath));
  }

  const activeCommitId = blueprint.frontier?.activeCommitId ?? blueprint.spine?.activeCommitId;
  const activeCommit = activeCommitId
    ? blueprint.spine?.commitGraph.find((commit) => commit.id === activeCommitId) ?? null
    : null;

  for (const relativePath of activeCommit?.visibleFiles ?? []) {
    visiblePaths.add(normalizeBlueprintPath(relativePath));
  }

  for (const step of getBlueprintRuntimeSteps(blueprint)) {
    visiblePaths.add(normalizeBlueprintPath(step.anchor.file));

    for (const relativePath of step.visibleFiles) {
      visiblePaths.add(normalizeBlueprintPath(relativePath));
    }
  }

  if (visiblePaths.size === 0) {
    for (const relativePath of Object.keys(blueprint.files)) {
      visiblePaths.add(normalizeBlueprintPath(relativePath));
    }
  }

  return Array.from(visiblePaths).filter(Boolean).sort();
}

export type AnchorRef = z.infer<typeof AnchorSchema>;
export type WorkspaceFileEntry = z.infer<typeof WorkspaceFileEntrySchema>;
export type ComprehensionCheck = z.infer<typeof ComprehensionCheckSchema>;
export type LessonSlideBlock = z.infer<typeof LessonSlideBlockSchema>;
export type LessonSlide = z.infer<typeof LessonSlideSchema>;
export type CheckReview = z.infer<typeof CheckReviewSchema>;
export type CheckReviewRequest = z.infer<typeof CheckReviewRequestSchema>;
export type CheckReviewResponse = z.infer<typeof CheckReviewResponseSchema>;
export type ProjectPreviewKind = z.infer<typeof ProjectPreviewKindSchema>;
export type ProjectPreview = z.infer<typeof ProjectPreviewSchema>;
export type MaskedRegion = z.infer<typeof MaskedRegionSchema>;
export type StableCapability = z.infer<typeof StableCapabilitySchema>;
export type StableMilestone = z.infer<typeof StableMilestoneSchema>;
export type StableCommit = z.infer<typeof StableCommitSchema>;
export type RecommendedBuildRoute = z.infer<typeof RecommendedBuildRouteSchema>;
export type ProjectSpine = z.infer<typeof ProjectSpineSchema>;
export type DiagnosticSignal = z.infer<typeof DiagnosticSignalSchema>;
export type MentorIntervention = z.infer<typeof MentorInterventionSchema>;
export type BlueprintStep = z.infer<typeof BlueprintStepSchema>;
export type AdaptiveFrontier = z.infer<typeof AdaptiveFrontierSchema>;
export type ProjectBlueprint = z.infer<typeof ProjectBlueprintSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectAttemptStatus = z.infer<typeof ProjectAttemptStatusSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectsDashboardResponse = z.infer<typeof ProjectsDashboardResponseSchema>;
export type ProjectSelectionRequest = z.infer<typeof ProjectSelectionRequestSchema>;
export type ProjectSelectionResponse = z.infer<typeof ProjectSelectionResponseSchema>;
export type ProjectCurrentStepRequest = z.infer<typeof ProjectCurrentStepRequestSchema>;
export type TestAdapterKind = z.infer<typeof TestAdapterSchema>;
export type TaskExecutionRequest = z.infer<typeof TaskExecutionRequestSchema>;
export type BlueprintTaskRequest = z.infer<typeof BlueprintTaskRequestSchema>;
export type TaskFailure = z.infer<typeof TaskFailureSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type TaskTelemetry = z.infer<typeof TaskTelemetrySchema>;
export type LearnerHistoryEntry = z.infer<typeof LearnerHistoryEntrySchema>;
export type LearnerModel = z.infer<typeof LearnerModelSchema>;
export type SnapshotRecord = z.infer<typeof SnapshotSchema>;
export type RewriteGate = z.infer<typeof RewriteGateSchema>;
export type TaskSession = z.infer<typeof TaskSessionSchema>;
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;
export type TaskStartRequest = z.infer<typeof TaskStartRequestSchema>;
export type TaskStartResponse = z.infer<typeof TaskStartResponseSchema>;
export type TaskSubmitRequest = z.infer<typeof TaskSubmitRequestSchema>;
export type TaskSubmitResponse = z.infer<typeof TaskSubmitResponseSchema>;
export type PlanMutation = z.infer<typeof PlanMutationSchema>;

function normalizeBlueprintPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}
