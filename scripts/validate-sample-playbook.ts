import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectPlaybookSchema } from "../pkg/shared/src/index.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sampleRoot = path.join(rootDir, "playbooks", "sample");
const playbookPath = path.join(sampleRoot, "project-playbook.json");

const rawPlaybook = await readFile(playbookPath, "utf8");
const parsedPlaybook = ProjectPlaybookSchema.parse(JSON.parse(rawPlaybook));

for (const step of parsedPlaybook.steps) {
  const anchoredStarterFile = parsedPlaybook.files[step.anchor.file];

  if (!anchoredStarterFile) {
    throw new Error(`Starter file ${step.anchor.file} is missing for ${step.id}.`);
  }

  if (!anchoredStarterFile.includes(step.anchor.marker)) {
    throw new Error(`Anchor marker ${step.anchor.marker} is missing in ${step.anchor.file}.`);
  }

  const canonicalFilePath = path.join(sampleRoot, step.anchor.file);
  await readFile(canonicalFilePath, "utf8");

  for (const testFile of step.tests) {
    const absoluteTestPath = path.join(sampleRoot, testFile);
    await readFile(absoluteTestPath, "utf8");
  }
}

console.log(
  `Validated ${parsedPlaybook.steps.length} steps for playbook ${parsedPlaybook.id}.`
);

