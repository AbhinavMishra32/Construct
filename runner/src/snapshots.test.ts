import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceFileManager } from "./fileManager";
import { SnapshotService } from "./snapshots";

test("SnapshotService commits, diffs, lists, and restores workspace state", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "construct-snapshots-"));

  try {
    const fileManager = new WorkspaceFileManager(workspaceRoot);
    const snapshots = new SnapshotService(workspaceRoot);

    await fileManager.writeFile("src/existing.ts", "export const version = 1;\n");
    await fileManager.writeFile("src/remove-me.ts", "export const removeMe = true;\n");

    const baselineSnapshot = await snapshots.commitSnapshot("Baseline snapshot");
    assert.match(baselineSnapshot.commitId, /^[0-9a-f]{40}$/);
    assert.equal(baselineSnapshot.message, "Baseline snapshot");

    await fileManager.writeFile("src/existing.ts", "export const version = 2;\n");
    await rm(path.join(workspaceRoot, "src", "remove-me.ts"));
    await fileManager.createFile("src/new-file.ts", "export const created = true;\n");

    const updatedSnapshot = await snapshots.commitSnapshot("Updated snapshot");
    const listedSnapshots = await snapshots.listSnapshots();
    const diffLines = await snapshots.diffSnapshot(updatedSnapshot.commitId);

    assert.equal(listedSnapshots.length, 2);
    assert.equal(listedSnapshots[0].message, "Updated snapshot");
    assert.equal(listedSnapshots[1].message, "Baseline snapshot");
    assert.ok(diffLines.some((line) => line.endsWith("src/existing.ts")));
    assert.ok(diffLines.some((line) => line.endsWith("src/new-file.ts")));
    assert.ok(diffLines.some((line) => line.endsWith("src/remove-me.ts")));

    await fileManager.writeFile("src/existing.ts", "export const version = 3;\n");
    await fileManager.createFile("notes.txt", "temporary\n");

    await snapshots.checkoutSnapshot(baselineSnapshot.commitId);

    assert.equal(await fileManager.readFile("src/existing.ts"), "export const version = 1;\n");
    assert.equal(
      await fileManager.readFile("src/remove-me.ts"),
      "export const removeMe = true;\n"
    );
    assert.equal(await fileManager.exists("src/new-file.ts"), false);
    assert.equal(await fileManager.exists("notes.txt"), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
