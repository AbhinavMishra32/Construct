import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  LearnerHistoryEntrySchema,
  LearnerModelSchema,
  TaskAttemptSchema,
  TaskProgressSchema,
  TaskSessionSchema,
  TaskStartRequestSchema,
  TaskStartResponseSchema,
  TaskSubmitRequestSchema,
  TaskSubmitResponseSchema,
  type LearnerHistoryEntry,
  type LearnerModel,
  type RewriteGate,
  type SnapshotRecord,
  type TaskAttempt,
  type TaskProgress,
  type TaskSession,
  type TaskStartRequest,
  type TaskStartResponse,
  type TaskSubmitRequest,
  type TaskSubmitResponse,
  type TaskTelemetry
} from "@construct/shared";

import { SnapshotService } from "./snapshots";
import { TestRunnerManager, loadBlueprint } from "./testRunner";

type SessionRow = {
  session_id: string;
  blueprint_path: string;
  step_id: string;
  status: TaskSession["status"];
  started_at: string;
  latest_attempt: number;
  pre_task_snapshot_json: string;
  rewrite_gate_json: string | null;
};

type AttemptRow = {
  attempt_number: number;
  session_id: string;
  step_id: string;
  status: TaskAttempt["status"];
  recorded_at: string;
  time_spent_ms: number;
  telemetry_json: string;
  task_result_json: string;
  post_task_snapshot_json: string | null;
};

type PersistedAttemptRow = AttemptRow & {
  blueprint_path: string;
};

type HistoryRow = {
  step_id: string;
  status: LearnerHistoryEntry["status"];
  attempt: number;
  time_spent_ms: number;
  hints_used: number;
  paste_ratio: number;
  recorded_at: string;
};

type TaskLifecycleJsonState = {
  sessions: SessionRow[];
  attempts: PersistedAttemptRow[];
  history: HistoryRow[];
};

type TaskLifecycleBackend = {
  readonly storageKind: "sqlite" | "json";
  initialize(): Promise<void> | void;
  close(): void;
  insertSession(session: TaskSession): void;
  updateSession(session: TaskSession): void;
  getSessionById(sessionId: string): SessionRow | undefined;
  getActiveSession(blueprintPath: string, stepId: string): SessionRow | undefined;
  getNextAttemptNumber(blueprintPath: string, stepId: string): number;
  insertAttempt(blueprintPath: string, attempt: TaskAttempt): void;
  countAttempts(stepId: string, blueprintPath: string): number;
  getLatestAttempt(stepId: string, blueprintPath: string): AttemptRow | undefined;
  insertHistory(entry: LearnerHistoryEntry): void;
  listHistory(): HistoryRow[];
};

type SqliteDatabaseLike = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
};

type SqliteModule = {
  DatabaseSync: new (path: string) => SqliteDatabaseLike;
};

const REWRITE_GATE_POLICY = {
  pasteRatioThreshold: 0.35,
  minPastedChars: 48,
  requiredTypedCharsFloor: 40,
  requiredTypedCharsCeil: 140,
  maxPastedCharsDuringRewrite: 8,
  requiredPasteRatio: 0.1
} as const;

export class TaskLifecycleService {
  private readonly workspaceRoot: string;
  private readonly snapshotService: SnapshotService;
  private readonly testRunner: TestRunnerManager;
  private readonly databasePath: string;
  private readonly now: () => Date;
  private backend?: TaskLifecycleBackend;
  private initializationPromise?: Promise<void>;

  constructor(
    workspaceRoot: string,
    options?: {
      snapshotService?: SnapshotService;
      testRunner?: TestRunnerManager;
      databasePath?: string;
      now?: () => Date;
    }
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.snapshotService = options?.snapshotService ?? new SnapshotService(this.workspaceRoot);
    this.testRunner = options?.testRunner ?? new TestRunnerManager();
    this.databasePath =
      options?.databasePath ??
      path.join(this.workspaceRoot, ".construct", "state", "task-lifecycle.sqlite");
    this.now = options?.now ?? (() => new Date());
  }

