import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CurrentPlanningSessionResponseSchema,
  UserKnowledgeBaseSchema,
  type CurrentPlanningSessionResponse,
  type UserKnowledgeBase
} from "@construct/shared";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

const ActiveBlueprintStateSchema = z.object({
  blueprintPath: z.string().min(1),
  updatedAt: z.string().datetime(),
  sessionId: z.string().min(1).optional()
});

const PersistedGeneratedBlueprintRecordSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(1),
  blueprintId: z.string().min(1),
  blueprintPath: z.string().min(1),
  projectRoot: z.string().min(1),
  blueprintJson: z.string().min(1),
  planJson: z.string().min(1),
  bundleJson: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isActive: z.boolean().default(false)
});

const PersistedGeneratedBlueprintRecordListSchema = z.array(
  PersistedGeneratedBlueprintRecordSchema
);

export type ActiveBlueprintState = z.infer<typeof ActiveBlueprintStateSchema>;
export type PersistedGeneratedBlueprintRecord = z.infer<
  typeof PersistedGeneratedBlueprintRecordSchema
>;

export type AgentPersistence = {
  getPlanningState(): Promise<CurrentPlanningSessionResponse | null>;
  setPlanningState(state: CurrentPlanningSessionResponse): Promise<void>;
  getKnowledgeBase(): Promise<UserKnowledgeBase | null>;
  setKnowledgeBase(knowledgeBase: UserKnowledgeBase): Promise<void>;
  getActiveBlueprintState(): Promise<ActiveBlueprintState | null>;
  setActiveBlueprintState(state: ActiveBlueprintState): Promise<void>;
  getGeneratedBlueprintRecord(sessionId: string): Promise<PersistedGeneratedBlueprintRecord | null>;
  saveGeneratedBlueprintRecord(record: PersistedGeneratedBlueprintRecord): Promise<void>;
};

type AgentPersistenceLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

type AgentPersistenceInput = {
  rootDirectory: string;
  logger: AgentPersistenceLogger;
};

type StorageBackend = "local" | "neon";

export function createAgentPersistence(input: AgentPersistenceInput): AgentPersistence {
  const backend = resolveStorageBackend();

  input.logger.info("Initializing agent persistence.", {
    backend,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim())
  });

  if (backend === "neon") {
    const databaseUrl = process.env.DATABASE_URL?.trim();

    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required when CONSTRUCT_STORAGE_BACKEND=neon."
      );
    }

    return new NeonAgentPersistence(databaseUrl, input.logger);
  }

  return new LocalFileAgentPersistence(input.rootDirectory);
}

class LocalFileAgentPersistence implements AgentPersistence {
  private readonly stateDirectory: string;
  private readonly planningStatePath: string;
  private readonly knowledgeBasePath: string;
  private readonly activeBlueprintStatePath: string;
  private readonly blueprintRecordsPath: string;

  constructor(rootDirectory: string) {
    this.stateDirectory = path.join(rootDirectory, ".construct", "state");
    this.planningStatePath = path.join(this.stateDirectory, "agent-planner.json");
    this.knowledgeBasePath = path.join(this.stateDirectory, "user-knowledge.json");
    this.activeBlueprintStatePath = path.join(this.stateDirectory, "active-blueprint.json");
    this.blueprintRecordsPath = path.join(this.stateDirectory, "generated-blueprints.json");
  }

  async getPlanningState(): Promise<CurrentPlanningSessionResponse | null> {
    if (!existsSync(this.planningStatePath)) {
      return null;
    }

    const raw = await readFile(this.planningStatePath, "utf8");
    return CurrentPlanningSessionResponseSchema.parse(JSON.parse(raw));
  }

