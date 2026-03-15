export type RuntimeInfo = {
  name: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
};

export type LearningStyle = "concept-first" | "build-first" | "example-first";

export type ConceptConfidence = "comfortable" | "shaky" | "new";

export type RunnerHealth = {
  status: string;
  service: string;
  port: number;
};

export type WorkspaceFileEntry = {
  path: string;
  kind: "file" | "directory";
  size: number;
};

export type TaskFailure = {
  testName: string;
  message: string;
  stackTrace?: string;
};

export type TaskResult = {
  stepId: string;
  status: "passed" | "failed";
  adapter: "jest" | "cargo" | "pytest";
  durationMs: number;
  testsRun: string[];
  failures: TaskFailure[];
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

export type TaskTelemetry = {
  hintsUsed: number;
  pasteRatio: number;
  typedChars: number;
  pastedChars: number;
};

export type SnapshotRecord = {
  commitId: string;
  timestamp: string;
  message: string;
  fileDiffs: string[];
};

export type RewriteGate = {
  reason: string;
  guidance: string;
  activatedAt: string;
  pasteRatio: number;
  pasteRatioThreshold: number;
  pastedChars: number;
  requiredTypedChars: number;
  maxPastedChars: number;
  requiredPasteRatio: number;
};

export type TaskSession = {
  sessionId: string;
  stepId: string;
  blueprintPath: string;
  status: "active" | "passed";
  startedAt: string;
  latestAttempt: number;
  preTaskSnapshot: SnapshotRecord;
  rewriteGate: RewriteGate | null;
};

export type TaskAttempt = {
  attempt: number;
  sessionId: string;
  stepId: string;
  status: "failed" | "passed" | "needs-review";
  recordedAt: string;
  timeSpentMs: number;
  telemetry: TaskTelemetry;
  result: TaskResult;
  postTaskSnapshot?: SnapshotRecord;
};

export type TaskProgress = {
  stepId: string;
  totalAttempts: number;
  activeSession: TaskSession | null;
  latestAttempt: TaskAttempt | null;
};

export type LearnerHistoryEntry = {
  stepId: string;
  status: "started" | "failed" | "passed" | "needs-review";
  attempt: number;
  timeSpentMs: number;
  hintsUsed: number;
  pasteRatio: number;
  recordedAt: string;
};

export type LearnerModel = {
  skills: Record<string, number>;
  history: LearnerHistoryEntry[];
  hintsUsed: Record<string, number>;
  reflections: Record<string, string>;
};

export type CheckOption = {
  id: string;
  label: string;
  rationale?: string;
};

export type ComprehensionCheck =
  | {
      id: string;
      type: "mcq";
      prompt: string;
      options: CheckOption[];
      answer: string;
    }
  | {
      id: string;
      type: "short-answer";
      prompt: string;
      rubric: string[];
      placeholder?: string;
    };

export type BlueprintStep = {
  id: string;
  title: string;
  summary: string;
  doc: string;
  anchor: {
    file: string;
    marker: string;
    startLine?: number;
    endLine?: number;
  };
  tests: string[];
  concepts: string[];
  constraints: string[];
  checks: ComprehensionCheck[];
  estimatedMinutes: number;
  difficulty: "intro" | "core" | "advanced";
};

export type DependencyNode = {
  id: string;
  label: string;
  kind: "component" | "skill";
};

export type DependencyEdge = {
  from: string;
  to: string;
  reason: string;
};

export type ProjectBlueprint = {
  id: string;
  name: string;
  version: string;
  description: string;
  projectRoot: string;
  sourceProjectRoot: string;
  language: string;
  entrypoints: string[];
  files: Record<string, string>;
  steps: BlueprintStep[];
  dependencyGraph: {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
  };
  metadata: {
    createdBy: string;
    createdAt: string;
    targetLanguage: string;
    tags: string[];
  };
};

export type BlueprintEnvelope = {
  blueprint: ProjectBlueprint | null;
  workspaceRoot: string;
  blueprintPath: string;
  canonicalBlueprintPath?: string | null;
  defaultBlueprintPath?: string;
  hasActiveBlueprint: boolean;
};

export type PlanningQuestionOption = {
  id: string;
  label: string;
  description: string;
  confidenceSignal: ConceptConfidence;
};

export type PlanningQuestion = {
  id: string;
  conceptId: string;
  category: "language" | "domain" | "workflow";
  prompt: string;
  options: PlanningQuestionOption[];
};

export type PlanningSession = {
  sessionId: string;
  goal: string;
  normalizedGoal: string;
  learningStyle: LearningStyle;
  detectedLanguage: string;
  detectedDomain: string;
  createdAt: string;
  questions: PlanningQuestion[];
};

export type PlanningAnswer =
  | {
      questionId: string;
      answerType: "option";
      optionId: string;
    }
  | {
      questionId: string;
      answerType: "custom";
      customResponse: string;
    };

export type ConceptNode = {
  id: string;
  label: string;
  category: "language" | "domain" | "workflow";
  confidence: ConceptConfidence;
  rationale: string;
};

export type KnowledgeGraph = {
  concepts: ConceptNode[];
  strengths: string[];
  gaps: string[];
};

export type ArchitectureComponent = {
  id: string;
  label: string;
  kind: "component" | "skill";
  summary: string;
  dependsOn: string[];
};

export type GeneratedPlanStep = {
  id: string;
  title: string;
  kind: "skill" | "implementation";
  objective: string;
  rationale: string;
  concepts: string[];
  dependsOn: string[];
  validationFocus: string[];
  suggestedFiles: string[];
  implementationNotes: string[];
  quizFocus: string[];
  hiddenValidationFocus: string[];
};

export type GeneratedProjectPlan = {
  sessionId: string;
  goal: string;
  language: string;
  domain: string;
  learningStyle: LearningStyle;
  summary: string;
  architecture: ArchitectureComponent[];
  knowledgeGraph: KnowledgeGraph;
  steps: GeneratedPlanStep[];
  suggestedFirstStepId: string;
};

export type PlanningSessionStartResponse = {
  session: PlanningSession;
};

export type PlanningSessionCompleteResponse = {
  session: PlanningSession;
  plan: GeneratedProjectPlan;
};

export type CurrentPlanningSessionResponse = {
  session: PlanningSession | null;
  plan: GeneratedProjectPlan | null;
};

export type AgentJobCreatedResponse = {
  jobId: string;
  kind: "planning-questions" | "planning-plan" | "runtime-guide";
  status: "queued" | "running" | "completed" | "failed";
  streamPath: string;
  resultPath: string;
};

export type AgentJobSnapshot = {
  jobId: string;
  kind: "planning-questions" | "planning-plan" | "runtime-guide";
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  error?: string;
  result: unknown | null;
};

export type AgentEvent = {
  id: string;
  jobId: string;
  kind: "planning-questions" | "planning-plan" | "runtime-guide";
  stage: string;
  title: string;
  detail?: string;
  level: "info" | "success" | "warning" | "error";
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type RuntimeGuideRequest = {
  stepId: string;
  stepTitle: string;
  stepSummary: string;
  filePath: string;
  anchorMarker: string;
  codeSnippet: string;
  constraints: string[];
  tests: string[];
  taskResult: TaskResult | null;
  learnerModel: LearnerModel | null;
};

export type RuntimeGuideResponse = {
  summary: string;
  observations: string[];
  socraticQuestions: string[];
  hints: {
    level1: string;
    level2: string;
    level3: string;
  };
  nextAction: string;
};

export type WorkspaceFilesEnvelope = {
  root: string;
  files: WorkspaceFileEntry[];
};

export type WorkspaceFileEnvelope = {
  path: string;
  content: string;
};

export type TaskStartResponse = {
  session: TaskSession;
  progress: TaskProgress;
  learnerModel: LearnerModel;
};

export type TaskSubmitResponse = {
  session: TaskSession;
  attempt: TaskAttempt;
  progress: TaskProgress;
  learnerModel: LearnerModel;
};

export type TreeNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  children: TreeNode[];
};

export type AnchorLocation = {
  marker: string;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
};
