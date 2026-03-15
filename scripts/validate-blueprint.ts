import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectBlueprintSchema } from "../pkg/shared/src/index.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprintRoot = path.join(rootDir, "blueprints", "workflow-runtime");
const blueprintPath = path.join(blueprintRoot, "project-blueprint.json");

async function main(): Promise<void> {
  const rawBlueprint = await readFile(blueprintPath, "utf8");
  const parsedBlueprint = ProjectBlueprintSchema.parse(JSON.parse(rawBlueprint));

  for (const step of parsedBlueprint.steps) {
    const anchoredStarterFile = parsedBlueprint.files[step.anchor.file];

    if (!anchoredStarterFile) {
      throw new Error(`Starter file ${step.anchor.file} is missing for ${step.id}.`);
    }

    if (!anchoredStarterFile.includes(step.anchor.marker)) {
      throw new Error(`Anchor marker ${step.anchor.marker} is missing in ${step.anchor.file}.`);
    }

    const canonicalFilePath = path.join(blueprintRoot, step.anchor.file);
    await readFile(canonicalFilePath, "utf8");

    for (const testFile of step.tests) {
      const absoluteTestPath = path.join(blueprintRoot, testFile);
      await readFile(absoluteTestPath, "utf8");
    }
  }

  console.log(
    `Validated ${parsedBlueprint.steps.length} steps for blueprint ${parsedBlueprint.id}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
