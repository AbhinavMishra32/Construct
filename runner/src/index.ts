import http from "node:http";

import { APP_NAME, BlueprintTaskRequestSchema } from "@construct/shared";

import { BlueprintResolutionError, TestRunnerManager } from "./testRunner";

const port = Number(process.env.CONSTRUCT_RUNNER_PORT ?? 43110);
const testRunner = new TestRunnerManager();

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
