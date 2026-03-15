import assert from "node:assert/strict";
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SnapshotService } from "./snapshots";
import { TaskLifecycleService } from "./taskLifecycle";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceBlueprintRoot = path.join(rootDir, "blueprints", "workflow-runtime");

test("TaskLifecycleService starts a task with a persisted pre-task snapshot", async () => {
  const { blueprintPath, cleanup, workspaceRoot } = await createWorkspaceFixture();
  const clock = createClock("2025-03-15T00:00:00.000Z");

  try {
    const service = new TaskLifecycleService(workspaceRoot, {
      now: clock.now
    });
    const startResponse = await service.startTask({
      blueprintPath,
      stepId: "step.state-merge"
    });
    const snapshots = await new SnapshotService(workspaceRoot).listSnapshots();

    assert.equal(startResponse.session.stepId, "step.state-merge");
    assert.equal(startResponse.session.status, "active");
    assert.equal(startResponse.session.latestAttempt, 0);
    assert.equal(startResponse.progress.totalAttempts, 0);
    assert.equal(startResponse.progress.activeSession?.sessionId, startResponse.session.sessionId);
    assert.match(startResponse.session.preTaskSnapshot.message, /Pre-task snapshot/i);
    assert.equal(startResponse.learnerModel.history.length, 1);
    assert.equal(startResponse.learnerModel.history[0].status, "started");
    assert.equal(snapshots.length, 1);

    service.close();
  } finally {
    await cleanup();
  }
});

test("TaskLifecycleService reuses an active session and persists attempts, telemetry, and pass snapshots", async () => {
  const { blueprintPath, cleanup, workspaceRoot } = await createWorkspaceFixture();
  const brokenStatePath = path.join(workspaceRoot, "src", "state.ts");
  const workingStateSource = await readFile(path.join(sourceBlueprintRoot, "src", "state.ts"), "utf8");
  const clock = createClock("2025-03-15T00:00:00.000Z");

  try {
    const service = new TaskLifecycleService(workspaceRoot, {
      now: clock.now
    });
    const started = await service.startTask({
      blueprintPath,
      stepId: "step.state-merge"
    });

    await writeFile(
      brokenStatePath,
      "export function mergeState() { throw new Error('broken state merge'); }\n",
      "utf8"
    );

    clock.advance(1_250);
    const failed = await service.submitTask({
      blueprintPath,
      stepId: "step.state-merge",
      sessionId: started.session.sessionId,
      timeoutMs: 30_000,
      telemetry: {
        hintsUsed: 1,
        typedChars: 44,
        pastedChars: 0,
        pasteRatio: 0
      }
    });

    assert.equal(failed.attempt.attempt, 1);
    assert.equal(failed.attempt.status, "failed");
    assert.equal(failed.progress.totalAttempts, 1);
    assert.equal(failed.progress.activeSession?.sessionId, started.session.sessionId);
    assert.equal(failed.session.status, "active");
    assert.equal(failed.learnerModel.hintsUsed["step.state-merge"], 1);

    const restarted = await service.startTask({
      blueprintPath,
      stepId: "step.state-merge"
    });

    assert.equal(restarted.session.sessionId, started.session.sessionId);
    assert.equal(restarted.progress.totalAttempts, 1);

    await writeFile(brokenStatePath, workingStateSource, "utf8");

    clock.advance(1_600);
    const passed = await service.submitTask({
      blueprintPath,
      stepId: "step.state-merge",
      sessionId: started.session.sessionId,
      timeoutMs: 30_000,
      telemetry: {
        hintsUsed: 2,
        typedChars: 80,
        pastedChars: 20,
        pasteRatio: 0.25
      }
    });
    const snapshots = await new SnapshotService(workspaceRoot).listSnapshots();

    assert.equal(passed.attempt.attempt, 2);
    assert.equal(passed.attempt.status, "passed");
    assert.equal(passed.session.status, "passed");
    assert.equal(passed.progress.totalAttempts, 2);
    assert.equal(passed.progress.activeSession, null);
    assert.equal(passed.progress.latestAttempt?.telemetry.pasteRatio, 0.2);
    assert.ok(passed.attempt.postTaskSnapshot);
    assert.equal(passed.learnerModel.history.length, 3);
    assert.deepEqual(
      passed.learnerModel.history.map((entry) => entry.status),
      ["started", "failed", "passed"]
    );
    assert.equal(passed.learnerModel.hintsUsed["step.state-merge"], 3);
    assert.equal(snapshots.length, 2);

    service.close();
  } finally {
    await cleanup();
  }
});

async function createWorkspaceFixture(): Promise<{
  workspaceRoot: string;
  blueprintPath: string;
  cleanup: () => Promise<void>;
}> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "construct-task-lifecycle-"));
  const workspaceRoot = path.join(fixtureRoot, "blueprints", "workflow-runtime");

  await cp(sourceBlueprintRoot, workspaceRoot, {
    recursive: true
  });
  await copyFile(path.join(rootDir, "tsconfig.base.json"), path.join(fixtureRoot, "tsconfig.base.json"));
  await rm(path.join(workspaceRoot, ".construct"), {
    recursive: true,
    force: true
  });

  return {
    workspaceRoot,
    blueprintPath: path.join(workspaceRoot, "project-blueprint.json"),
    cleanup: async () => {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  };
}

function createClock(initialIso: string): {
  now: () => Date;
  advance: (durationMs: number) => void;
} {
  let currentTime = new Date(initialIso).getTime();

  return {
    now: () => new Date(currentTime),
    advance: (durationMs: number) => {
      currentTime += durationMs;
    }
  };
}
