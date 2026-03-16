import type {
  AgentEvent,
  BlueprintDeepDiveRequest,
  BlueprintDeepDiveResponse,
  AgentJobCreatedResponse,
  AgentJobSnapshot,
  BlueprintEnvelope,
  CurrentPlanningSessionResponse,
  LearnerProfileResponse,
  LearnerModel,
  ProjectSelectionResponse,
  ProjectsDashboardResponse,
  PlanningAnswer,
  PlanningSessionCompleteResponse,
  PlanningSessionStartResponse,
  RuntimeGuideRequest,
  RuntimeGuideResponse,
  RunnerHealth,
  TaskProgress,
  TaskResult,
  TaskStartResponse,
  TaskSubmitResponse,
  TaskTelemetry,
  WorkspaceFileEnvelope,
  WorkspaceFilesEnvelope
} from "../types";

export const RUNNER_BASE_URL = "http://127.0.0.1:43110";

export async function fetchRunnerHealth(signal?: AbortSignal): Promise<RunnerHealth> {
  return getJson<RunnerHealth>("/health", { signal });
}

export async function fetchBlueprint(signal?: AbortSignal): Promise<BlueprintEnvelope> {
  return getJson<BlueprintEnvelope>("/blueprint/current", { signal });
}

export async function fetchProjectsDashboard(
  signal?: AbortSignal
): Promise<ProjectsDashboardResponse> {
  return getJson<ProjectsDashboardResponse>("/projects", { signal });
}

export async function selectProject(projectId: string): Promise<ProjectSelectionResponse> {
  return postJson<ProjectSelectionResponse>("/projects/select", { projectId }, "selecting project");
}

export async function syncCurrentProjectStep(stepId: string): Promise<void> {
  const response = await fetch(`${RUNNER_BASE_URL}/projects/current-step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stepId
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while syncing ${stepId}.`);
  }
}

export async function fetchCurrentPlanningState(
  signal?: AbortSignal
): Promise<CurrentPlanningSessionResponse> {
  return getJson<CurrentPlanningSessionResponse>("/agent/planning/current", { signal });
}

export async function startPlanningSession(input: {
  goal: string;
  learningStyle: "concept-first" | "build-first" | "example-first";
}, onEvent?: (event: AgentEvent) => void): Promise<PlanningSessionStartResponse> {
  return runAgentJob<PlanningSessionStartResponse>(
    "/agent/planning/start-job",
    input,
    onEvent
  );
}

export async function completePlanningSession(input: {
  sessionId: string;
  answers: PlanningAnswer[];
}, onEvent?: (event: AgentEvent) => void): Promise<PlanningSessionCompleteResponse> {
  return runAgentJob<PlanningSessionCompleteResponse>(
    "/agent/planning/complete-job",
    input,
    onEvent
  );
}

export async function requestRuntimeGuide(
  input: RuntimeGuideRequest,
  onEvent?: (event: AgentEvent) => void
): Promise<RuntimeGuideResponse> {
  return runAgentJob<RuntimeGuideResponse>("/agent/runtime/guide-job", input, onEvent);
}

export async function requestBlueprintDeepDive(
  input: BlueprintDeepDiveRequest,
  onEvent?: (event: AgentEvent) => void
): Promise<BlueprintDeepDiveResponse> {
  return runAgentJob<BlueprintDeepDiveResponse>(
    "/agent/blueprint/deepen-job",
    input,
    onEvent
  );
}

export async function fetchWorkspaceFiles(
  signal?: AbortSignal
): Promise<WorkspaceFilesEnvelope> {
  return getJson<WorkspaceFilesEnvelope>("/workspace/files", { signal });
}

export async function fetchWorkspaceFile(
  filePath: string,
  signal?: AbortSignal
): Promise<WorkspaceFileEnvelope> {
  const encodedPath = encodeURIComponent(filePath);
  return getJson<WorkspaceFileEnvelope>(`/workspace/file?path=${encodedPath}`, { signal });
}

