import { z } from "zod";

import { BlueprintStepSchema, LearnerModelSchema, TaskResultSchema } from "./schemas";

export const LearningStyleSchema = z.enum([
  "concept-first",
  "build-first",
  "example-first"
]);

export const ConceptConfidenceSchema = z.enum(["comfortable", "shaky", "new"]);

export const PlanningQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  confidenceSignal: ConceptConfidenceSchema
});

export const PlanningQuestionSchema = z.object({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  category: z.enum(["language", "domain", "workflow"]),
  prompt: z.string().min(1),
  options: z.array(PlanningQuestionOptionSchema).length(3)
});

export const PlanningSessionStartRequestSchema = z.object({
  goal: z.string().min(3),
  learningStyle: LearningStyleSchema.default("concept-first")
});

export const PlanningSessionSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(3),
  normalizedGoal: z.string().min(3),
  learningStyle: LearningStyleSchema,
  detectedLanguage: z.string().min(1),
  detectedDomain: z.string().min(1),
  createdAt: z.string().datetime(),
  questions: z.array(PlanningQuestionSchema)
});

export const PlanningAnswerSchema = z.discriminatedUnion("answerType", [
  z.object({
    questionId: z.string().min(1),
    answerType: z.literal("option"),
    optionId: z.string().min(1)
  }),
  z.object({
    questionId: z.string().min(1),
    answerType: z.literal("custom"),
    customResponse: z.string().trim().min(1).max(2_000)
  })
]);

export const ConceptNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["language", "domain", "workflow"]),
  confidence: ConceptConfidenceSchema,
  rationale: z.string().min(1)
});

export const KnowledgeGraphSchema = z.object({
  concepts: z.array(ConceptNodeSchema).min(1),
  strengths: z.array(z.string().min(1)),
  gaps: z.array(z.string().min(1))
});

export const ArchitectureComponentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["component", "skill"]),
  summary: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([])
});

export const GeneratedPlanStepSchema = z.object({
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
});

export const GeneratedProjectPlanSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(3),
  language: z.string().min(1),
  domain: z.string().min(1),
  learningStyle: LearningStyleSchema,
  summary: z.string().min(1),
  architecture: z.array(ArchitectureComponentSchema).min(1),
  knowledgeGraph: KnowledgeGraphSchema,
  steps: z.array(GeneratedPlanStepSchema).min(1),
  suggestedFirstStepId: z.string().min(1)
});

export const PlanningSessionStartResponseSchema = z.object({
  session: PlanningSessionSchema
});

export const PlanningSessionCompleteRequestSchema = z.object({
  sessionId: z.string().min(1),
  answers: z.array(PlanningAnswerSchema).min(1)
});

export const PlanningSessionCompleteResponseSchema = z.object({
  session: PlanningSessionSchema,
  plan: GeneratedProjectPlanSchema
});

export const CurrentPlanningSessionResponseSchema = z.object({
  session: PlanningSessionSchema.nullable(),
  plan: GeneratedProjectPlanSchema.nullable()
});

export const StoredKnowledgeConceptSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["language", "domain", "workflow"]),
  confidence: ConceptConfidenceSchema,
  rationale: z.string().min(1),
  source: z.enum(["self-report", "agent-inferred", "task-performance"]),
  updatedAt: z.string().datetime()
});

export const StoredKnowledgeGoalSchema = z.object({
  goal: z.string().min(3),
  language: z.string().min(1),
  domain: z.string().min(1),
  lastPlannedAt: z.string().datetime()
});

export const UserKnowledgeBaseSchema = z.object({
  updatedAt: z.string().datetime(),
  concepts: z.array(StoredKnowledgeConceptSchema).default([]),
  goals: z.array(StoredKnowledgeGoalSchema).default([])
});

export const LearnerProfileResponseSchema = z.object({
  userId: z.string().min(1),
  knowledgeBase: UserKnowledgeBaseSchema,
  learnerModel: LearnerModelSchema.nullable().default(null)
});

export const AgentJobKindSchema = z.enum([
  "planning-questions",
  "planning-plan",
  "runtime-guide",
  "blueprint-deep-dive"
]);

export const AgentJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed"
]);

export const AgentEventLevelSchema = z.enum(["info", "success", "warning", "error"]);

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  kind: AgentJobKindSchema,
  stage: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1).optional(),
  level: AgentEventLevelSchema.default("info"),
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).optional()
});

export const AgentJobCreatedResponseSchema = z.object({
  jobId: z.string().min(1),
  kind: AgentJobKindSchema,
  status: AgentJobStatusSchema,
  streamPath: z.string().min(1),
  resultPath: z.string().min(1)
});