  async startTask(input: TaskStartRequest): Promise<TaskStartResponse> {
    await this.ensureReady();
    const request = this.normalizeTaskStartRequest(input);
    await this.resolveStep(request.blueprintPath, request.stepId);

    const existingSession = this.getActiveSession(request.blueprintPath, request.stepId);
    if (existingSession) {
      return TaskStartResponseSchema.parse({
        session: existingSession,
        progress: await this.getTaskProgress(request.stepId, request.blueprintPath),
        learnerModel: await this.getLearnerModel()
      });
    }

    const attempt = this.getNextAttemptNumber(request.blueprintPath, request.stepId);
    const preTaskSnapshot = await this.snapshotService.commitSnapshot(
      `Pre-task snapshot for ${request.stepId} (attempt ${attempt})`
    );
    const session: TaskSession = {
      sessionId: randomUUID(),
      blueprintPath: request.blueprintPath,
      stepId: request.stepId,
      status: "active",
      startedAt: this.now().toISOString(),
      latestAttempt: 0,
      preTaskSnapshot,
      rewriteGate: null
    };

    this.getBackend().insertSession(session);
    this.recordHistory({
      stepId: request.stepId,
      status: "started",
      attempt,
      timeSpentMs: 0,
      hintsUsed: 0,
      pasteRatio: 0,
      recordedAt: session.startedAt
    });

    return TaskStartResponseSchema.parse({
      session,
      progress: await this.getTaskProgress(request.stepId, request.blueprintPath),
      learnerModel: await this.getLearnerModel()
    });
  }

  async submitTask(input: TaskSubmitRequest): Promise<TaskSubmitResponse> {
    await this.ensureReady();
    const request = this.normalizeTaskSubmitRequest(input);
    const session = this.getSessionById(request.sessionId);

    if (!session) {
      throw new Error(`Unknown task session: ${request.sessionId}.`);
    }

    if (session.blueprintPath !== request.blueprintPath || session.stepId !== request.stepId) {
      throw new Error(`Task session ${request.sessionId} does not match ${request.stepId}.`);
    }

    await this.resolveStep(request.blueprintPath, request.stepId);

    const attemptNumber = this.getNextAttemptNumber(request.blueprintPath, request.stepId);
    const taskResult = await this.testRunner.runBlueprintStep({
      blueprintPath: request.blueprintPath,
      stepId: request.stepId,
      timeoutMs: request.timeoutMs
    });
    const recordedAt = this.now().toISOString();
    const timeSpentMs = Math.max(
      0,
      this.now().getTime() - new Date(session.startedAt).getTime()
    );
    const telemetry = normalizeTelemetry(request.telemetry);
    const nextRewriteGate =
      taskResult.status === "passed"
        ? resolveRewriteGate(session.rewriteGate, telemetry, recordedAt)
        : session.rewriteGate;
    const attemptStatus =
      taskResult.status === "failed"
        ? "failed"
        : nextRewriteGate
          ? "needs-review"
          : "passed";
    const postTaskSnapshot =
      attemptStatus === "passed"
        ? await this.snapshotService.commitSnapshot(
            `Post-task snapshot for ${request.stepId} (attempt ${attemptNumber})`
          )
        : undefined;
    const attempt: TaskAttempt = {
      attempt: attemptNumber,
      sessionId: session.sessionId,
      stepId: session.stepId,
      status: attemptStatus,
      recordedAt,
      timeSpentMs,
      telemetry,
      result: taskResult,
      postTaskSnapshot
    };
    const updatedSession: TaskSession = {
      ...session,
      latestAttempt: attemptNumber,
      status: attemptStatus === "passed" ? "passed" : "active",
      rewriteGate: attemptStatus === "passed" ? null : nextRewriteGate
    };

    const backend = this.getBackend();
    backend.insertAttempt(request.blueprintPath, attempt);
    backend.updateSession(updatedSession);

    this.recordHistory({
      stepId: request.stepId,
      status: attemptStatus,
      attempt: attemptNumber,
      timeSpentMs,
      hintsUsed: telemetry.hintsUsed,
      pasteRatio: telemetry.pasteRatio,
      recordedAt
    });

    return TaskSubmitResponseSchema.parse({
      session: updatedSession,
      attempt,
      progress: await this.getTaskProgress(request.stepId, request.blueprintPath),
      learnerModel: await this.getLearnerModel()
    });
  }

