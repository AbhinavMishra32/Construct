import type {
  BlueprintEnvelope,
  LearnerModel,
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

  return (await response.json()) as TaskResult;
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

  return (await response.json()) as TaskStartResponse;
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

  return (await response.json()) as TaskSubmitResponse;
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

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RUNNER_BASE_URL}${path}`, init);

  if (!response.ok) {
    throw new Error(`Runner responded with ${response.status} for ${path}.`);
  }

  return (await response.json()) as T;
}
