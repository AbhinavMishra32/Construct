import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_NAME,
  AgentJobSnapshotSchema,
  BlueprintDeepDiveRequestSchema,
  BlueprintTaskRequestSchema,
  CheckReviewRequestSchema,
  CheckReviewResponseSchema,
  getBlueprintVisibleFilePaths,
  LearnerProfileResponseSchema,
  ProjectCurrentStepRequestSchema,
  ProjectSelectionRequestSchema,
  PlanningSessionCompleteRequestSchema,
  PlanningSessionStartRequestSchema,
  RuntimeGuideRequestSchema,
  TaskStartRequestSchema,
  TaskSubmitRequestSchema
} from "@construct/shared";

import { ConstructAgentService } from "./agentService";
import { WorkspaceFileManager } from "./fileManager";
import { SnapshotService } from "./snapshots";
import { TaskLifecycleService } from "./taskLifecycle";
import {
  BlueprintResolutionError,
  TestRunnerManager,
  loadBlueprint
} from "./testRunner";
import { getDefaultBlueprintPath } from "./activeBlueprint";
import { prepareLearnerWorkspace } from "./workspaceMaterializer";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadRunnerEnvironment(rootDir);

const port = Number(process.env.CONSTRUCT_RUNNER_PORT ?? 43110);
const testRunner = new TestRunnerManager();
let constructAgent: ConstructAgentService | null = null;
let workspaceContextPromise: Promise<WorkspaceContext> | null = null;
let workspaceContextBlueprintPath = "";

function getConstructAgent(): ConstructAgentService {
  if (!constructAgent) {
    constructAgent = new ConstructAgentService(rootDir);
  }

  return constructAgent;
}

type WorkspaceContext = {
  canonicalBlueprintPath: string;
  learnerBlueprintPath: string;
  workspaceRoot: string;
  workspaceFileManager: WorkspaceFileManager;
  taskLifecycle: TaskLifecycleService;
};

function invalidateWorkspaceContext(): void {
  workspaceContextPromise = null;
  workspaceContextBlueprintPath = "";
}

async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const canonicalBlueprintPath = await getConstructAgent().getActiveBlueprintPath();

  if (!canonicalBlueprintPath) {
    invalidateWorkspaceContext();
    return null;
  }

  if (
    workspaceContextPromise &&
    workspaceContextBlueprintPath === canonicalBlueprintPath
  ) {
    return workspaceContextPromise;
  }

  workspaceContextBlueprintPath = canonicalBlueprintPath;
  workspaceContextPromise = createWorkspaceContext(canonicalBlueprintPath);
  return workspaceContextPromise;
}