export const AgentJobSnapshotSchema = z.object({
  jobId: z.string().min(1),
  kind: AgentJobKindSchema,
  status: AgentJobStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().optional(),
  result: z.unknown().nullable().default(null)
});

export const RuntimeGuideRequestSchema = z.object({
  stepId: z.string().min(1),
  stepTitle: z.string().min(1),
  stepSummary: z.string().min(1),
  filePath: z.string().min(1),
  anchorMarker: z.string().min(1),
  codeSnippet: z.string().min(1).max(20_000),
  constraints: z.array(z.string().min(1)).default([]),
  tests: z.array(z.string().min(1)).default([]),
  taskResult: TaskResultSchema.nullable().default(null),
  learnerModel: LearnerModelSchema.nullable().default(null)
});

export const RuntimeGuideResponseSchema = z.object({
  summary: z.string().min(1),
  observations: z.array(z.string().min(1)).default([]),
  socraticQuestions: z.array(z.string().min(1)).min(1).max(3),
  hints: z.object({
    level1: z.string().min(1),
    level2: z.string().min(1),
    level3: z.string().min(1)
  }),
  nextAction: z.string().min(1)
});

export const BlueprintDeepDiveRequestSchema = z.object({
  canonicalBlueprintPath: z.string().min(1),
  learnerBlueprintPath: z.string().min(1),
  stepId: z.string().min(1),
  learnerModel: LearnerModelSchema.nullable().default(null),
  taskResult: TaskResultSchema.nullable().default(null),
  failureCount: z.number().int().nonnegative().default(0),
  hintsUsed: z.number().int().nonnegative().default(0),
  revealedHints: z.array(z.string().min(1)).default([])
});

export const BlueprintDeepDiveResponseSchema = z.object({
  blueprintPath: z.string().min(1),
  step: BlueprintStepSchema,
  insertedSlideCount: z.number().int().nonnegative(),
  insertedCheckCount: z.number().int().nonnegative(),
  note: z.string().min(1)
});

export type LearningStyle = z.infer<typeof LearningStyleSchema>;
export type ConceptConfidence = z.infer<typeof ConceptConfidenceSchema>;
export type PlanningQuestionOption = z.infer<typeof PlanningQuestionOptionSchema>;
export type PlanningQuestion = z.infer<typeof PlanningQuestionSchema>;
export type PlanningSessionStartRequest = z.infer<typeof PlanningSessionStartRequestSchema>;
export type PlanningSession = z.infer<typeof PlanningSessionSchema>;
export type PlanningAnswer = z.infer<typeof PlanningAnswerSchema>;
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;
export type ArchitectureComponent = z.infer<typeof ArchitectureComponentSchema>;
export type GeneratedPlanStep = z.infer<typeof GeneratedPlanStepSchema>;
export type GeneratedProjectPlan = z.infer<typeof GeneratedProjectPlanSchema>;
export type PlanningSessionStartResponse = z.infer<typeof PlanningSessionStartResponseSchema>;
export type PlanningSessionCompleteRequest = z.infer<typeof PlanningSessionCompleteRequestSchema>;
export type PlanningSessionCompleteResponse = z.infer<typeof PlanningSessionCompleteResponseSchema>;
export type CurrentPlanningSessionResponse = z.infer<typeof CurrentPlanningSessionResponseSchema>;
export type LearnerProfileResponse = z.infer<typeof LearnerProfileResponseSchema>;
export type StoredKnowledgeConcept = z.infer<typeof StoredKnowledgeConceptSchema>;
export type StoredKnowledgeGoal = z.infer<typeof StoredKnowledgeGoalSchema>;
export type UserKnowledgeBase = z.infer<typeof UserKnowledgeBaseSchema>;
export type AgentJobKind = z.infer<typeof AgentJobKindSchema>;
export type AgentJobStatus = z.infer<typeof AgentJobStatusSchema>;
export type AgentEventLevel = z.infer<typeof AgentEventLevelSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentJobCreatedResponse = z.infer<typeof AgentJobCreatedResponseSchema>;
export type AgentJobSnapshot = z.infer<typeof AgentJobSnapshotSchema>;
export type RuntimeGuideRequest = z.infer<typeof RuntimeGuideRequestSchema>;
export type RuntimeGuideResponse = z.infer<typeof RuntimeGuideResponseSchema>;
export type BlueprintDeepDiveRequest = z.infer<typeof BlueprintDeepDiveRequestSchema>;
export type BlueprintDeepDiveResponse = z.infer<typeof BlueprintDeepDiveResponseSchema>;
