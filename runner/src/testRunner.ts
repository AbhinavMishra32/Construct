import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  BlueprintTaskRequestSchema,
  ProjectBlueprintSchema,
  TaskExecutionRequestSchema,
  TaskResultSchema,
  type BlueprintTaskRequest,
  type ProjectBlueprint,
  type TaskExecutionRequest,
  type TaskFailure,
  type TaskResult,
  type TestAdapterKind
} from "@construct/shared";

const DEFAULT_TIMEOUT_MS = 30_000;
const JEST_CONFIG_CANDIDATES = [
  "jest.config.cjs",
  "jest.config.js",
  "jest.config.mjs",
  "jest.config.ts",
  "jest.config.json"
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultBlueprintPath = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "project-blueprint.json"
);

interface TestAdapter {
  readonly kind: TestAdapterKind;
  run(request: TaskExecutionRequest): Promise<TaskResult>;
}

interface JestJsonAssertionResult {
  ancestorTitles?: string[];
  failureMessages?: string[];
  fullName?: string;
  status?: string;
  title?: string;
}

interface JestJsonTestResult {
  assertionResults?: JestJsonAssertionResult[];
  message?: string;
  name: string;
  status?: string;
}

interface JestJsonOutput {
  numFailedTests?: number;
  testResults?: JestJsonTestResult[];
}

export class BlueprintResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintResolutionError";
  }
}

export class UnsupportedAdapterError extends Error {
  constructor(adapter: string) {
    super(`No test adapter is registered for ${adapter}.`);
    this.name = "UnsupportedAdapterError";
  }
}

export class JestTestAdapter implements TestAdapter {
  readonly kind = "jest" as const;

  async run(request: TaskExecutionRequest): Promise<TaskResult> {
    const normalizedRequest = normalizeTaskExecutionRequest(request);
    const testsRun = normalizedRequest.tests.map((testPath) =>
      path.relative(normalizedRequest.projectRoot, testPath) || path.basename(testPath)
    );
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "construct-jest-results-"));
    const outputFile = path.join(outputDirectory, "results.json");
    const jestBinaryPath = findUpwardPath(
      normalizedRequest.projectRoot,
      path.join("node_modules", "jest", "bin", "jest.js")
    );
    const jestConfigPath = findFirstExistingPath(
      normalizedRequest.projectRoot,
      JEST_CONFIG_CANDIDATES
    );

    if (!jestBinaryPath) {
      throw new BlueprintResolutionError(
        `Unable to locate a Jest binary from ${normalizedRequest.projectRoot}.`
      );
    }

    const jestArguments = [jestBinaryPath];

    if (jestConfigPath) {
      jestArguments.push("--config", jestConfigPath);
    }

    jestArguments.push(
      "--runInBand",
      "--json",
      "--outputFile",
      outputFile,
      "--runTestsByPath",
      ...normalizedRequest.tests
    );

    const startedAt = Date.now();
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;

    try {
      const child = spawn(process.execPath, jestArguments, {
        cwd: normalizedRequest.projectRoot,
        env: {
          ...process.env,
          CI: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      exitCode = await new Promise<number | null>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
        }, normalizedRequest.timeoutMs);

        timeoutHandle.unref();

        child.once("error", (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });

        child.once("close", (code) => {
          clearTimeout(timeoutHandle);
          resolve(code);
        });
      });

      const failures = await this.collectFailures(
        outputFile,
        normalizedRequest,
        stderr,
        timedOut,
        exitCode
      );
      const status = !timedOut && exitCode === 0 ? "passed" : "failed";

      return TaskResultSchema.parse({
        stepId: normalizedRequest.stepId,
        adapter: this.kind,
        status,
        durationMs: Date.now() - startedAt,
        testsRun,
        failures,
        exitCode,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  }

  private async collectFailures(
    outputFile: string,
    request: TaskExecutionRequest,
    stderr: string,
    timedOut: boolean,
    exitCode: number | null
  ): Promise<TaskFailure[]> {
    const jsonOutput = await readJestJsonOutput(outputFile);
    const failures: TaskFailure[] = [];

    for (const testResult of jsonOutput?.testResults ?? []) {
      const assertionFailures =
        testResult.assertionResults?.filter((assertion) => assertion.status === "failed") ?? [];

      if (assertionFailures.length > 0) {
        for (const assertionFailure of assertionFailures) {
          const stackTrace = assertionFailure.failureMessages?.join("\n").trim();
          failures.push({
            testName:
              assertionFailure.fullName ??
              assertionFailure.title ??
              path.basename(testResult.name),
            message: summarizeFailureMessage(
              stackTrace ?? testResult.message ?? "The Jest assertion failed."
            ),
            stackTrace
          });
        }

        continue;
      }

      if (testResult.status === "failed" && testResult.message) {
        failures.push({
          testName: path.basename(testResult.name),
          message: summarizeFailureMessage(testResult.message),
          stackTrace: testResult.message.trim()
        });
      }
    }

    if (failures.length > 0) {
      return failures;
    }

    if (timedOut) {
      return [
        {
          testName: request.stepId,
          message: `The Jest process timed out after ${request.timeoutMs}ms.`,
          stackTrace: stderr.trim() || undefined
        }
      ];
    }

    if (exitCode !== 0 && stderr.trim()) {
      return [
        {
          testName: request.stepId,
          message: summarizeFailureMessage(stderr),
          stackTrace: stderr.trim()
        }
      ];
    }

    return [];
  }
}

export class TestRunnerManager {
  private readonly adapters: Map<TestAdapterKind, TestAdapter>;