async function createWorkspaceContext(
  canonicalBlueprintPath: string
): Promise<WorkspaceContext> {
  const preparedWorkspace = await prepareLearnerWorkspace(canonicalBlueprintPath);
  const workspaceFileManager = new WorkspaceFileManager(preparedWorkspace.learnerWorkspaceRoot, {
    ignoredDirectories: ["test-fixtures", "tests", "__tests__"],
    ignoredFiles: ["project-blueprint.json"],
    visibleFiles: getBlueprintVisibleFilePaths(preparedWorkspace.blueprint)
  });
  const snapshotService = new SnapshotService(preparedWorkspace.learnerWorkspaceRoot);
  const taskLifecycle = new TaskLifecycleService(preparedWorkspace.learnerWorkspaceRoot, {
    snapshotService,
    testRunner
  });

  return {
    canonicalBlueprintPath,
    learnerBlueprintPath: preparedWorkspace.learnerBlueprintPath,
    workspaceRoot: preparedWorkspace.learnerWorkspaceRoot,
    workspaceFileManager,
    taskLifecycle
  };
}

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ready",
          service: `${APP_NAME} Runner`,
          port,
          debugMode: isDebugModeEnabled(),
          debugBlueprintsPath: isDebugModeEnabled() ? "#/debug/blueprints" : null,
          langSmithEnabled: isLangSmithEnabled(),
          langSmithProject: resolveLangSmithProjectName()
        })
      );
      return;
    }

    if (request.method === "GET" && request.url === "/debug/blueprints") {
      assertDebugModeEnabled();
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          builds: await getConstructAgent().listBlueprintBuilds()
        })
      );
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/debug/blueprints/")) {
      assertDebugModeEnabled();
      const url = new URL(request.url, "http://127.0.0.1");
      const pathParts = url.pathname.split("/").filter(Boolean);
      const [, , buildId, action] = pathParts;

      if (!buildId) {
        throw new Error("Missing blueprint build id.");
      }

      if (action === "stream") {
        await getConstructAgent().openBlueprintBuildStream(buildId, response);
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(await getConstructAgent().getBlueprintBuildDetail(buildId)));
      return;
    }

    if (request.method === "GET" && request.url === "/agent/planning/current") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(await getConstructAgent().getCurrentPlanningState()));
      return;
    }

    if (request.method === "GET" && request.url === "/projects") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(await getConstructAgent().listProjectsDashboard()));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/agent/jobs/")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathParts = url.pathname.split("/").filter(Boolean);
      const [, , jobId, action] = pathParts;

      if (!jobId) {
        throw new Error("Missing agent job id.");
      }

      if (action === "stream") {
        getConstructAgent().openJobStream(jobId, response);
        return;
      }

      const job = AgentJobSnapshotSchema.parse(getConstructAgent().getJob(jobId));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(job));
      return;
    }

    if (request.method === "GET" && request.url === "/blueprint/current") {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            blueprint: null,
            workspaceRoot: "",
            blueprintPath: "",
            canonicalBlueprintPath: null,
            defaultBlueprintPath: getDefaultBlueprintPath(rootDir),
            hasActiveBlueprint: false
          })
        );
        return;
      }

      const blueprint = await loadBlueprint(workspaceContext.learnerBlueprintPath);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          blueprint,
          workspaceRoot: workspaceContext.workspaceRoot,
          blueprintPath: workspaceContext.learnerBlueprintPath,
          canonicalBlueprintPath: workspaceContext.canonicalBlueprintPath,
          defaultBlueprintPath: getDefaultBlueprintPath(rootDir),
          hasActiveBlueprint: true
        })
      );
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/workspace/files")) {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            root: "",
            files: []
          })
        );
        return;
      }

      const files = await workspaceContext.workspaceFileManager.listFiles();

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          root: workspaceContext.workspaceRoot,
          files
        })
      );
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/workspace/file")) {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        throw new Error("No active generated blueprint. Start planning first.");
      }

      const relativePath = getRequiredQueryParam(request.url, "path");
      const content = await workspaceContext.workspaceFileManager.readFile(relativePath);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          path: relativePath,
          content
        })
      );
      return;
    }

    if (request.method === "POST" && request.url === "/agent/planning/start-job") {
      const body = await readRequestBody(request);
      const startRequest = PlanningSessionStartRequestSchema.parse(JSON.parse(body));
      const job = getConstructAgent().createPlanningQuestionsJob(startRequest);

      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify(job));
      return;
    }

    if (request.method === "POST" && request.url === "/agent/planning/complete-job") {
      const body = await readRequestBody(request);
      const completeRequest = PlanningSessionCompleteRequestSchema.parse(JSON.parse(body));
      const job = getConstructAgent().createPlanningPlanJob(completeRequest);

      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify(job));
      return;
    }

    if (request.method === "POST" && request.url === "/agent/runtime/guide-job") {
      const body = await readRequestBody(request);
      const guideRequest = RuntimeGuideRequestSchema.parse(JSON.parse(body));
      const job = getConstructAgent().createRuntimeGuideJob(guideRequest);

      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify(job));
      return;
    }

    if (request.method === "POST" && request.url === "/agent/blueprint/deepen-job") {
      const body = await readRequestBody(request);
      const deepDiveRequest = BlueprintDeepDiveRequestSchema.parse(JSON.parse(body));
      const job = getConstructAgent().createBlueprintDeepDiveJob(deepDiveRequest);

      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify(job));
      return;
    }

    if (request.method === "POST" && request.url === "/projects/select") {
      const body = await readRequestBody(request);
      const selectionRequest = ProjectSelectionRequestSchema.parse(JSON.parse(body));
      const selection = await getConstructAgent().selectProject(selectionRequest.projectId);
      invalidateWorkspaceContext();

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(selection));
      return;
    }

    if (request.method === "POST" && request.url === "/projects/current-step") {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        throw new Error("No active generated project. Select or create a project first.");
      }

      const body = await readRequestBody(request);
      const currentStepRequest = ProjectCurrentStepRequestSchema.parse(JSON.parse(body));
      await getConstructAgent().syncProjectStepSelection(
        workspaceContext.canonicalBlueprintPath,
        currentStepRequest.stepId
      );

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, stepId: currentStepRequest.stepId }));
      return;
    }

    if (request.method === "POST" && request.url === "/workspace/file") {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        throw new Error("No active generated blueprint. Start planning first.");
      }

      const body = JSON.parse(await readRequestBody(request)) as {
        path?: string;
        content?: string;
      };

      if (typeof body.path !== "string" || typeof body.content !== "string") {
        throw new Error("A workspace path and string content are required.");
      }

      await workspaceContext.workspaceFileManager.writeFile(body.path, body.content);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          path: body.path
        })
      );
      return;
    }

    if (request.method === "POST" && request.url === "/tasks/execute") {
      const body = await readRequestBody(request);
      const executionRequest = BlueprintTaskRequestSchema.parse(JSON.parse(body));
      const taskResult = await testRunner.runBlueprintStep(executionRequest);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(taskResult));
      return;
    }

    if (request.method === "POST" && request.url === "/tasks/start") {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        throw new Error("No active generated blueprint. Start planning first.");
      }

      const body = await readRequestBody(request);
      const startRequest = TaskStartRequestSchema.parse(JSON.parse(body));
      const taskSession = await workspaceContext.taskLifecycle.startTask(startRequest);
      await getConstructAgent().syncProjectTaskProgress({
        canonicalBlueprintPath: workspaceContext.canonicalBlueprintPath,
        stepId: startRequest.stepId
      });

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(taskSession));
      return;
    }

    if (request.method === "POST" && request.url === "/tasks/submit") {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        throw new Error("No active generated blueprint. Start planning first.");
      }

      const body = await readRequestBody(request);
      const submitRequest = TaskSubmitRequestSchema.parse(JSON.parse(body));
      const taskSubmission = await workspaceContext.taskLifecycle.submitTask(submitRequest);
      const frontierUpdated = await getConstructAgent().syncProjectTaskProgress({
        canonicalBlueprintPath: workspaceContext.canonicalBlueprintPath,
        stepId: submitRequest.stepId,
        markStepCompleted: taskSubmission.attempt.status === "passed",
        lastAttemptStatus: taskSubmission.attempt.status,
        telemetry: taskSubmission.attempt.telemetry
      });

      if (frontierUpdated) {
        invalidateWorkspaceContext();
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(taskSubmission));
      return;
    }

    if (request.method === "POST" && request.url === "/checks/review") {
      const body = await readRequestBody(request);
      const reviewRequest = CheckReviewRequestSchema.parse(JSON.parse(body));
      const review = CheckReviewResponseSchema.parse(
        await getConstructAgent().reviewCheck(reviewRequest)
      );

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(review));
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/tasks/progress")) {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            stepId: getRequiredQueryParam(request.url, "stepId"),
            totalAttempts: 0,
            activeSession: null,
            latestAttempt: null
          })
        );
        return;
      }

      const stepId = getRequiredQueryParam(request.url, "stepId");
      const progress = await workspaceContext.taskLifecycle.getTaskProgress(
        stepId,
        workspaceContext.learnerBlueprintPath
      );

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(progress));
      return;
    }

    if (request.method === "GET" && request.url === "/learner/model") {
      const workspaceContext = await getWorkspaceContext();

      if (!workspaceContext) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            skills: {},
            history: [],
            hintsUsed: {},
            reflections: {}
          })
        );
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(await workspaceContext.taskLifecycle.getLearnerModel()));
      return;
    }

    if (request.method === "GET" && request.url === "/learner/profile") {
      const workspaceContext = await getWorkspaceContext();
      const learnerModel = workspaceContext
        ? await workspaceContext.taskLifecycle.getLearnerModel()
        : null;

      const profile = LearnerProfileResponseSchema.parse(
        await getConstructAgent().getLearnerProfile(learnerModel)
      );
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(profile));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found." }));
  } catch (error) {
    console.error(
      `[construct-runner] ${request.method ?? "UNKNOWN"} ${request.url ?? "<unknown>"}`,
      error
    );

    if (response.headersSent || response.writableEnded || response.destroyed) {
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
      return;
    }

    const statusCode =
      error instanceof SyntaxError ||
      error instanceof BlueprintResolutionError ||
      (error instanceof Error && error.name === "ZodError")
        ? 400
        : 500;

    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unexpected runner error."
      })
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`${APP_NAME} runner listening on http://127.0.0.1:${port}`);
});

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });
}

