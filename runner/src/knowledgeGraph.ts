import {
  UserKnowledgeBaseSchema,
  type ConceptConfidence,
  type KnowledgeCategory,
  type KnowledgeSource,
  type StoredKnowledgeConcept,
  type StoredKnowledgeGoal,
  type UserKnowledgeBase
} from "@construct/shared";

type KnowledgeSignal = {
  conceptId: string;
  label: string;
  category: KnowledgeCategory;
  score: number;
  rationale: string;
  source: KnowledgeSource;
  recordedAt: string;
  labelPath?: string[];
};

export type KnowledgeGraphStats = {
  rootConceptCount: number;
  totalConceptCount: number;
  leafConceptCount: number;
  maxDepth: number;
  averageScore: number;
  strongConceptCount: number;
  developingConceptCount: number;
  weakConceptCount: number;
};

export type PromptKnowledgeConcept = {
  id: string;
  label: string;
  category: KnowledgeCategory;
  score: number;
  selfScore: number | null;
  rationale: string;
  updatedAt: string;
  evidence: Array<{
    source: KnowledgeSource;
    score: number;
    summary: string;
    recordedAt: string;
  }>;
  children: PromptKnowledgeConcept[];
};

export function createEmptyKnowledgeBase(now: string): UserKnowledgeBase {
  return UserKnowledgeBaseSchema.parse({
    updatedAt: now,
    concepts: [],
    goals: []
  });
}

export function applyKnowledgeSignals(
  knowledgeBase: UserKnowledgeBase,
  signals: KnowledgeSignal[],
  options: {
    goal?: StoredKnowledgeGoal | null;
    maxGoals?: number;
  } = {}
): UserKnowledgeBase {
  const nextRoots = cloneKnowledgeNodes(knowledgeBase.concepts);
  let latestTimestamp = knowledgeBase.updatedAt;

  for (const signal of signals) {
    const path = normalizeConceptPath(signal.conceptId);
    if (path.length === 0) {
      continue;
    }

    const labelPath = buildLabelPath(path, signal.label, signal.labelPath);
    upsertKnowledgeNode(nextRoots, path, labelPath, signal, 0);
    latestTimestamp =
      signal.recordedAt > latestTimestamp ? signal.recordedAt : latestTimestamp;
  }

  const goals = mergeKnowledgeGoals(knowledgeBase.goals, options.goal, options.maxGoals ?? 25);

  return UserKnowledgeBaseSchema.parse({
    updatedAt: latestTimestamp,
    concepts: nextRoots,
    goals
  });
}

export function flattenKnowledgeConcepts(
  concepts: StoredKnowledgeConcept[]
): StoredKnowledgeConcept[] {
  const flattened: StoredKnowledgeConcept[] = [];

  for (const concept of concepts) {
    flattened.push(concept);
    flattened.push(...flattenKnowledgeConcepts(concept.children));
  }

  return flattened;
}