  constructor(adapters: TestAdapter[] = [new JestTestAdapter()]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.kind, adapter]));
  }

  async runTask(request: TaskExecutionRequest): Promise<TaskResult> {
    const normalizedRequest = normalizeTaskExecutionRequest(request);
    const adapter = this.adapters.get(normalizedRequest.adapter);

    if (!adapter) {
      throw new UnsupportedAdapterError(normalizedRequest.adapter);
    }

    return adapter.run(normalizedRequest);
  }

  async runBlueprintStep(request: BlueprintTaskRequest): Promise<TaskResult> {
    const executionRequest = await resolveBlueprintStepRequest(request);
    return this.runTask(executionRequest);
  }

  async runBlueprintSuite(options?: {
    blueprintPath?: string;
    timeoutMs?: number;
  }): Promise<TaskResult> {
    const blueprintPath = path.resolve(options?.blueprintPath ?? defaultBlueprintPath);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const blueprint = await loadBlueprint(blueprintPath);
    const tests = await discoverBlueprintSuiteTests(path.dirname(blueprintPath), blueprint);

    return this.runTask({
      stepId: "blueprint.all",
      adapter: inferAdapterFromBlueprint(blueprint),
      projectRoot: path.dirname(blueprintPath),
      tests,
      timeoutMs
    });
  }
}

export async function resolveBlueprintStepRequest(
  request: BlueprintTaskRequest
): Promise<TaskExecutionRequest> {
  const parsedRequest = BlueprintTaskRequestSchema.parse({
    ...request,
    blueprintPath: path.resolve(request.blueprintPath)
  });
  const blueprint = await loadBlueprint(parsedRequest.blueprintPath);
  const step = blueprint.steps.find((candidate) => candidate.id === parsedRequest.stepId);

  if (!step) {
    throw new BlueprintResolutionError(
      `Step ${parsedRequest.stepId} was not found in blueprint ${blueprint.id}.`
    );
  }

  return TaskExecutionRequestSchema.parse({
    stepId: step.id,
    adapter: inferAdapterFromBlueprint(blueprint),
    projectRoot: path.dirname(parsedRequest.blueprintPath),
    tests: step.tests,
    timeoutMs: parsedRequest.timeoutMs
  });
}

export async function loadBlueprint(blueprintPath: string): Promise<ProjectBlueprint> {
  const rawBlueprint = await readFile(blueprintPath, "utf8");
  return ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));
}

function inferAdapterFromBlueprint(blueprint: ProjectBlueprint): TestAdapterKind {
  switch (blueprint.language) {
    case "javascript":
    case "typescript":
      return "jest";
    default:
      throw new BlueprintResolutionError(
        `No adapter mapping exists yet for blueprint language ${blueprint.language}.`
      );
  }
}

function normalizeTaskExecutionRequest(request: TaskExecutionRequest): TaskExecutionRequest {
  const parsedRequest = TaskExecutionRequestSchema.parse(request);
  const projectRoot = resolveToRealPath(parsedRequest.projectRoot);

  return {
    ...parsedRequest,
    projectRoot,
    tests: parsedRequest.tests.map((testPath) =>
      resolveToRealPath(path.resolve(projectRoot, testPath))
    )
  };
}

async function readJestJsonOutput(outputFile: string): Promise<JestJsonOutput | null> {
  if (!existsSync(outputFile)) {
    return null;
  }

  const rawOutput = await readFile(outputFile, "utf8");
  return JSON.parse(rawOutput) as JestJsonOutput;
}

async function discoverBlueprintSuiteTests(
  projectRoot: string,
  blueprint: ProjectBlueprint
): Promise<string[]> {
  const testsDirectory = path.join(projectRoot, "tests");

  if (!existsSync(testsDirectory)) {
    return Array.from(new Set(blueprint.steps.flatMap((step) => step.tests)));
  }

  const discoveredFiles: string[] = [];
  await walkDirectory(testsDirectory, async (filePath) => {
    discoveredFiles.push(path.relative(projectRoot, filePath));
  });

  discoveredFiles.sort((left, right) => left.localeCompare(right));
  return discoveredFiles;
}

function summarizeFailureMessage(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] ?? "Test execution failed.";
}

async function walkDirectory(
  directoryPath: string,
  onFile: (filePath: string) => Promise<void>
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(entryPath, onFile);
      continue;
    }

    if (entry.isFile()) {
      await onFile(entryPath);
    }
  }
}

function findFirstExistingPath(rootDirectory: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const candidatePath = path.join(rootDirectory, candidate);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function findUpwardPath(startDirectory: string, relativePath: string): string | undefined {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const candidatePath = path.join(currentDirectory, relativePath);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    const nextDirectory = path.dirname(currentDirectory);

    if (nextDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = nextDirectory;
  }
}

function resolveToRealPath(candidatePath: string): string {
  const resolvedPath = path.resolve(candidatePath);

  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

async function runFromCli(): Promise<void> {
  const parsedArguments = parseArgs({
    args: process.argv.slice(2),
    options: {
      all: {
        type: "boolean",
        default: false
      },
      blueprint: {
        type: "string"
      },
      step: {
        type: "string"
      },
      timeout: {
        type: "string"
      }
    }
  });

  const timeoutMs = parsedArguments.values.timeout
    ? Number(parsedArguments.values.timeout)
    : DEFAULT_TIMEOUT_MS;
  const testRunner = new TestRunnerManager();

  const result = parsedArguments.values.all
    ? await testRunner.runBlueprintSuite({
        blueprintPath: parsedArguments.values.blueprint ?? defaultBlueprintPath,
        timeoutMs
      })
    : await testRunner.runBlueprintStep({
        blueprintPath: parsedArguments.values.blueprint ?? defaultBlueprintPath,
        stepId: parsedArguments.values.step ?? "step.state-merge",
        timeoutMs
      });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "passed" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
