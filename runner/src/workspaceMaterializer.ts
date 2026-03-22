import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ProjectBlueprintSchema,
  type ProjectBlueprint
} from "@construct/shared";

const EXCLUDED_COPY_ENTRIES = new Set([
  ".construct",
  "coverage",
  "dist",
  "node_modules",
  "test-fixtures"
]);

export type PreparedWorkspace = {
  blueprint: ProjectBlueprint;
  canonicalBlueprintPath: string;
  learnerBlueprintPath: string;
  learnerWorkspaceRoot: string;
  sourceProjectRoot: string;
};

export async function prepareLearnerWorkspace(
  canonicalBlueprintPath: string
): Promise<PreparedWorkspace> {
  const resolvedBlueprintPath = path.resolve(canonicalBlueprintPath);
  const blueprint = await loadBlueprintFromDisk(resolvedBlueprintPath);
  const sourceProjectRoot = path.dirname(resolvedBlueprintPath);
  const learnerWorkspaceRoot = path.join(
    sourceProjectRoot,
    ".construct",
    "workspaces",
    toWorkspaceDirectoryName(blueprint.id)
  );
  const learnerBlueprintPath = path.join(
    learnerWorkspaceRoot,
    path.basename(resolvedBlueprintPath)
  );

  if (!existsSync(learnerBlueprintPath)) {
    await materializeWorkspace({
      blueprint,
      sourceProjectRoot,
      learnerWorkspaceRoot,
      learnerBlueprintPath
    });
  }

  return {
    blueprint,
    canonicalBlueprintPath: resolvedBlueprintPath,
    learnerBlueprintPath,
    learnerWorkspaceRoot,
    sourceProjectRoot
  };
}

async function materializeWorkspace(input: {
  blueprint: ProjectBlueprint;
  sourceProjectRoot: string;
  learnerWorkspaceRoot: string;
  learnerBlueprintPath: string;
}): Promise<void> {
  await rm(input.learnerWorkspaceRoot, { recursive: true, force: true });
  await mkdir(input.learnerWorkspaceRoot, { recursive: true });

  const topLevelEntries = await readdir(input.sourceProjectRoot, { withFileTypes: true });

  for (const entry of topLevelEntries) {
    if (EXCLUDED_COPY_ENTRIES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(input.sourceProjectRoot, entry.name);
    const destinationPath = path.join(input.learnerWorkspaceRoot, entry.name);

    await cp(sourcePath, destinationPath, {
      recursive: true
    });
  }

  for (const [relativePath, contents] of Object.entries(input.blueprint.files)) {
    const destinationPath = path.join(input.learnerWorkspaceRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, contents, "utf8");
  }

  const learnerBlueprint = {
    ...input.blueprint,
    projectRoot: input.learnerWorkspaceRoot
  };

  await writeFile(
    input.learnerBlueprintPath,
    `${JSON.stringify(learnerBlueprint, null, 2)}\n`,
    "utf8"
  );
}

async function loadBlueprintFromDisk(blueprintPath: string): Promise<ProjectBlueprint> {
  const rawBlueprint = await readFile(blueprintPath, "utf8");
  return ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));
}

function toWorkspaceDirectoryName(blueprintId: string): string {
  return blueprintId.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