  async setPlanningState(state: CurrentPlanningSessionResponse): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(this.planningStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async getKnowledgeBase(): Promise<UserKnowledgeBase | null> {
    if (!existsSync(this.knowledgeBasePath)) {
      return null;
    }

    const raw = await readFile(this.knowledgeBasePath, "utf8");
    return UserKnowledgeBaseSchema.parse(JSON.parse(raw));
  }

  async setKnowledgeBase(knowledgeBase: UserKnowledgeBase): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.knowledgeBasePath,
      `${JSON.stringify(knowledgeBase, null, 2)}\n`,
      "utf8"
    );
  }

  async getActiveBlueprintState(): Promise<ActiveBlueprintState | null> {
    if (!existsSync(this.activeBlueprintStatePath)) {
      return null;
    }

    const raw = await readFile(this.activeBlueprintStatePath, "utf8");
    return ActiveBlueprintStateSchema.parse(JSON.parse(raw));
  }

  async setActiveBlueprintState(state: ActiveBlueprintState): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.activeBlueprintStatePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );

    const records = await this.readBlueprintRecords();
    const nextRecords = records.map((record) => ({
      ...record,
      isActive:
        record.sessionId === state.sessionId || record.blueprintPath === state.blueprintPath
    }));
    await this.writeBlueprintRecords(nextRecords);
  }

  async getGeneratedBlueprintRecord(
    sessionId: string
  ): Promise<PersistedGeneratedBlueprintRecord | null> {
    const records = await this.readBlueprintRecords();
    return records.find((record) => record.sessionId === sessionId) ?? null;
  }

  async saveGeneratedBlueprintRecord(
    record: PersistedGeneratedBlueprintRecord
  ): Promise<void> {
    const records = await this.readBlueprintRecords();
    const nextRecords = records.filter(
      (existingRecord) => existingRecord.sessionId !== record.sessionId
    );
    nextRecords.unshift(PersistedGeneratedBlueprintRecordSchema.parse(record));
    await this.writeBlueprintRecords(nextRecords);
  }

  private async readBlueprintRecords(): Promise<PersistedGeneratedBlueprintRecord[]> {
    if (!existsSync(this.blueprintRecordsPath)) {
      return [];
    }

    const raw = await readFile(this.blueprintRecordsPath, "utf8");
    return PersistedGeneratedBlueprintRecordListSchema.parse(JSON.parse(raw));
  }

  private async writeBlueprintRecords(
    records: PersistedGeneratedBlueprintRecord[]
  ): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(
      this.blueprintRecordsPath,
      `${JSON.stringify(records, null, 2)}\n`,
      "utf8"
    );
  }
}

