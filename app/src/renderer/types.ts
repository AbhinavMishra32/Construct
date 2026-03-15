export type RuntimeInfo = {
  name: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
};

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

export type TaskSession = {
  sessionId: string;
  stepId: string;
  blueprintPath: string;
  status: "active" | "passed";
  startedAt: string;
  latestAttempt: number;
  preTaskSnapshot: SnapshotRecord;
};

export type TaskAttempt = {
  attempt: number;
  sessionId: string;
  stepId: string;
  status: "failed" | "passed";
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
  blueprint: ProjectBlueprint;
  workspaceRoot: string;
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