  async getTaskProgress(stepId: string, blueprintPath: string): Promise<TaskProgress> {
    await this.ensureReady();
    const normalizedBlueprintPath = this.normalizeBlueprintPath(blueprintPath);
    const backend = this.getBackend();
    const latestAttemptRow = backend.getLatestAttempt(stepId, normalizedBlueprintPath);

    return TaskProgressSchema.parse({
      stepId,
      totalAttempts: backend.countAttempts(stepId, normalizedBlueprintPath),
      activeSession: this.getActiveSession(normalizedBlueprintPath, stepId),
      latestAttempt: latestAttemptRow ? deserializeAttempt(latestAttemptRow) : null
    });
  }

  async getLearnerModel(): Promise<LearnerModel> {
    await this.ensureReady();
    const history = this.getBackend().listHistory().map((row) =>
      LearnerHistoryEntrySchema.parse({
        stepId: row.step_id,
        status: row.status,
        attempt: row.attempt,
        timeSpentMs: row.time_spent_ms,
        hintsUsed: row.hints_used,
        pasteRatio: row.paste_ratio,
        recordedAt: row.recorded_at
      })
    );
    const hintsUsed = history.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.stepId] = (accumulator[entry.stepId] ?? 0) + entry.hintsUsed;
      return accumulator;
    }, {});

    return LearnerModelSchema.parse({
      skills: {},
      history,
      hintsUsed,
      reflections: {}
    });
  }

  close(): void {
    this.backend?.close();
    this.backend = undefined;
    this.initializationPromise = undefined;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }

    await this.initializationPromise;
  }

  private assertReady(): void {
    if (!this.backend) {
      throw new Error("TaskLifecycleService has not been initialized.");
    }
  }

  private async initialize(): Promise<void> {
    this.backend = await createTaskLifecycleBackend(this.databasePath);
    await this.backend.initialize();
  }

  private async resolveStep(blueprintPath: string, stepId: string): Promise<void> {
    const blueprint = await loadBlueprint(blueprintPath);
    const step = blueprint.steps.find((entry) => entry.id === stepId);

    if (!step) {
      throw new Error(`Unknown blueprint step: ${stepId}.`);
    }
  }

  private getSessionById(sessionId: string): TaskSession | null {
    this.assertReady();
    const row = this.getBackend().getSessionById(sessionId);
    return row ? deserializeSession(row) : null;
  }

  private getActiveSession(blueprintPath: string, stepId: string): TaskSession | null {
    this.assertReady();
    const row = this.getBackend().getActiveSession(blueprintPath, stepId);
    return row ? deserializeSession(row) : null;
  }

  private getNextAttemptNumber(blueprintPath: string, stepId: string): number {
    this.assertReady();
    return this.getBackend().getNextAttemptNumber(blueprintPath, stepId);
  }

  private recordHistory(entry: LearnerHistoryEntry): void {
    this.assertReady();
    this.getBackend().insertHistory(entry);
  }

  private getBackend(): TaskLifecycleBackend {
    if (!this.backend) {
      throw new Error("TaskLifecycleService has not been initialized.");
    }

    return this.backend;
  }

  private normalizeTaskStartRequest(input: TaskStartRequest): TaskStartRequest {
    const request = TaskStartRequestSchema.parse(input);

    return {
      ...request,
      blueprintPath: this.normalizeBlueprintPath(request.blueprintPath)
    };
  }

  private normalizeTaskSubmitRequest(input: TaskSubmitRequest): TaskSubmitRequest {
    const request = TaskSubmitRequestSchema.parse(input);

    return {
      ...request,
      blueprintPath: this.normalizeBlueprintPath(request.blueprintPath)
    };
  }

  private normalizeBlueprintPath(blueprintPath: string): string {
    if (path.isAbsolute(blueprintPath)) {
      return path.normalize(blueprintPath);
    }

    const candidates = [
      path.resolve(blueprintPath),
      path.resolve(this.workspaceRoot, blueprintPath),
      path.resolve(path.dirname(this.workspaceRoot), blueprintPath),
      path.resolve(path.dirname(path.dirname(this.workspaceRoot)), blueprintPath),
      path.resolve(this.workspaceRoot, path.basename(blueprintPath))
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return path.normalize(candidate);
      }
    }

    return path.resolve(blueprintPath);
  }
}

