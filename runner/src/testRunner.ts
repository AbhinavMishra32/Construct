import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sampleRoot = path.join(rootDir, "playbooks", "sample");
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const child = spawn(command, ["test", "--", "--runInBand"], {
  cwd: sampleRoot,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error("Failed to start the sample test runner.", error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

