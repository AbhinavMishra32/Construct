import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceFileManager, WorkspacePathError } from "./fileManager";

test("WorkspaceFileManager reads, writes, creates, and lists files within the workspace", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "construct-file-manager-"));

  try {
    const fileManager = new WorkspaceFileManager(workspaceRoot);

    await fileManager.writeFile("src/index.ts", "export const phase = 2;\n");
    await fileManager.createFile("README.md", "# Construct Workspace\n");
    await mkdir(path.join(workspaceRoot, ".construct"), { recursive: true });
    await writeFile(path.join(workspaceRoot, ".construct", "internal.txt"), "ignored\n");

    await assert.rejects(
      fileManager.createFile("README.md", "# Duplicate\n"),
      /EEXIST/
    );

    assert.equal(await fileManager.readFile("src/index.ts"), "export const phase = 2;\n");
    assert.equal(await fileManager.exists("README.md"), true);

    const entries = await fileManager.listFiles();
    assert.deepEqual(
      entries.map((entry) => `${entry.kind}:${entry.path}`),
      ["file:README.md", "directory:src", "file:src/index.ts"]
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("WorkspaceFileManager rejects path escapes, including symlinks that resolve outside the workspace", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "construct-file-manager-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "construct-file-manager-outside-"));

  try {
    const fileManager = new WorkspaceFileManager(workspaceRoot);
    await writeFile(path.join(outsideRoot, "secret.txt"), "classified\n");
    await symlink(path.join(outsideRoot, "secret.txt"), path.join(workspaceRoot, "linked.txt"));

    await assert.rejects(
      fileManager.readFile("../secret.txt"),
      WorkspacePathError
    );

    await assert.rejects(fileManager.readFile("linked.txt"), WorkspacePathError);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

