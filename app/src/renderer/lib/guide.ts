import type { BlueprintStep, ComprehensionCheck } from "../types";

export type CheckReview = {
  status: "complete" | "needs-revision";
  message: string;
  coveredCriteria: string[];
  missingCriteria: string[];
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "when",
  "what",
  "where",
  "why",
  "how",
  "should",
  "would",
  "could",
  "must",
  "need",
  "needs",
  "mention",
  "return",
  "returns",
  "returning",
  "using",
  "used",
  "from",
  "into",
  "after",
  "before",
  "there",
  "their",
  "they",
  "them",
  "then",
  "than",
  "your",
  "while",
  "which",
  "have",
  "has",
  "had",
  "been",
  "being",
  "each",
  "only",
  "just",
  "also",
  "does",
  "done"
]);

export function hasAnsweredCheck(
  check: ComprehensionCheck,
  response: string | undefined
): boolean {
  if (!response) {
    return false;
  }

  if (check.type === "mcq") {
    return response.trim().length > 0;
  }

  return response.trim().length >= 8;
}

export function evaluateCheckResponse(
  check: ComprehensionCheck,
  response: string
): CheckReview {
  if (check.type === "mcq") {
    const isCorrect = response === check.answer;
    return {
      status: isCorrect ? "complete" : "needs-revision",
      message: isCorrect
        ? "Correct. The core reason is captured."
        : "Review the objective again and pick the option that best matches the runtime behavior.",
      coveredCriteria: isCorrect ? [check.answer] : [],
      missingCriteria: isCorrect ? [] : ["Select the correct rationale for this design choice."]
    };
  }

  const normalizedResponse = normalizeText(response);
  const responseTokens = new Set(tokenize(normalizedResponse));
  const coveredCriteria: string[] = [];
  const missingCriteria: string[] = [];

  for (const criterion of check.rubric) {
    const criterionTokens = tokenize(normalizeText(criterion));
    const isCovered = criterionTokens.some((token) => responseTokens.has(token));

    if (isCovered) {
      coveredCriteria.push(criterion);
    } else {
      missingCriteria.push(criterion);
    }
  }

  const complete = missingCriteria.length === 0;
  const message = complete
    ? `Strong answer. You covered ${coveredCriteria.length}/${check.rubric.length} review points.`
    : coveredCriteria.length > 0
      ? `Partial coverage. You hit ${coveredCriteria.length}/${check.rubric.length} review points.`
      : "Your answer is too broad. Anchor it to the runtime behavior this step depends on.";

  return {
    status: complete ? "complete" : "needs-revision",
    message,
    coveredCriteria,
    missingCriteria
  };
}

export function buildGuidancePrompts(step: BlueprintStep): string[] {
  const firstConstraint = step.constraints[0] ?? "Protect the existing runtime contract.";
  const firstTest = step.tests[0] ?? "the targeted task tests";

  return [
    `Which behavior in "${step.summary}" should be true before you submit?`,
    `In ${step.anchor.file}, what is the smallest change that satisfies "${firstConstraint}"?`,
    `Which expectation in ${firstTest} will fail first if you break this step's contract?`
  ];
}

export function buildStepHints(step: BlueprintStep): string[] {
  const [firstConstraint = step.summary, secondConstraint = "Keep the implementation narrow."] =
    step.constraints;
  const testsLabel = step.tests.join(", ");

  return [
    `Stay inside ${step.anchor.file} near ${step.anchor.marker}. Start with: ${firstConstraint}`,
    `Work backward from ${testsLabel}. Make the fewest changes needed so that "${step.summary}" becomes true.`,
    `Before you submit, verify all of these points: ${firstConstraint} ${secondConstraint}`
  ];
}

export function resolveBlueprintDefinitionPath(projectRoot: string): string {
  return `${projectRoot.replace(/\/+$/, "")}/project-blueprint.json`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return value
    .split(" ")
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function normalizeToken(token: string): string {
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}
