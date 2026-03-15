import Editor from "@monaco-editor/react";
import { motion } from "framer-motion";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { findAnchorLocation } from "./lib/anchors";
import {
  fetchBlueprint,
  fetchRunnerHealth,
  fetchWorkspaceFile,
  fetchWorkspaceFiles,
  saveWorkspaceFile
} from "./lib/api";
import { buildWorkspaceTree } from "./lib/tree";
import { monaco } from "./monaco";
import type {
  AnchorLocation,
  BlueprintStep,
  ProjectBlueprint,
  RunnerHealth,
  RuntimeInfo,
  TreeNode,
  WorkspaceFileEntry
} from "./types";

declare global {
  interface Window {
    construct: {
      getRuntimeInfo: () => RuntimeInfo;
    };
  }
}

const runtimeInfo = window.construct.getRuntimeInfo();
const SAVE_DEBOUNCE_MS = 450;

export default function App() {
  const [runnerHealth, setRunnerHealth] = useState<RunnerHealth | null>(null);
  const [blueprint, setBlueprint] = useState<ProjectBlueprint | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string>("");
  const [editorValue, setEditorValue] = useState<string>("");
  const [savedValue, setSavedValue] = useState<string>("");
  const [activeStepId, setActiveStepId] = useState<string>("");
  const [anchorLocation, setAnchorLocation] = useState<AnchorLocation | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [statusMessage, setStatusMessage] = useState<string>("Loading Construct workspace...");
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const activeRequestIdRef = useRef(0);

  const activeStep = useMemo(
    () => blueprint?.steps.find((step) => step.id === activeStepId) ?? null,
    [activeStepId, blueprint]
  );
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaceFiles), [workspaceFiles]);
  const activeNodeIds = useMemo(
    () => deriveHighlightedNodeIds(blueprint, activeStep),
    [activeStep, blueprint]
  );

  useEffect(() => {
    const controller = new AbortController();

    const loadWorkspace = async () => {
      try {
        const [health, blueprintEnvelope, filesEnvelope] = await Promise.all([
          fetchRunnerHealth(controller.signal),
          fetchBlueprint(controller.signal),
          fetchWorkspaceFiles(controller.signal)
        ]);

        setRunnerHealth(health);
        setBlueprint(blueprintEnvelope.blueprint);
        setWorkspaceFiles(filesEnvelope.files);
        setLoadError("");
        setStatusMessage(`Loaded ${blueprintEnvelope.blueprint.name}.`);

        const initialStep = blueprintEnvelope.blueprint.steps[0];
        if (initialStep) {
          await openToAnchor(initialStep, {
            setActiveFilePath,
            setEditorValue,
            setSavedValue,
            setActiveStepId,
            setAnchorLocation,
            setLoadError,
            setStatusMessage,
            activeRequestIdRef,
            signal: controller.signal
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Runner is not reachable.";
        setLoadError(message);
        setStatusMessage("Construct is waiting for the local runner.");
      }
    };

    void loadWorkspace();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!activeFilePath || editorValue === savedValue) {
      if (editorValue === savedValue) {
        setSaveState("saved");
      }
      return;
    }

    setSaveState("saving");

    const timeoutHandle = window.setTimeout(async () => {
      try {
        await saveWorkspaceFile(activeFilePath, editorValue);
        setSavedValue(editorValue);
        setSaveState("saved");
        setStatusMessage(`Saved ${activeFilePath}.`);
      } catch (error) {
        setSaveState("error");
        setStatusMessage(
          error instanceof Error ? error.message : `Failed to save ${activeFilePath}.`
        );
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutHandle);
    };
  }, [activeFilePath, editorValue, savedValue]);

  useEffect(() => {
    applyAnchorDecoration(editorRef.current, anchorLocation, decorationIdsRef.current, {
      setDecorationIds(nextIds) {
        decorationIdsRef.current = nextIds;
      }
    });
  }, [anchorLocation, editorValue]);

  const openFile = async (filePath: string, step?: BlueprintStep | null) => {
    const requestId = ++activeRequestIdRef.current;

    try {
      const response = await fetchWorkspaceFile(filePath);

      if (requestId !== activeRequestIdRef.current) {
        return;
      }

      setActiveFilePath(response.path);
      setEditorValue(response.content);
      setSavedValue(response.content);
      setAnchorLocation(
        step ? findAnchorLocation(response.content, step.anchor.marker) : null
      );
      if (step) {
        setActiveStepId(step.id);
        setStatusMessage(`Focused ${step.title}.`);
      } else {
        setStatusMessage(`Opened ${response.path}.`);
      }
      setLoadError("");
    } catch (error) {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : `Failed to open ${filePath}.`;
      setLoadError(message);
      setStatusMessage(message);
    }
  };

  const handleStepClick = async (step: BlueprintStep) => {
    await openFile(step.anchor.file, step);
  };

  const handleFileClick = async (filePath: string) => {
    const linkedStep =
      blueprint?.steps.find((step) => step.anchor.file === filePath) ?? null;
    await openFile(filePath, linkedStep);
  };

  const saveStateLabel =
    saveState === "saving"
      ? "Saving changes"
      : saveState === "error"
        ? "Save failed"
        : "Saved";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.22),_transparent_35%),linear-gradient(180deg,_#07101d_0%,_#0b1324_100%)] px-6 py-6 text-slate-100 lg:px-8">
      <motion.section
        className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1600px] flex-col gap-4"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
      >
        <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/45 px-6 py-5 shadow-2xl shadow-cyan-950/20 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.35em] text-teal-300">
                Construct Phase 4
              </p>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-white">
                  Blueprint navigation is live.
                </h1>
                <p className="max-w-4xl text-sm leading-7 text-slate-300">
                  The renderer now loads the active blueprint, shows a real file tree
                  from the runner workspace, opens files in Monaco, and jumps directly
                  to `TASK:` anchors when a development step is selected.
                </p>
              </div>
            </div>

            <div className="grid gap-2 rounded-[22px] border border-white/10 bg-slate-900/65 px-4 py-3 text-xs text-slate-300 sm:grid-cols-2 lg:min-w-[340px]">
              <StatLine label="Electron" value={runtimeInfo.electron} />
              <StatLine label="Node" value={runtimeInfo.node} />
              <StatLine label="Platform" value={runtimeInfo.platform} />
              <StatLine
                label="Runner"
                value={runnerHealth ? runnerHealth.status : "offline"}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {blueprint?.dependencyGraph.nodes.map((node) => {
                const isActive = activeNodeIds.has(node.id);
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      isActive
                        ? "border-teal-300/70 bg-teal-400/15 text-teal-100"
                        : "border-white/10 bg-white/5 text-slate-300"
                    }`}
                  >
                    {node.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                {saveStateLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                {statusMessage}
              </span>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="flex min-h-[720px] flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 shadow-xl shadow-cyan-950/15 backdrop-blur">
            <PanelTitle
              title="Workspace"
              subtitle="Real project files loaded from the runner workspace."
            />
            <div className="min-h-0 flex-1 overflow-auto rounded-[22px] border border-white/10 bg-slate-900/65 p-3">
              {workspaceTree.length > 0 ? (
                <nav className="space-y-1">
                  {workspaceTree.map((node) => (
                    <TreeBranch
                      key={node.path}
                      node={node}
                      activeFilePath={activeFilePath}
                      onSelectFile={handleFileClick}
                    />
                  ))}
                </nav>
              ) : (
                <EmptyState label="No files loaded yet." />
              )}
            </div>
          </aside>

          <section className="flex min-h-[720px] flex-col rounded-[30px] border border-white/10 bg-slate-950/45 shadow-xl shadow-cyan-950/15 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                  Editor Surface
                </p>
                <h2 className="text-lg font-semibold text-white">
                  {activeFilePath || "Select a file"}
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  {activeStep ? activeStep.title : "No active step"}
                </span>
                {anchorLocation ? (
                  <span className="rounded-full border border-teal-300/20 bg-teal-400/10 px-3 py-1.5 text-teal-100">
                    Anchor line {anchorLocation.lineNumber}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {activeFilePath ? (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  path={activeFilePath}
                  language={languageForPath(activeFilePath)}
                  value={editorValue}
                  onMount={(editor) => {
                    editorRef.current = editor;
                    applyAnchorDecoration(editor, anchorLocation, decorationIdsRef.current, {
                      setDecorationIds(nextIds) {
                        decorationIdsRef.current = nextIds;
                      }
                    });
                  }}
                  onChange={(value) => {
                    setEditorValue(value ?? "");
                  }}
                  options={{
                    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                    fontSize: 14,
                    smoothScrolling: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    glyphMargin: true,
                    lineNumbersMinChars: 3,
                    tabSize: 2,
                    padding: {
                      top: 20,
                      bottom: 20
                    }
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState label="Select a step or file to open the editor." />
                </div>
              )}
            </div>
          </section>

          <aside className="flex min-h-[720px] flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 shadow-xl shadow-cyan-950/15 backdrop-blur">
            <PanelTitle
              title="Focus Pane"
              subtitle="Blueprint steps, constraints, and direct anchor jumps."
            />

            <div className="min-h-0 flex-1 overflow-auto rounded-[22px] border border-white/10 bg-slate-900/65 p-3">
              <div className="space-y-4">
                {blueprint ? (
                  <>
                    <section className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-medium text-white">
                          {blueprint.name}
                        </h3>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                          {blueprint.language}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-slate-300">
                        {blueprint.description}
                      </p>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs uppercase tracking-[0.28em] text-slate-400">
                        Blueprint Steps
                      </h3>
                      <div className="space-y-2">
                        {blueprint.steps.map((step, index) => {
                          const isActive = step.id === activeStepId;
                          return (
                            <button
                              key={step.id}
                              type="button"
                              onClick={() => {
                                void handleStepClick(step);
                              }}
                              className={`w-full rounded-[20px] border px-4 py-3 text-left transition ${
                                isActive
                                  ? "border-teal-300/60 bg-teal-400/12 shadow-lg shadow-teal-950/30"
                                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                                    Step {index + 1}
                                  </p>
                                  <h4 className="text-sm font-medium text-white">
                                    {step.title}
                                  </h4>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] ${
                                    difficultyStyles[step.difficulty]
                                  }`}
                                >
                                  {step.difficulty}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-300">
                                {step.summary}
                              </p>
                              <p className="mt-3 text-xs text-slate-400">
                                {step.anchor.file} · {step.anchor.marker}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {activeStep ? (
                      <section className="space-y-4 rounded-[22px] border border-white/10 bg-slate-950/55 p-4">
                        <div className="space-y-2">
                          <h3 className="text-base font-semibold text-white">
                            {activeStep.title}
                          </h3>
                          <p className="text-sm leading-6 text-slate-300">
                            {activeStep.doc}
                          </p>
                        </div>

                        <MetadataGroup
                          title="Tests"
                          values={activeStep.tests}
                          accent="rgba(20,184,166,0.22)"
                        />
                        <MetadataGroup
                          title="Constraints"
                          values={activeStep.constraints}
                          accent="rgba(249,115,22,0.22)"
                        />
                        <MetadataGroup
                          title="Concepts"
                          values={activeStep.concepts}
                          accent="rgba(125,211,252,0.22)"
                        />
                      </section>
                    ) : null}
                  </>
                ) : (
                  <EmptyState label="Blueprint metadata has not loaded yet." />
                )}
              </div>
            </div>

            {loadError ? (
              <div className="rounded-[22px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {loadError}
              </div>
            ) : null}
          </aside>
        </section>
      </motion.section>
    </main>
  );
}

function PanelTitle({
  title,
  subtitle
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="space-y-1 px-1">
      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{title}</p>
      <p className="text-sm leading-6 text-slate-300">{subtitle}</p>
    </header>
  );
}

function StatLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-full border border-white/10 bg-white/5 px-3 py-2">
      <dt className="uppercase tracking-[0.18em] text-slate-400">{label}</dt>
      <dd className="text-slate-100">{value}</dd>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
      {label}
    </div>
  );
}

function MetadataGroup({
  title,
  values,
  accent
}: {
  title: string;
  values: string[];
  accent: string;
}) {
  if (values.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h4 className="text-xs uppercase tracking-[0.22em] text-slate-400">{title}</h4>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-200"
            style={{ backgroundColor: accent }}
          >
            {value}
          </span>
        ))}
      </div>
    </section>
  );
}

function TreeBranch({
  node,
  activeFilePath,
  onSelectFile,
  depth = 0
}: {
  node: TreeNode;
  activeFilePath: string;
  onSelectFile: (filePath: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isFile = node.kind === "file";
  const isActive = isFile && node.path === activeFilePath;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => {
          if (isFile) {
            onSelectFile(node.path);
            return;
          }

          setExpanded((current) => !current);
        }}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
          isActive
            ? "bg-teal-400/12 text-teal-100"
            : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
        }`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className="text-xs text-slate-500">
          {isFile ? "•" : expanded ? "▾" : "▸"}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {!isFile && expanded ? (
        <div className="space-y-1">
          {node.children.map((child) => (
            <TreeBranch
              key={child.path}
              node={child}
              activeFilePath={activeFilePath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

async function openToAnchor(
  step: BlueprintStep,
  actions: {
    setActiveFilePath: (filePath: string) => void;
    setEditorValue: (content: string) => void;
    setSavedValue: (content: string) => void;
    setActiveStepId: (stepId: string) => void;
    setAnchorLocation: (anchor: AnchorLocation | null) => void;
    setLoadError: (message: string) => void;
    setStatusMessage: (message: string) => void;
    activeRequestIdRef: { current: number };
    signal?: AbortSignal;
  }
): Promise<void> {
  const requestId = ++actions.activeRequestIdRef.current;
  const response = await fetchWorkspaceFile(step.anchor.file, actions.signal);

  if (requestId !== actions.activeRequestIdRef.current) {
    return;
  }

  const anchor = findAnchorLocation(response.content, step.anchor.marker);
  actions.setActiveFilePath(response.path);
  actions.setEditorValue(response.content);
  actions.setSavedValue(response.content);
  actions.setActiveStepId(step.id);
  actions.setAnchorLocation(anchor);
  actions.setLoadError("");
  actions.setStatusMessage(`Focused ${step.title}.`);
}

function applyAnchorDecoration(
  editor: MonacoEditor.IStandaloneCodeEditor | null,
  anchor: AnchorLocation | null,
  currentDecorationIds: string[],
  actions: {
    setDecorationIds: (nextIds: string[]) => void;
  }
): void {
  if (!editor) {
    return;
  }

  const nextDecorations = anchor
    ? [
        {
          range: new monaco.Range(
            anchor.lineNumber,
            1,
            anchor.lineNumber,
            anchor.endColumn
          ),
          options: {
            isWholeLine: true,
            className: "construct-anchor-line",
            glyphMarginClassName: "construct-anchor-glyph",
            linesDecorationsClassName: "construct-anchor-margin",
            inlineClassName: "construct-anchor-inline"
          }
        }
      ]
    : [];

  const nextIds = editor.deltaDecorations(currentDecorationIds, nextDecorations);
  actions.setDecorationIds(nextIds);

  if (anchor) {
    editor.revealLineInCenter(anchor.lineNumber);
    editor.setPosition({
      lineNumber: anchor.lineNumber,
      column: anchor.startColumn
    });
    editor.focus();
  }
}

function deriveHighlightedNodeIds(
  blueprint: ProjectBlueprint | null,
  step: BlueprintStep | null
): Set<string> {
  const activeIds = new Set<string>();

  if (!blueprint || !step) {
    return activeIds;
  }

  const anchorFile = step.anchor.file;
  if (anchorFile.includes("state")) {
    activeIds.add("component.state");
  }
  if (anchorFile.includes("graph")) {
    activeIds.add("component.graph");
  }
  if (anchorFile.includes("runner")) {
    activeIds.add("component.runner");
  }

  const conceptsText = step.concepts.join(" ").toLowerCase();
  for (const node of blueprint.dependencyGraph.nodes) {
    if (node.kind !== "skill") {
      continue;
    }

    const skillToken = node.id.split(".").pop()?.replaceAll("-", " ") ?? "";
    if (
      conceptsText.includes(skillToken) ||
      (skillToken === "async" && conceptsText.includes("async control flow"))
    ) {
      activeIds.add(node.id);
    }
  }

  return activeIds;
}

function languageForPath(filePath: string): string {
  if (filePath.endsWith(".ts")) {
    return "typescript";
  }
  if (filePath.endsWith(".tsx")) {
    return "typescript";
  }
  if (filePath.endsWith(".js") || filePath.endsWith(".cjs") || filePath.endsWith(".mjs")) {
    return "javascript";
  }
  if (filePath.endsWith(".json")) {
    return "json";
  }
  if (filePath.endsWith(".md")) {
    return "markdown";
  }

  return "plaintext";
}

const difficultyStyles: Record<BlueprintStep["difficulty"], string> = {
  intro: "bg-sky-400/15 text-sky-100",
  core: "bg-teal-400/15 text-teal-100",
  advanced: "bg-amber-400/15 text-amber-100"
};
