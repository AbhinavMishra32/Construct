import { z } from "zod";

export const APP_NAME = "Construct";

export const AnchorSchema = z.object({
  file: z.string().min(1),
  marker: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
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

export const BlueprintStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  doc: z.string().min(1),
  anchor: AnchorSchema,
  tests: z.array(z.string().min(1)).min(1),
  concepts: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)).default([]),
  checks: z.array(ComprehensionCheckSchema).default([]),
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

export const ProjectBlueprintSchema = z.object({
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
  dependencyGraph: DependencyGraphSchema,
  metadata: z.object({
    createdBy: z.string().min(1),
    createdAt: z.string().datetime(),
    targetLanguage: z.string().min(1),
    tags: z.array(z.string().min(1)).default([])
  })
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
  timeoutMs: z.number().int().positive().max(120_000).default(15_000)
});

export const BlueprintTaskRequestSchema = z.object({
  blueprintPath: z.string().min(1),
  stepId: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).default(15_000)
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

export const PlanMutationSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  insertedAfterStepId: z.string().min(1),
  insertedStepIds: z.array(z.string().min(1)).min(1),
  recordedAt: z.string().datetime()
});

export type AnchorRef = z.infer<typeof AnchorSchema>;
export type ComprehensionCheck = z.infer<typeof ComprehensionCheckSchema>;
export type BlueprintStep = z.infer<typeof BlueprintStepSchema>;
export type ProjectBlueprint = z.infer<typeof ProjectBlueprintSchema>;
export type TestAdapterKind = z.infer<typeof TestAdapterSchema>;
export type TaskExecutionRequest = z.infer<typeof TaskExecutionRequestSchema>;
export type BlueprintTaskRequest = z.infer<typeof BlueprintTaskRequestSchema>;
export type TaskFailure = z.infer<typeof TaskFailureSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type LearnerModel = z.infer<typeof LearnerModelSchema>;
export type SnapshotRecord = z.infer<typeof SnapshotSchema>;
export type PlanMutation = z.infer<typeof PlanMutationSchema>;
