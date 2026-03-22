import {
  lstat,
  mkdir,
  readdir,
  readFile as readFileFromDisk,
  realpath,
  stat,
  writeFile as writeFileToDisk
} from "node:fs/promises";
import path from "node:path";

import type { WorkspaceFileEntry } from "@construct/shared";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".construct",
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules"
]);

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export class WorkspaceFileManager {
  private readonly workspaceRoot: string;
  private readonly ignoredDirectories: Set<string>;
  private readonly ignoredFiles: Set<string>;
  private readonly visibleFiles: Set<string> | null;
  private readonly visibleDirectories: Set<string>;
  private readonly workspaceRealRootPromise: Promise<string>;

  constructor(
    workspaceRoot: string,
    options?: {
      ignoredDirectories?: string[];
      ignoredFiles?: string[];
      visibleFiles?: string[];
    }
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.ignoredDirectories = new Set([
      ...DEFAULT_IGNORED_DIRECTORIES,
      ...(options?.ignoredDirectories ?? [])
    ]);
    this.ignoredFiles = new Set(options?.ignoredFiles ?? []);
    this.visibleFiles =
      options?.visibleFiles && options.visibleFiles.length > 0
        ? new Set(
            options.visibleFiles.map((relativePath) => normalizeWorkspaceRelativePath(relativePath))
          )
        : null;
    this.visibleDirectories = buildVisibleDirectorySet(this.visibleFiles);
    this.workspaceRealRootPromise = realpath(this.workspaceRoot);
  }

  async readFile(relativePath: string): Promise<string> {
    this.assertFileVisible(relativePath);
    const targetPath = await this.resolveExistingPath(relativePath);
    const targetStats = await stat(targetPath);

    if (!targetStats.isFile()) {
      throw new WorkspacePathError(`${relativePath} is not a file.`);
    }

    return readFileFromDisk(targetPath, "utf8");
  }

  async writeFile(relativePath: string, contents: string): Promise<void> {
    this.assertFileVisible(relativePath);
    const targetPath = await this.resolveWritePath(relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFileToDisk(targetPath, contents, "utf8");
  }

  async createFile(relativePath: string, contents = ""): Promise<void> {
    this.assertFileVisible(relativePath);
    const targetPath = await this.resolveWritePath(relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFileToDisk(targetPath, contents, { encoding: "utf8", flag: "wx" });
  }

  async exists(relativePath: string): Promise<boolean> {
    if (!this.isFileVisible(relativePath)) {
      return false;
    }

    try {
      await this.resolveExistingPath(relativePath);
      return true;
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }

      throw error;
    }
  }

  async listFiles(): Promise<WorkspaceFileEntry[]> {
    const workspaceRoot = await this.workspaceRealRootPromise;
    const entries: WorkspaceFileEntry[] = [];

    const walk = async (directoryPath: string): Promise<void> => {
      const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
      directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

      for (const directoryEntry of directoryEntries) {
        if (directoryEntry.isSymbolicLink()) {
          continue;
        }

        if (directoryEntry.isDirectory() && this.ignoredDirectories.has(directoryEntry.name)) {
          continue;
        }

        if (directoryEntry.isFile() && this.ignoredFiles.has(directoryEntry.name)) {
          continue;
        }

        const absolutePath = path.join(directoryPath, directoryEntry.name);
        const relativeEntryPath = this.toWorkspacePath(
          path.relative(workspaceRoot, absolutePath)
        );

        if (directoryEntry.isDirectory()) {
          if (!this.isDirectoryVisible(relativeEntryPath)) {
            continue;
          }

          entries.push({
            path: relativeEntryPath,
            kind: "directory",
            size: 0
          });
          await walk(absolutePath);
          continue;
        }

        if (directoryEntry.isFile()) {
          if (!this.isFileVisible(relativeEntryPath)) {
            continue;
          }

          const entryStats = await stat(absolutePath);
          entries.push({
            path: relativeEntryPath,
            kind: "file",
            size: entryStats.size
          });
        }
      }
    };

    await walk(workspaceRoot);
    return entries;
  }

  private async resolveExistingPath(relativePath: string): Promise<string> {
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const workspaceRoot = await this.workspaceRealRootPromise;
    const candidatePath = path.resolve(workspaceRoot, normalizedPath);
    this.assertWithinWorkspace(workspaceRoot, candidatePath, relativePath);

    const resolvedPath = await realpath(candidatePath);
    this.assertWithinWorkspace(workspaceRoot, resolvedPath, relativePath);
    return resolvedPath;
  }

  private async resolveWritePath(relativePath: string): Promise<string> {
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const workspaceRoot = await this.workspaceRealRootPromise;
    const candidatePath = path.resolve(workspaceRoot, normalizedPath);
    this.assertWithinWorkspace(workspaceRoot, candidatePath, relativePath);

    try {
      const entryStats = await lstat(candidatePath);

      if (entryStats.isSymbolicLink()) {
        const resolvedPath = await realpath(candidatePath);
        this.assertWithinWorkspace(workspaceRoot, resolvedPath, relativePath);
      }

      return candidatePath;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    const existingParent = await this.resolveNearestExistingParent(path.dirname(candidatePath));
    this.assertWithinWorkspace(workspaceRoot, existingParent, relativePath);
    return candidatePath;
  }

  private async resolveNearestExistingParent(targetPath: string): Promise<string> {
    let currentPath = targetPath;

    while (true) {
      try {
        return await realpath(currentPath);
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }

      const nextPath = path.dirname(currentPath);
      if (nextPath === currentPath) {
        throw new WorkspacePathError("Unable to resolve a valid workspace parent directory.");
      }

      currentPath = nextPath;
    }
  }

  private normalizeRelativePath(relativePath: string): string {
    const normalizedPath = normalizeWorkspaceRelativePath(relativePath);

    if (!normalizedPath || normalizedPath === ".") {
      throw new WorkspacePathError("A relative workspace path is required.");
    }

    return normalizedPath;
  }

  private assertWithinWorkspace(
    workspaceRoot: string,
    absolutePath: string,
    requestedPath: string
  ): void {
    const relativeToRoot = path.relative(workspaceRoot, absolutePath);

    if (
      relativeToRoot === "" ||
      (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))
    ) {
      return;
    }

    throw new WorkspacePathError(
      `${requestedPath} resolves outside the workspace root ${workspaceRoot}.`
    );
  }

  private toWorkspacePath(relativePath: string): string {
    return relativePath.split(path.sep).join("/");
  }

  private assertFileVisible(relativePath: string): void {
    if (this.isFileVisible(relativePath)) {
      return;
    }

    throw new WorkspacePathError(`${relativePath} is not visible in the current project slice.`);
  }

  private isFileVisible(relativePath: string): boolean {
    if (!this.visibleFiles) {
      return true;
    }

    return this.visibleFiles.has(normalizeWorkspaceRelativePath(relativePath));
  }

  private isDirectoryVisible(relativePath: string): boolean {
    if (!this.visibleFiles) {
      return true;
    }

    return this.visibleDirectories.has(normalizeWorkspaceRelativePath(relativePath));
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}

function buildVisibleDirectorySet(visibleFiles: Set<string> | null): Set<string> {
  const directories = new Set<string>();

  if (!visibleFiles) {
    return directories;
  }

  for (const relativePath of visibleFiles) {
    const parts = relativePath.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }

  return directories;
}