class NeonAgentPersistence implements AgentPersistence {
  private readonly sql;
  private schemaReadyPromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    private readonly logger: AgentPersistenceLogger
  ) {
    this.sql = neon(databaseUrl);
  }

  async getPlanningState(): Promise<CurrentPlanningSessionResponse | null> {
    const raw = await this.readStateValue("planning_state");
    return raw ? CurrentPlanningSessionResponseSchema.parse(JSON.parse(raw)) : null;
  }

  async setPlanningState(state: CurrentPlanningSessionResponse): Promise<void> {
    await this.writeStateValue("planning_state", JSON.stringify(state));
  }

  async getKnowledgeBase(): Promise<UserKnowledgeBase | null> {
    const raw = await this.readStateValue("knowledge_base");
    return raw ? UserKnowledgeBaseSchema.parse(JSON.parse(raw)) : null;
  }

  async setKnowledgeBase(knowledgeBase: UserKnowledgeBase): Promise<void> {
    await this.writeStateValue("knowledge_base", JSON.stringify(knowledgeBase));
  }

  async getActiveBlueprintState(): Promise<ActiveBlueprintState | null> {
    const raw = await this.readStateValue("active_blueprint");
    return raw ? ActiveBlueprintStateSchema.parse(JSON.parse(raw)) : null;
  }

  async setActiveBlueprintState(state: ActiveBlueprintState): Promise<void> {
    await this.ensureSchema();
    await this.writeStateValue("active_blueprint", JSON.stringify(state));
    await this.sql`
      UPDATE construct_blueprints
      SET is_active = CASE
        WHEN session_id = ${state.sessionId ?? ""} THEN TRUE
        ELSE FALSE
      END
    `;
  }

  async getGeneratedBlueprintRecord(
    sessionId: string
  ): Promise<PersistedGeneratedBlueprintRecord | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT
        session_id,
        goal,
        blueprint_id,
        blueprint_path,
        project_root,
        blueprint_json,
        plan_json,
        bundle_json,
        created_at,
        updated_at,
        is_active
      FROM construct_blueprints
      WHERE session_id = ${sessionId}
      LIMIT 1
    `;

    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return PersistedGeneratedBlueprintRecordSchema.parse({
      sessionId: String(row.session_id),
      goal: String(row.goal),
      blueprintId: String(row.blueprint_id),
      blueprintPath: String(row.blueprint_path),
      projectRoot: String(row.project_root),
      blueprintJson: String(row.blueprint_json),
      planJson: String(row.plan_json),
      bundleJson: String(row.bundle_json),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      isActive: Boolean(row.is_active)
    });
  }

  async saveGeneratedBlueprintRecord(
    record: PersistedGeneratedBlueprintRecord
  ): Promise<void> {
    const parsed = PersistedGeneratedBlueprintRecordSchema.parse(record);
    await this.ensureSchema();
    await this.sql`
      INSERT INTO construct_blueprints (
        session_id,
        goal,
        blueprint_id,
        blueprint_path,
        project_root,
        blueprint_json,
        plan_json,
        bundle_json,
        created_at,
        updated_at,
        is_active
      )
      VALUES (
        ${parsed.sessionId},
        ${parsed.goal},
        ${parsed.blueprintId},
        ${parsed.blueprintPath},
        ${parsed.projectRoot},
        ${parsed.blueprintJson},
        ${parsed.planJson},
        ${parsed.bundleJson},
        ${parsed.createdAt},
        ${parsed.updatedAt},
        ${parsed.isActive}
      )
      ON CONFLICT (session_id) DO UPDATE SET
        goal = EXCLUDED.goal,
        blueprint_id = EXCLUDED.blueprint_id,
        blueprint_path = EXCLUDED.blueprint_path,
        project_root = EXCLUDED.project_root,
        blueprint_json = EXCLUDED.blueprint_json,
        plan_json = EXCLUDED.plan_json,
        bundle_json = EXCLUDED.bundle_json,
        updated_at = EXCLUDED.updated_at,
        is_active = EXCLUDED.is_active
    `;
  }

  private async readStateValue(key: string): Promise<string | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT value_json
      FROM construct_state
      WHERE key = ${key}
      LIMIT 1
    `;
    const row = rows[0] as { value_json?: string } | undefined;
    return typeof row?.value_json === "string" ? row.value_json : null;
  }

  private async writeStateValue(key: string, valueJson: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO construct_state (key, value_json, updated_at)
      VALUES (${key}, ${valueJson}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value_json = EXCLUDED.value_json,
        updated_at = NOW()
    `;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = this.initializeSchema();
    }

    await this.schemaReadyPromise;
  }

  private async initializeSchema(): Promise<void> {
    this.logger.info("Ensuring Neon persistence schema.", {
      backend: "neon"
    });

    await this.sql`
      CREATE TABLE IF NOT EXISTS construct_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS construct_blueprints (
        session_id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        blueprint_id TEXT NOT NULL,
        blueprint_path TEXT NOT NULL,
        project_root TEXT NOT NULL,
        blueprint_json TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        bundle_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT FALSE
      )
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS construct_blueprints_active_idx
      ON construct_blueprints (is_active)
    `;
  }
}

function resolveStorageBackend(): StorageBackend {
  const configuredBackend = process.env.CONSTRUCT_STORAGE_BACKEND?.trim().toLowerCase();

  if (configuredBackend === "local" || configuredBackend === "neon") {
    return configuredBackend;
  }

  return process.env.DATABASE_URL?.trim() ? "neon" : "local";
}

function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}