export function findKnowledgeConcept(
  concepts: StoredKnowledgeConcept[],
  conceptId: string
): StoredKnowledgeConcept | null {
  for (const concept of concepts) {
    if (concept.id === conceptId) {
      return concept;
    }

    const nested = findKnowledgeConcept(concept.children, conceptId);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function getKnowledgeConceptLineage(
  concepts: StoredKnowledgeConcept[],
  conceptId: string
): StoredKnowledgeConcept[] | null {
  for (const concept of concepts) {
    if (concept.id === conceptId) {
      return [concept];
    }

    const nested = getKnowledgeConceptLineage(concept.children, conceptId);
    if (nested) {
      return [concept, ...nested];
    }
  }

  return null;
}

export function getKnowledgeConceptLabelPath(
  concepts: StoredKnowledgeConcept[],
  conceptId: string
): string[] | null {
  const lineage = getKnowledgeConceptLineage(concepts, conceptId);
  return lineage ? lineage.map((concept) => concept.label) : null;
}

export function summarizeKnowledgeBase(
  knowledgeBase: UserKnowledgeBase
): KnowledgeGraphStats {
  const flattened = flattenKnowledgeConcepts(knowledgeBase.concepts);
  const leafConceptCount = flattened.filter((concept) => concept.children.length === 0).length;
  const totalScore = flattened.reduce((sum, concept) => sum + concept.score, 0);
  const maxDepth = flattened.reduce(
    (depth, concept) => Math.max(depth, concept.id.split(".").length),
    0
  );

  return {
    rootConceptCount: knowledgeBase.concepts.length,
    totalConceptCount: flattened.length,
    leafConceptCount,
    maxDepth,
    averageScore:
      flattened.length > 0 ? clampKnowledgeScore(totalScore / flattened.length) : 0,
    strongConceptCount: flattened.filter((concept) => concept.score >= 75).length,
    developingConceptCount: flattened.filter(
      (concept) => concept.score >= 45 && concept.score < 75
    ).length,
    weakConceptCount: flattened.filter((concept) => concept.score < 45).length
  };
}

export function serializeKnowledgeBaseForPrompt(
  knowledgeBase: UserKnowledgeBase,
  options: {
    maxRoots?: number;
    maxDepth?: number;
    maxChildrenPerNode?: number;
    maxEvidencePerNode?: number;
    maxGoals?: number;
  } = {}
): {
  updatedAt: string;
  stats: KnowledgeGraphStats;
  goals: Array<Pick<StoredKnowledgeGoal, "goal" | "language" | "domain" | "lastPlannedAt">>;
  concepts: PromptKnowledgeConcept[];
} {
  const maxRoots = options.maxRoots ?? 10;
  const maxDepth = options.maxDepth ?? 5;
  const maxChildrenPerNode = options.maxChildrenPerNode ?? 6;
  const maxEvidencePerNode = options.maxEvidencePerNode ?? 3;

  return {
    updatedAt: knowledgeBase.updatedAt,
    stats: summarizeKnowledgeBase(knowledgeBase),
    goals: knowledgeBase.goals
      .slice()
      .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
      .slice(0, options.maxGoals ?? 10),
    concepts: knowledgeBase.concepts
      .slice()
      .sort(compareKnowledgeNodes)
      .slice(0, maxRoots)
      .map((concept) =>
        serializeKnowledgeNodeForPrompt(concept, {
          depth: 1,
          maxDepth,
          maxChildrenPerNode,
          maxEvidencePerNode
        })
      )
  };
}

export function compactKnowledgeBase(knowledgeBase: UserKnowledgeBase): {
  updatedAt: string;
  concepts: Array<{
    id: string;
    label: string;
    category: KnowledgeCategory;
    score: number;
    rationale: string;
    updatedAt: string;
    depth: number;
  }>;
  goals: Array<Pick<StoredKnowledgeGoal, "goal" | "language" | "domain" | "lastPlannedAt">>;
} {
  const concepts = flattenKnowledgeConcepts(knowledgeBase.concepts)
    .map((concept) => ({
      id: concept.id,
      label: concept.label,
      category: concept.category,
      score: concept.score,
      rationale: concept.rationale,
      updatedAt: concept.updatedAt,
      depth: concept.id.split(".").length - 1
    }))
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }

      return right.score - left.score;
    })
    .slice(0, 28);

  return {
    updatedAt: knowledgeBase.updatedAt,
    concepts,
    goals: knowledgeBase.goals
      .slice()
      .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
      .slice(0, 10)
  };
}

export function confidenceToScore(confidence: ConceptConfidence): number {
  switch (confidence) {
    case "comfortable":
      return 82;
    case "shaky":
      return 54;
    case "new":
      return 24;
  }
}

export function taskOutcomeToScore(input: {
  status: "failed" | "passed" | "needs-review";
  hintsUsed: number;
  pasteRatio: number;
}): number {
  if (input.status === "passed") {
    if (input.pasteRatio >= 0.55) {
      return 48;
    }

    if (input.hintsUsed >= 3) {
      return 62;
    }

    if (input.hintsUsed >= 1) {
      return 70;
    }

    return 80;
  }

  if (input.status === "needs-review") {
    return 40;
  }

  if (input.hintsUsed >= 3) {
    return 22;
  }

  return 32;
}

