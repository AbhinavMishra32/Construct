import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { SnapshotRecord } from "@construct/shared";

const execFileAsync = promisify(execFile);

const INTERNAL_DIRECTORY = ".construct";
const DEFAULT_SNAPSHOT_AUTHOR = {
  name: "Construct",
  email: "snapshots@construct.local"
};

export class SnapshotService {
  private readonly workspaceRoot: string;
  private readonly gitDirectory: string;
  private readonly authorName: string;
  private readonly authorEmail: string;
  private initializationPromise?: Promise<void>;

  constructor(
    workspaceRoot: string,
    options?: {
      gitDirectory?: string;
      authorName?: string;
      authorEmail?: string;
    }
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.gitDirectory =
      options?.gitDirectory ??
      path.join(this.workspaceRoot, INTERNAL_DIRECTORY, "snapshots", "git");
    this.authorName = options?.authorName ?? DEFAULT_SNAPSHOT_AUTHOR.name;
    this.authorEmail = options?.authorEmail ?? DEFAULT_SNAPSHOT_AUTHOR.email;
  }

  async commitSnapshot(message: string): Promise<SnapshotRecord> {
    await this.ensureRepository();
    await this.runGit(["add", "-A"]);
    await this.runGit(["commit", "--quiet", "--allow-empty", "-m", message]);
    return this.getSnapshot("HEAD");
  }

  async checkoutSnapshot(commitId: string): Promise<SnapshotRecord> {
    await this.ensureRepository();
    await this.runGit(["restore", "--source", commitId, "--staged", "--worktree", "."]);
    await this.runGit(["clean", "-fd"]);
    return this.getSnapshot(commitId);
  }

  async listSnapshots(limit = 50): Promise<SnapshotRecord[]> {
    await this.ensureRepository();

    if (!(await this.hasSnapshots())) {
      return [];
    }

    const { stdout } = await this.runGit([
      "log",
      `--max-count=${limit}`,
      "--format=%H%x1f%cI%x1f%s"
    ]);

    const snapshots = await Promise.all(
      stdout
        .split("\n")
        .filter(Boolean)
        .map(async (entry) => {
          const [commitId, timestamp, message] = entry.split("\x1f");
          return {
            commitId,
            timestamp,
            message,
            fileDiffs: await this.diffSnapshot(commitId)
          } satisfies SnapshotRecord;
        })
    );

    return snapshots;
  }

  async diffSnapshot(commitId: string): Promise<string[]> {
    await this.ensureRepository();
    const { stdout } = await this.runGit([
      "show",
      "--format=",
      "--name-status",
      "--find-renames",
      commitId
    ]);

    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private async ensureRepository(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRepository();
    }

    await this.initializationPromise;
  }

  private async initializeRepository(): Promise<void> {
    await mkdir(this.gitDirectory, { recursive: true });

    if (!existsSync(path.join(this.gitDirectory, "HEAD"))) {
      await this.runGit(["init", "--quiet"]);
      await this.runGit(["config", "user.name", this.authorName]);
      await this.runGit(["config", "user.email", this.authorEmail]);
      await this.runGit(["config", "commit.gpgsign", "false"]);
      await this.ensureInternalDirectoryIsIgnored();
    }
  }

  private async ensureInternalDirectoryIsIgnored(): Promise<void> {
    const excludePath = path.join(this.gitDirectory, "info", "exclude");
    const existingContents = existsSync(excludePath)
      ? await readFile(excludePath, "utf8")
      : "";

    if (existingContents.includes(`${INTERNAL_DIRECTORY}/`)) {
      return;
    }

    const nextContents = `${existingContents}${existingContents.endsWith("\n") ? "" : "\n"}${INTERNAL_DIRECTORY}/\n`;
    await writeFile(excludePath, nextContents, "utf8");
  }

  private async hasSnapshots(): Promise<boolean> {
    try {
      await this.runGit(["rev-parse", "--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private async getSnapshot(reference: string): Promise<SnapshotRecord> {
    const { stdout } = await this.runGit(["show", "-s", "--format=%H%x1f%cI%x1f%s", reference]);
    const [commitId, timestamp, message] = stdout.split("\x1f");

    return {
      commitId,
      timestamp,
      message,
      fileDiffs: await this.diffSnapshot(commitId)
    };
  }

  private async runGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["--git-dir", this.gitDirectory, "--work-tree", this.workspaceRoot, ...args],
      {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024
      }
    );

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  }
}

