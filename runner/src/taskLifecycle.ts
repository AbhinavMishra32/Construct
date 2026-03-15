import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

type HistoryRow = {
  step_id: string;
  status: LearnerHistoryEntry["status"];
  attempt: number;
  time_spent_ms: number;
  hints_used: number;
  paste_ratio: number;
  recorded_at: string;
};

export class TaskLifecycleService {
  private readonly workspaceRoot: string;
  private readonly snapshotService: SnapshotService;
  private readonly testRunner: TestRunnerManager;
  private readonly databasePath: string;
  private readonly now: () => Date;
  private database?: DatabaseSync;
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
    const request = TaskStartRequestSchema.parse(input);
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
      preTaskSnapshot
    };

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
            pre_task_snapshot_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        session.sessionId,
        session.blueprintPath,
        session.stepId,
        session.status,
        session.startedAt,
        session.latestAttempt,
        JSON.stringify(session.preTaskSnapshot)
      );

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
    const request = TaskSubmitRequestSchema.parse(input);
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
    const postTaskSnapshot =
      taskResult.status === "passed"
        ? await this.snapshotService.commitSnapshot(
            `Post-task snapshot for ${request.stepId} (attempt ${attemptNumber})`
          )
        : undefined;
    const attempt: TaskAttempt = {
      attempt: attemptNumber,
      sessionId: session.sessionId,
      stepId: session.stepId,
      status: taskResult.status,
      recordedAt,
      timeSpentMs,
      telemetry,
      result: taskResult,
      postTaskSnapshot
    };
    const updatedSession: TaskSession = {
      ...session,
      latestAttempt: attemptNumber,
      status: taskResult.status === "passed" ? "passed" : "active"
    };

    const database = this.getDatabase();
    database
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
        attempt.attempt,
        attempt.sessionId,
        attempt.stepId,
        request.blueprintPath,
        attempt.status,
        attempt.recordedAt,
        attempt.timeSpentMs,
        JSON.stringify(attempt.telemetry),
        JSON.stringify(attempt.result),
        attempt.postTaskSnapshot ? JSON.stringify(attempt.postTaskSnapshot) : null
      );
    database
      .prepare(
        `
          UPDATE task_sessions
          SET status = ?, latest_attempt = ?
          WHERE session_id = ?
        `
      )
      .run(updatedSession.status, updatedSession.latestAttempt, updatedSession.sessionId);

    this.recordHistory({
      stepId: request.stepId,
      status: taskResult.status,
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
    const database = this.getDatabase();
    const countRow = database
      .prepare(
        `
          SELECT COUNT(*) AS total_attempts
          FROM task_attempts
          WHERE step_id = ? AND blueprint_path = ?
        `
      )
      .get(stepId, blueprintPath) as { total_attempts: number };
    const latestAttemptRow = database
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

    return TaskProgressSchema.parse({
      stepId,
      totalAttempts: countRow?.total_attempts ?? 0,
      activeSession: this.getActiveSession(blueprintPath, stepId),
      latestAttempt: latestAttemptRow ? deserializeAttempt(latestAttemptRow) : null
    });
  }

  async getLearnerModel(): Promise<LearnerModel> {
    await this.ensureReady();
    const database = this.getDatabase();
    const historyRows = database
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
    const history = historyRows.map((row) =>
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
    this.database?.close();
    this.database = undefined;
    this.initializationPromise = undefined;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }

    await this.initializationPromise;
  }

  private assertReady(): void {
    if (!this.database) {
      throw new Error("TaskLifecycleService has not been initialized.");
    }
  }

  private async initialize(): Promise<void> {
    await mkdir(path.dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS task_sessions (
        session_id TEXT PRIMARY KEY,
        blueprint_path TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        latest_attempt INTEGER NOT NULL DEFAULT 0,
        pre_task_snapshot_json TEXT NOT NULL
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
    const row = this.getDatabase()
      .prepare(
        `
          SELECT
            session_id,
            blueprint_path,
            step_id,
            status,
            started_at,
            latest_attempt,
            pre_task_snapshot_json
          FROM task_sessions
          WHERE session_id = ?
          LIMIT 1
        `
      )
      .get(sessionId) as SessionRow | undefined;

    return row ? deserializeSession(row) : null;
  }

  private getActiveSession(blueprintPath: string, stepId: string): TaskSession | null {
    this.assertReady();
    const row = this.getDatabase()
      .prepare(
        `
          SELECT
            session_id,
            blueprint_path,
            step_id,
            status,
            started_at,
            latest_attempt,
            pre_task_snapshot_json
          FROM task_sessions
          WHERE blueprint_path = ? AND step_id = ? AND status = 'active'
          ORDER BY started_at DESC
          LIMIT 1
        `
      )
      .get(blueprintPath, stepId) as SessionRow | undefined;

    return row ? deserializeSession(row) : null;
  }

  private getNextAttemptNumber(blueprintPath: string, stepId: string): number {
    this.assertReady();
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

  private recordHistory(entry: LearnerHistoryEntry): void {
    this.assertReady();
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

  private getDatabase(): DatabaseSync {
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
    preTaskSnapshot: JSON.parse(row.pre_task_snapshot_json) as SnapshotRecord
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