function upsertKnowledgeNode(
  nodes: StoredKnowledgeConcept[],
  path: string[],
  labelPath: string[],
  signal: KnowledgeSignal,
  depth: number
): StoredKnowledgeConcept {
  const segmentId = path.slice(0, depth + 1).join(".");
  const segmentLabel = labelPath[depth] ?? humanizeConceptSegment(path[depth]);
  const isLeaf = depth === path.length - 1;

  let node = nodes.find((entry) => entry.id === segmentId);

  if (!node) {
    node = {
      id: segmentId,
      label: segmentLabel,
      category: signal.category,
      score: clampKnowledgeScore(isLeaf ? signal.score : 0),
      selfScore: isLeaf ? clampKnowledgeScore(signal.score) : null,
      rationale: signal.rationale,
      source: signal.source,
      updatedAt: signal.recordedAt,
      evidence: [],
      children: []
    };
    nodes.push(node);
  } else {
    node.label = segmentLabel;
    node.category = signal.category;
    node.updatedAt =
      signal.recordedAt > node.updatedAt ? signal.recordedAt : node.updatedAt;
  }

  if (isLeaf) {
    node.selfScore = blendKnowledgeScore(node.selfScore, signal.score);
    node.score = clampKnowledgeScore(node.selfScore ?? signal.score);
    node.rationale = signal.rationale;
    node.source = signal.source;
    node.updatedAt = signal.recordedAt;
    node.evidence = [
      {
        source: signal.source,
        score: clampKnowledgeScore(signal.score),
        summary: signal.rationale,
        recordedAt: signal.recordedAt
      },
      ...node.evidence
    ].slice(0, 12);
    return node;
  }

  upsertKnowledgeNode(node.children, path, labelPath, signal, depth + 1);
  node.score = deriveKnowledgeNodeScore(node);
  node.rationale = summarizeKnowledgeNode(node);
  return node;
}

function deriveKnowledgeNodeScore(node: StoredKnowledgeConcept): number {
  if (node.children.length === 0) {
    return clampKnowledgeScore(node.selfScore ?? node.score);
  }

  const total = node.children.reduce((sum, child) => sum + child.score, 0);
  return clampKnowledgeScore(Math.round(total / node.children.length));
}

function serializeKnowledgeNodeForPrompt(
  concept: StoredKnowledgeConcept,
  options: {
    depth: number;
    maxDepth: number;
    maxChildrenPerNode: number;
    maxEvidencePerNode: number;
  }
): PromptKnowledgeConcept {
  return {
    id: concept.id,
    label: concept.label,
    category: concept.category,
    score: concept.score,
    selfScore: concept.selfScore,
    rationale: concept.rationale,
    updatedAt: concept.updatedAt,
    evidence: concept.evidence.slice(0, options.maxEvidencePerNode),
    children:
      options.depth >= options.maxDepth
        ? []
        : concept.children
            .slice()
            .sort(compareKnowledgeNodes)
            .slice(0, options.maxChildrenPerNode)
            .map((child) =>
              serializeKnowledgeNodeForPrompt(child, {
                ...options,
                depth: options.depth + 1
              })
            )
  };
}

function summarizeKnowledgeNode(node: StoredKnowledgeConcept): string {
  if (node.children.length === 0) {
    return node.rationale;
  }

  const strongestChild = node.children
    .slice()
    .sort((left, right) => right.score - left.score)[0];

  if (!strongestChild) {
    return node.rationale;
  }

  return `Aggregated from ${node.children.length} subtopics. Strongest signal: ${strongestChild.label}.`;
}

function compareKnowledgeNodes(
  left: StoredKnowledgeConcept,
  right: StoredKnowledgeConcept
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }

  return left.label.localeCompare(right.label);
}

function cloneKnowledgeNodes(nodes: StoredKnowledgeConcept[]): StoredKnowledgeConcept[] {
  return nodes.map((node) => ({
    ...node,
    evidence: node.evidence.slice(),
    children: cloneKnowledgeNodes(node.children)
  }));
}

function normalizeConceptPath(conceptId: string): string[] {
  return conceptId
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildLabelPath(
  path: string[],
  leafLabel: string,
  labelPath?: string[]
): string[] {
  if (labelPath && labelPath.length === path.length) {
    return labelPath;
  }

  return path.map((segment, index) =>
    index === path.length - 1 ? leafLabel : humanizeConceptSegment(segment)
  );
}

function humanizeConceptSegment(segment: string): string {
  return segment
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clampKnowledgeScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

function blendKnowledgeScore(existingScore: number | null, nextScore: number): number {
  if (existingScore === null) {
    return clampKnowledgeScore(nextScore);
  }

  return clampKnowledgeScore(existingScore * 0.6 + nextScore * 0.4);
}

function mergeKnowledgeGoals(
  goals: StoredKnowledgeGoal[],
  nextGoal: StoredKnowledgeGoal | null | undefined,
  maxGoals: number
): StoredKnowledgeGoal[] {
  if (!nextGoal) {
    return goals
      .slice()
      .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
      .slice(0, maxGoals);
  }

  const filtered = goals.filter((goal) => goal.goal !== nextGoal.goal);
  filtered.unshift(nextGoal);

  return filtered
    .slice()
    .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
    .slice(0, maxGoals);
}
