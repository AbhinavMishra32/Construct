import http from "node:http";

import { APP_NAME } from "@construct/shared";

const port = Number(process.env.CONSTRUCT_RUNNER_PORT ?? 43110);

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/health") {
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

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found." }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`${APP_NAME} runner listening on http://127.0.0.1:${port}`);
});