export async function saveWorkspaceFile(
  filePath: string,
  content: string
): Promise<void> {
  const response = await fetch(`${RUNNER_BASE_URL}/workspace/file`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      path: filePath,
      content
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while saving ${filePath}.`);
  }
}

export async function executeBlueprintTask(
  blueprintPath: string,
  stepId: string
): Promise<TaskResult> {
  const response = await fetch(`${RUNNER_BASE_URL}/tasks/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      blueprintPath,
      stepId
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while executing ${stepId}.`);
  }

  return parseJsonResponse<TaskResult>(response, `executing ${stepId}`);
}

export async function startBlueprintTask(
  blueprintPath: string,
  stepId: string
): Promise<TaskStartResponse> {
  const response = await fetch(`${RUNNER_BASE_URL}/tasks/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      blueprintPath,
      stepId
    })
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while starting ${stepId}.`);
  }

  return parseJsonResponse<TaskStartResponse>(response, `starting ${stepId}`);
}

export async function submitBlueprintTask(input: {
  blueprintPath: string;
  stepId: string;
  sessionId: string;
  telemetry: TaskTelemetry;
  timeoutMs?: number;
}): Promise<TaskSubmitResponse> {
  const response = await fetch(`${RUNNER_BASE_URL}/tasks/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while submitting ${input.stepId}.`);
  }

  return parseJsonResponse<TaskSubmitResponse>(response, `submitting ${input.stepId}`);
}

export async function fetchTaskProgress(
  stepId: string,
  signal?: AbortSignal
): Promise<TaskProgress> {
  const encodedStepId = encodeURIComponent(stepId);
  return getJson<TaskProgress>(`/tasks/progress?stepId=${encodedStepId}`, { signal });
}

export async function fetchLearnerModel(signal?: AbortSignal): Promise<LearnerModel> {
  return getJson<LearnerModel>("/learner/model", { signal });
}

export async function fetchLearnerProfile(
  signal?: AbortSignal
): Promise<LearnerProfileResponse> {
  return getJson<LearnerProfileResponse>("/learner/profile", { signal });
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RUNNER_BASE_URL}${path}`, init);

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} for ${path}.`);
  }

  return parseJsonResponse<T>(response, path);
}

async function runAgentJob<T>(
  path: string,
  input: unknown,
  onEvent?: (event: AgentEvent) => void
): Promise<T> {
  const created = await postJson<AgentJobCreatedResponse>(path, input, `starting ${path}`);

  return new Promise<T>((resolve, reject) => {
    const stream = new EventSource(`${RUNNER_BASE_URL}${created.streamPath}`);
    let settled = false;
    let recoveryInFlight = false;

    const settleFromSnapshot = (snapshot: AgentJobSnapshot) => {
      if (settled) {
        return;
      }

      if (snapshot.status === "completed") {
        settled = true;
        window.clearInterval(intervalHandle);
        stream.close();
        resolve(snapshot.result as T);
        return;
      }

      if (snapshot.status === "failed") {
        fail(new Error(snapshot.error ?? "Agent job failed."));
      }
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearInterval(intervalHandle);
      stream.close();
      reject(error);
    };

    const intervalHandle = window.setInterval(() => {
      if (settled || recoveryInFlight) {
        return;
      }

      recoveryInFlight = true;
      void recoverAgentJob(created)
        .then((snapshot) => {
          settleFromSnapshot(snapshot);
        })
        .catch(() => {
          // Ignore polling misses while the stream remains open.
        })
        .finally(() => {
          recoveryInFlight = false;
        });
    }, 1_000);

    stream.addEventListener("agent-event", (event) => {
      try {
        onEvent?.(JSON.parse((event as MessageEvent).data) as AgentEvent);
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Failed to parse agent event stream.")
        );
      }
    });

    stream.addEventListener("agent-state", (event) => {
      try {
        settleFromSnapshot(
          JSON.parse((event as MessageEvent).data) as AgentJobSnapshot
        );
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Failed to parse agent state stream.")
        );
      }
    });

    stream.addEventListener("agent-complete", (event) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearInterval(intervalHandle);
      stream.close();
      resolve((JSON.parse((event as MessageEvent).data) as { result: T }).result);
    });

    stream.addEventListener("agent-error", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { error?: string };
      fail(new Error(data.error ?? "Agent job failed."));
    });

    stream.addEventListener("agent-end", () => {
      if (settled) {
        return;
      }

      void recoverAgentJob(created)
        .then(settleFromSnapshot)
        .catch((error) => {
          fail(
            error instanceof Error
              ? error
              : new Error("Agent stream ended before completion.")
          );
        });
    });

    stream.onerror = () => {
      if (settled) {
        return;
      }

      void recoverAgentJob(created)
        .then((snapshot) => {
          settleFromSnapshot(snapshot);

          if (!settled) {
            fail(new Error(snapshot.error ?? "Agent stream disconnected before completion."));
          }
        })
        .catch((error) => {
          fail(
            error instanceof Error
              ? error
              : new Error("Agent stream disconnected before completion.")
          );
        });
    };
  });
}

async function recoverAgentJob(
  created: AgentJobCreatedResponse
): Promise<AgentJobSnapshot> {
  return getJson<AgentJobSnapshot>(created.resultPath);
}

async function postJson<T>(
  path: string,
  input: unknown,
  context: string
): Promise<T> {
  const response = await fetch(`${RUNNER_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} while ${context}.`);
  }

  return parseJsonResponse<T>(response, context);
}

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  const rawBody = await response.text();

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    const bodyPreview = rawBody.trim().slice(0, 180) || "<empty body>";
    throw new Error(`Runner returned a non-JSON response while ${context}: ${bodyPreview}`);
  }
}