class JsonTaskLifecycleBackend implements TaskLifecycleBackend {
  readonly storageKind = "json" as const;

  private readonly statePath: string;
  private state: TaskLifecycleJsonState = cloneEmptyJsonState();

  constructor(databasePath: string) {
    this.statePath = resolveJsonStatePath(databasePath);
  }

  initialize(): void {
    mkdirSync(path.dirname(this.statePath), { recursive: true });

    if (!existsSync(this.statePath)) {
      this.state = cloneEmptyJsonState();
      this.persistState();
      return;
    }

    const raw = readFileSync(this.statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TaskLifecycleJsonState>;
    this.state = {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  }

  close(): void {}

  insertSession(session: TaskSession): void {
    this.state.sessions.push(serializeSession(session));
    this.persistState();
  }

  updateSession(session: TaskSession): void {
    const sessionRow = serializeSession(session);
    const index = this.state.sessions.findIndex((row) => row.session_id === session.sessionId);

    if (index < 0) {
      throw new Error(`Unknown task session: ${session.sessionId}.`);
    }

    this.state.sessions[index] = sessionRow;
    this.persistState();
  }

  getSessionById(sessionId: string): SessionRow | undefined {
    return this.state.sessions.find((row) => row.session_id === sessionId);
  }

  getActiveSession(blueprintPath: string, stepId: string): SessionRow | undefined {
    return [...this.state.sessions]
      .reverse()
      .find(
        (row) =>
          row.blueprint_path === blueprintPath &&
          row.step_id === stepId &&
          row.status === "active"
      );
  }

  getNextAttemptNumber(blueprintPath: string, stepId: string): number {
    return (
      this.state.attempts.reduce((maximum, row) => {
        if (row.blueprint_path !== blueprintPath || row.step_id !== stepId) {
          return maximum;
        }

        return Math.max(maximum, row.attempt_number);
      }, 0) + 1
    );
  }

  insertAttempt(blueprintPath: string, attempt: TaskAttempt): void {
    this.state.attempts.push({
      ...serializeAttempt(attempt),
      blueprint_path: blueprintPath
    });
    this.persistState();
  }

  countAttempts(stepId: string, blueprintPath: string): number {
    return this.state.attempts.filter(
      (row) => row.step_id === stepId && row.blueprint_path === blueprintPath
    ).length;
  }

  getLatestAttempt(stepId: string, blueprintPath: string): AttemptRow | undefined {
    return this.state.attempts
      .filter((row) => row.step_id === stepId && row.blueprint_path === blueprintPath)
      .sort((left, right) => right.attempt_number - left.attempt_number)[0];
  }

  insertHistory(entry: LearnerHistoryEntry): void {
    this.state.history.push({
      step_id: entry.stepId,
      status: entry.status,
      attempt: entry.attempt,
      time_spent_ms: entry.timeSpentMs,
      hints_used: entry.hintsUsed,
      paste_ratio: entry.pasteRatio,
      recorded_at: entry.recordedAt
    });
    this.persistState();
  }

  listHistory(): HistoryRow[] {
    return [...this.state.history];
  }

  private persistState(): void {
    const nextState = JSON.stringify(this.state, null, 2);
    const tempPath = `${this.statePath}.tmp`;

    writeFileSync(tempPath, nextState, "utf8");
    renameSync(tempPath, this.statePath);
  }
}

class SqliteTaskLifecycleBackend implements TaskLifecycleBackend {
  readonly storageKind = "sqlite" as const;

  private readonly databasePath: string;
  private readonly DatabaseSync: SqliteModule["DatabaseSync"];
  private database?: SqliteDatabaseLike;

  constructor(databasePath: string, DatabaseSync: SqliteModule["DatabaseSync"]) {
    this.databasePath = databasePath;
    this.DatabaseSync = DatabaseSync;
  }

  initialize(): void {
    mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = new this.DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS task_sessions (
        session_id TEXT PRIMARY KEY,
        blueprint_path TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        latest_attempt INTEGER NOT NULL DEFAULT 0,
        pre_task_snapshot_json TEXT NOT NULL,
        rewrite_gate_json TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS task_sessions_active_step_idx
        ON task_sessions (blueprint_path, step_id)
        WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS task_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_number INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        blueprint_path TEXT NOT NULL,
        status TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        time_spent_ms INTEGER NOT NULL,
        telemetry_json TEXT NOT NULL,
        task_result_json TEXT NOT NULL,
        post_task_snapshot_json TEXT,
        FOREIGN KEY (session_id) REFERENCES task_sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS task_attempts_step_idx
        ON task_attempts (blueprint_path, step_id, attempt_number DESC);

      CREATE TABLE IF NOT EXISTS learner_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        time_spent_ms INTEGER NOT NULL,
        hints_used INTEGER NOT NULL,
        paste_ratio REAL NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
    ensureColumn(this.getDatabase(), "task_sessions", "rewrite_gate_json", "TEXT");
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  insertSession(session: TaskSession): void {
    const sessionRow = serializeSession(session);
    this.getDatabase()
      .prepare(
        `
          INSERT INTO task_sessions (
            session_id,
            blueprint_path,
            step_id,
            status,
            started_at,
            latest_attempt,
            pre_task_snapshot_json,
            rewrite_gate_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        sessionRow.session_id,
        sessionRow.blueprint_path,
        sessionRow.step_id,
        sessionRow.status,
        sessionRow.started_at,
        sessionRow.latest_attempt,
        sessionRow.pre_task_snapshot_json,
        sessionRow.rewrite_gate_json
      );
  }

  updateSession(session: TaskSession): void {
    const sessionRow = serializeSession(session);
    this.getDatabase()
      .prepare(
        `
          UPDATE task_sessions
          SET status = ?, latest_attempt = ?, rewrite_gate_json = ?
          WHERE session_id = ?
        `
      )
      .run(
        sessionRow.status,
        sessionRow.latest_attempt,
        sessionRow.rewrite_gate_json,
        sessionRow.session_id
      );
  }

  getSessionById(sessionId: string): SessionRow | undefined {
    return this.getDatabase()
      .prepare(
        `
          SELECT
            session_id,
            blueprint_path,
            step_id,
            status,
            started_at,
            latest_attempt,
            pre_task_snapshot_json,
            rewrite_gate_json
          FROM task_sessions
          WHERE session_id = ?
          LIMIT 1
        `
      )
      .get(sessionId) as SessionRow | undefined;
  }

  getActiveSession(blueprintPath: string, stepId: string): SessionRow | undefined {
    return this.getDatabase()
      .prepare(
        `
          SELECT
            session_id,
            blueprint_path,
            step_id,
            status,
            started_at,
            latest_attempt,
            pre_task_snapshot_json,
            rewrite_gate_json
          FROM task_sessions
          WHERE blueprint_path = ? AND step_id = ? AND status = 'active'
          ORDER BY started_at DESC
          LIMIT 1
        `
      )
      .get(blueprintPath, stepId) as SessionRow | undefined;
  }

  getNextAttemptNumber(blueprintPath: string, stepId: string): number {
    const row = this.getDatabase()
      .prepare(
        `
          SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
          FROM task_attempts
          WHERE blueprint_path = ? AND step_id = ?
        `
      )
      .get(blueprintPath, stepId) as { next_attempt: number } | undefined;

    return row?.next_attempt ?? 1;
  }

  insertAttempt(blueprintPath: string, attempt: TaskAttempt): void {
    const attemptRow = serializeAttempt(attempt);
    this.getDatabase()
      .prepare(
        `
          INSERT INTO task_attempts (
            attempt_number,
            session_id,
            step_id,
            blueprint_path,
            status,
            recorded_at,
            time_spent_ms,
            telemetry_json,
            task_result_json,
            post_task_snapshot_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        attemptRow.attempt_number,
        attemptRow.session_id,
        attemptRow.step_id,
        blueprintPath,
        attemptRow.status,
        attemptRow.recorded_at,
        attemptRow.time_spent_ms,
        attemptRow.telemetry_json,
        attemptRow.task_result_json,
        attemptRow.post_task_snapshot_json
      );
  }

  countAttempts(stepId: string, blueprintPath: string): number {
    const row = this.getDatabase()
      .prepare(
        `
          SELECT COUNT(*) AS total_attempts
          FROM task_attempts
          WHERE step_id = ? AND blueprint_path = ?
        `
      )
      .get(stepId, blueprintPath) as { total_attempts: number } | undefined;

    return row?.total_attempts ?? 0;
  }

  getLatestAttempt(stepId: string, blueprintPath: string): AttemptRow | undefined {
    return this.getDatabase()
      .prepare(
        `
          SELECT
            attempt_number,
            session_id,
            step_id,
            status,
            recorded_at,
            time_spent_ms,
            telemetry_json,
            task_result_json,
            post_task_snapshot_json
          FROM task_attempts
          WHERE step_id = ? AND blueprint_path = ?
          ORDER BY attempt_number DESC
          LIMIT 1
        `
      )
      .get(stepId, blueprintPath) as AttemptRow | undefined;
  }

  insertHistory(entry: LearnerHistoryEntry): void {
    this.getDatabase()
      .prepare(
        `
          INSERT INTO learner_history (
            step_id,
            status,
            attempt,
            time_spent_ms,
            hints_used,
            paste_ratio,
            recorded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        entry.stepId,
        entry.status,
        entry.attempt,
        entry.timeSpentMs,
        entry.hintsUsed,
        entry.pasteRatio,
        entry.recordedAt
      );
  }

  listHistory(): HistoryRow[] {
    return this.getDatabase()
      .prepare(
        `
          SELECT
            step_id,
            status,
            attempt,
            time_spent_ms,
            hints_used,
            paste_ratio,
            recorded_at
          FROM learner_history
          ORDER BY id ASC
        `
      )
      .all() as HistoryRow[];
  }

  private getDatabase(): SqliteDatabaseLike {
    if (!this.database) {
      throw new Error("TaskLifecycleService has not been initialized.");
    }

    return this.database;
  }
}

function deserializeSession(row: SessionRow): TaskSession {
  return TaskSessionSchema.parse({
    sessionId: row.session_id,
    blueprintPath: row.blueprint_path,
    stepId: row.step_id,
    status: row.status,
    startedAt: row.started_at,
    latestAttempt: row.latest_attempt,
    preTaskSnapshot: JSON.parse(row.pre_task_snapshot_json) as SnapshotRecord,
    rewriteGate: row.rewrite_gate_json
      ? (JSON.parse(row.rewrite_gate_json) as RewriteGate)
      : null
  });
}

function deserializeAttempt(row: AttemptRow): TaskAttempt {
  return TaskAttemptSchema.parse({
    attempt: row.attempt_number,
    sessionId: row.session_id,
    stepId: row.step_id,
    status: row.status,
    recordedAt: row.recorded_at,
    timeSpentMs: row.time_spent_ms,
    telemetry: JSON.parse(row.telemetry_json) as TaskTelemetry,
    result: JSON.parse(row.task_result_json),
    postTaskSnapshot: row.post_task_snapshot_json
      ? (JSON.parse(row.post_task_snapshot_json) as SnapshotRecord)
      : undefined
  });
}

function serializeSession(session: TaskSession): SessionRow {
  return {
    session_id: session.sessionId,
    blueprint_path: session.blueprintPath,
    step_id: session.stepId,
    status: session.status,
    started_at: session.startedAt,
    latest_attempt: session.latestAttempt,
    pre_task_snapshot_json: JSON.stringify(session.preTaskSnapshot),
    rewrite_gate_json: session.rewriteGate ? JSON.stringify(session.rewriteGate) : null
  };
}

function serializeAttempt(attempt: TaskAttempt): AttemptRow {
  return {
    attempt_number: attempt.attempt,
    session_id: attempt.sessionId,
    step_id: attempt.stepId,
    status: attempt.status,
    recorded_at: attempt.recordedAt,
    time_spent_ms: attempt.timeSpentMs,
    telemetry_json: JSON.stringify(attempt.telemetry),
    task_result_json: JSON.stringify(attempt.result),
    post_task_snapshot_json: attempt.postTaskSnapshot
      ? JSON.stringify(attempt.postTaskSnapshot)
      : null
  };
}

function normalizeTelemetry(telemetry: TaskTelemetry): TaskTelemetry {
  const totalCharacters = telemetry.typedChars + telemetry.pastedChars;
  const pasteRatio =
    totalCharacters > 0
      ? Number((telemetry.pastedChars / totalCharacters).toFixed(4))
      : telemetry.pasteRatio;

  return {
    hintsUsed: telemetry.hintsUsed,
    pasteRatio,
    typedChars: telemetry.typedChars,
    pastedChars: telemetry.pastedChars
  };
}

function resolveRewriteGate(
  existingGate: RewriteGate | null,
  telemetry: TaskTelemetry,
  recordedAt: string
): RewriteGate | null {
  if (existingGate) {
    return meetsRewriteGate(existingGate, telemetry) ? null : existingGate;
  }

  return shouldRequireRewriteGate(telemetry) ? createRewriteGate(telemetry, recordedAt) : null;
}

function shouldRequireRewriteGate(telemetry: TaskTelemetry): boolean {
  return (
    telemetry.pasteRatio >= REWRITE_GATE_POLICY.pasteRatioThreshold &&
    telemetry.pastedChars >= REWRITE_GATE_POLICY.minPastedChars
  );
}

function meetsRewriteGate(gate: RewriteGate, telemetry: TaskTelemetry): boolean {
  return (
    telemetry.typedChars >= gate.requiredTypedChars &&
    telemetry.pastedChars <= gate.maxPastedChars &&
    telemetry.pasteRatio <= gate.requiredPasteRatio
  );
}

function createRewriteGate(telemetry: TaskTelemetry, recordedAt: string): RewriteGate {
  const requiredTypedChars = Math.max(
    REWRITE_GATE_POLICY.requiredTypedCharsFloor,
    Math.min(REWRITE_GATE_POLICY.requiredTypedCharsCeil, telemetry.pastedChars)
  );

  return {
    reason: `Paste ratio reached ${Math.round(telemetry.pasteRatio * 100)}%.`,
    guidance:
      "Retype the anchored implementation from memory, avoid large pastes, and resubmit to earn completion.",
    activatedAt: recordedAt,
    pasteRatio: telemetry.pasteRatio,
    pasteRatioThreshold: REWRITE_GATE_POLICY.pasteRatioThreshold,
    pastedChars: telemetry.pastedChars,
    requiredTypedChars,
    maxPastedChars: REWRITE_GATE_POLICY.maxPastedCharsDuringRewrite,
    requiredPasteRatio: REWRITE_GATE_POLICY.requiredPasteRatio
  };
}

async function createTaskLifecycleBackend(
  databasePath: string
): Promise<TaskLifecycleBackend> {
  const sqliteModule = await loadSqliteModule();

  if (sqliteModule) {
    return new SqliteTaskLifecycleBackend(databasePath, sqliteModule.DatabaseSync);
  }

  console.warn(
    "[construct-task-lifecycle] node:sqlite is unavailable; falling back to JSON task state."
  );
  return new JsonTaskLifecycleBackend(databasePath);
}

async function loadSqliteModule(): Promise<SqliteModule | null> {
  try {
    return (await import("node:sqlite")) as SqliteModule;
  } catch (error) {
    if (isNodeSqliteUnavailable(error)) {
      return null;
    }

    throw error;
  }
}

function isNodeSqliteUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("node:sqlite") ||
    ("code" in error && error.code === "ERR_UNKNOWN_BUILTIN_MODULE")
  );
}

function resolveJsonStatePath(databasePath: string): string {
  return databasePath.endsWith(".sqlite")
    ? databasePath.replace(/\.sqlite$/u, ".json")
    : `${databasePath}.json`;
}

function cloneEmptyJsonState(): TaskLifecycleJsonState {
  return {
    sessions: [],
    attempts: [],
    history: []
  };
}

function ensureColumn(
  database: SqliteDatabaseLike,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