function getRequiredQueryParam(requestUrl: string, key: string): string {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const value = url.searchParams.get(key);

  if (!value) {
    throw new Error(`Missing query parameter: ${key}.`);
  }

  return value;
}

function loadRunnerEnvironment(projectRoot: string): void {
  if (typeof process.loadEnvFile !== "function") {
    return;
  }

  for (const fileName of [".env", ".env.local"]) {
    const envPath = path.join(projectRoot, fileName);

    try {
      process.loadEnvFile(envPath);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        console.warn(`[construct-runner] Failed to load ${fileName}`, error);
      }
    }
  }
}

function isDebugModeEnabled(): boolean {
  return (
    /^(1|true|yes|on)$/i.test(process.env.CONSTRUCT_DEBUG_MODE?.trim() ?? "") ||
    Number.parseInt(process.env.CONSTRUCT_DEBUG_LEVEL?.trim() ?? "1", 10) >= 2
  );
}

function assertDebugModeEnabled(): void {
  if (!isDebugModeEnabled()) {
    throw new Error("Debug mode is disabled. Set CONSTRUCT_DEBUG_MODE=1 to inspect blueprint builds.");
  }
}

function isLangSmithEnabled(): boolean {
  const tracingFlag =
    process.env.CONSTRUCT_LANGSMITH_ENABLED?.trim() ||
    process.env.LANGSMITH_TRACING?.trim() ||
    process.env.LANGCHAIN_TRACING_V2?.trim() ||
    "";
  const apiKey =
    process.env.LANGSMITH_API_KEY?.trim() ||
    process.env.LANGCHAIN_API_KEY?.trim() ||
    "";

  return Boolean(apiKey) && /^(1|true|yes|on)$/i.test(tracingFlag);
}

function resolveLangSmithProjectName(): string | null {
  if (!isLangSmithEnabled()) {
    return null;
  }

  return (
    process.env.CONSTRUCT_LANGSMITH_PROJECT?.trim() ||
    process.env.LANGSMITH_PROJECT?.trim() ||
    process.env.LANGCHAIN_PROJECT?.trim() ||
    "construct-project-creation"
  );
}
