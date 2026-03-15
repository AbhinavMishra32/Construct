import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_NAME, BlueprintTaskRequestSchema } from "@construct/shared";

import { WorkspaceFileManager } from "./fileManager";
import {
  BlueprintResolutionError,
  TestRunnerManager,
  loadBlueprint
} from "./testRunner";

const port = Number(process.env.CONSTRUCT_RUNNER_PORT ?? 43110);
const testRunner = new TestRunnerManager();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultBlueprintPath = path.join(
  rootDir,
  "blueprints",
  "workflow-runtime",
  "project-blueprint.json"
);
const workspaceRoot = path.dirname(defaultBlueprintPath);
const workspaceFileManager = new WorkspaceFileManager(workspaceRoot, {
  ignoredDirectories: ["test-fixtures"]
});

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
          port
        })
      );
      return;
    }

    if (request.method === "GET" && request.url === "/blueprint/current") {
      const blueprint = await loadBlueprint(defaultBlueprintPath);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          blueprint,
          workspaceRoot
        })
      );
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/workspace/files")) {
      const files = await workspaceFileManager.listFiles();

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          root: workspaceRoot,
          files
        })
      );
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/workspace/file")) {
      const relativePath = getRequiredQueryParam(request.url, "path");
      const content = await workspaceFileManager.readFile(relativePath);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          path: relativePath,
          content
        })
      );
      return;
    }

    if (request.method === "POST" && request.url === "/workspace/file") {
      const body = JSON.parse(await readRequestBody(request)) as {
        path?: string;
        content?: string;
      };

      if (typeof body.path !== "string" || typeof body.content !== "string") {
        throw new Error("A workspace path and string content are required.");
      }

      await workspaceFileManager.writeFile(body.path, body.content);

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

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found." }));
  } catch (error) {
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
