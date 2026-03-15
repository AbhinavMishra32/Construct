import Editor from "@monaco-editor/react";
import { AnimatePresence, motion } from "framer-motion";
import type { editor as MonacoEditor } from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";

import { findAnchorLocation } from "./lib/anchors";
import {
  buildGuidancePrompts,
  buildStepHints,
  evaluateCheckResponse,
  hasAnsweredCheck,
  resolveBlueprintDefinitionPath,
  type CheckReview
} from "./lib/guide";
import {
  executeBlueprintTask,
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
  ComprehensionCheck,
  ProjectBlueprint,
  RunnerHealth,
  RuntimeInfo,
  TaskResult,
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

type SurfaceMode = "brief" | "focus";
type TaskRunState = "idle" | "running";

const runtimeInfo = window.construct.getRuntimeInfo();
const SAVE_DEBOUNCE_MS = 450;

export default function App() {
  const [runnerHealth, setRunnerHealth] = useState<RunnerHealth | null>(null);
  const [blueprint, setBlueprint] = useState<ProjectBlueprint | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [editorValue, setEditorValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [activeStepId, setActiveStepId] = useState("");
  const [anchorLocation, setAnchorLocation] = useState<AnchorLocation | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [statusMessage, setStatusMessage] = useState("Loading Construct workspace...");
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("brief");
  const [checkResponses, setCheckResponses] = useState<Record<string, string>>({});
  const [checkReviews, setCheckReviews] = useState<Record<string, CheckReview>>({});
  const [taskRunState, setTaskRunState] = useState<TaskRunState>("idle");
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [taskError, setTaskError] = useState("");
  const [guideVisible, setGuideVisible] = useState(false);
  const [revealedHintLevel, setRevealedHintLevel] = useState(0);
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
  const guidePrompts = useMemo(
    () => (activeStep ? buildGuidancePrompts(activeStep) : []),
    [activeStep]
  );
  const stepHints = useMemo(
    () => (activeStep ? buildStepHints(activeStep) : []),
    [activeStep]
  );
  const activeStepIndex = useMemo(
    () => blueprint?.steps.findIndex((step) => step.id === activeStepId) ?? -1,
    [activeStepId, blueprint]
  );
  const checksAnswered = useMemo(() => {
    if (!activeStep) {
      return 0;
    }

    return activeStep.checks.filter((check) =>
      hasAnsweredCheck(check, checkResponses[check.id])
    ).length;
  }, [activeStep, checkResponses]);
  const canApplyStep = useMemo(() => {
    if (!activeStep) {
      return false;
    }

    return (
      activeStep.checks.length === 0 ||
      activeStep.checks.every((check) => hasAnsweredCheck(check, checkResponses[check.id]))
    );
  }, [activeStep, checkResponses]);
  const activeTaskResult =
    activeStep && taskResult?.stepId === activeStep.id ? taskResult : null;
  const blueprintPath = blueprint
    ? resolveBlueprintDefinitionPath(blueprint.projectRoot)
    : "";

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

        const initialStep = blueprintEnvelope.blueprint.steps[0];
        if (initialStep) {
          setActiveStepId(initialStep.id);
          setSurfaceMode("brief");
          setStatusMessage(`Loaded ${blueprintEnvelope.blueprint.name}. Review the first unit.`);
        } else {
          setStatusMessage(`Loaded ${blueprintEnvelope.blueprint.name}.`);
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

  const handleStepSelect = (step: BlueprintStep) => {
    setActiveStepId(step.id);
    setSurfaceMode("brief");
    setAnchorLocation(null);
    setGuideVisible(false);
    setRevealedHintLevel(0);
    setTaskResult((current) => (current?.stepId === step.id ? current : null));
    setTaskError("");
    setStatusMessage(`Loaded brief for ${step.title}.`);
  };

  const handleApplyStep = async () => {
    if (!activeStep) {
      return;
    }

    await openToAnchor(activeStep, {
      setActiveFilePath,
      setEditorValue,
      setSavedValue,
      setActiveStepId,
      setAnchorLocation,
      setLoadError,
      setStatusMessage,
      activeRequestIdRef
    });
    setSurfaceMode("focus");
  };

  const handleFileClick = async (filePath: string) => {
    const linkedStep =
      blueprint?.steps.find((step) => step.anchor.file === filePath) ?? null;
    await openFile(filePath, linkedStep);
  };

  const handleCheckResponseChange = (
    check: ComprehensionCheck,
    response: string
  ) => {
    setCheckResponses((current) => ({
      ...current,
      [check.id]: response
    }));

    if (check.type === "mcq") {
      setCheckReviews((current) => ({
        ...current,
        [check.id]: evaluateCheckResponse(check, response)
      }));
    }
  };

  const handleCheckReview = (check: ComprehensionCheck) => {
    const response = checkResponses[check.id] ?? "";
    if (!hasAnsweredCheck(check, response)) {
      return;
    }

    setCheckReviews((current) => ({
      ...current,
      [check.id]: evaluateCheckResponse(check, response)
    }));
  };

  const handleSubmitTask = async () => {
    if (!activeStep || !blueprintPath) {
      return;
    }

    setTaskRunState("running");
    setTaskError("");

    try {
      const result = await executeBlueprintTask(blueprintPath, activeStep.id);
      setTaskResult(result);
      setStatusMessage(
        result.status === "passed"
          ? `Passed ${activeStep.title}.`
          : `Targeted tests failed for ${activeStep.title}.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to execute ${activeStep.id}.`;
      setTaskError(message);
      setStatusMessage(message);
    } finally {
      setTaskRunState("idle");
    }
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
        className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1680px] flex-col gap-4"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
      >
        <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/45 px-6 py-5 shadow-2xl shadow-cyan-950/20 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.35em] text-teal-300">
                Construct Phase 5
              </p>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-white">
                  Technical brief and guided execution are now connected.
                </h1>
                <p className="max-w-4xl text-sm leading-7 text-slate-300">
                  Each unit now starts in a readable brief with quick checks, then
                  moves into a focused coding mode with a persistent guidance console,
                  targeted test submission, deterministic hints, and direct anchor
                  navigation.
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

        <section className="grid flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_380px]">
          <aside className="flex min-h-[760px] flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 shadow-xl shadow-cyan-950/15 backdrop-blur">
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

          <section className="flex min-h-[760px] flex-col gap-4">
            <AnimatePresence initial={false}>
              {surfaceMode === "brief" && activeStep ? (
                <motion.article
                  key={activeStep.id}
                  initial={{ opacity: 0, y: 18, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -12, height: 0 }}
                  transition={{ duration: 0.24, ease: "easeOut" }}
                  className="overflow-hidden rounded-[30px] border border-white/10 bg-slate-950/45 shadow-xl shadow-cyan-950/15 backdrop-blur"
                >
                  <div className="max-h-[420px] overflow-auto px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                      <div className="space-y-3">
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                          Technical Brief
                        </p>
                        <div className="space-y-2">
                          <h2 className="text-2xl font-semibold text-white">
                            {activeStep.title}
                          </h2>
                          <p className="max-w-3xl text-sm leading-7 text-slate-300">
                            {activeStep.summary}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] ${
                            difficultyStyles[activeStep.difficulty]
                          }`}
                        >
                          {activeStep.difficulty}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-200">
                          {activeStep.estimatedMinutes} min
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-200">
                          Step {activeStepIndex + 1} / {blueprint?.steps.length ?? 0}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
                      <div className="space-y-4">
                        <LearningBlock
                          eyebrow="Core Idea"
                          title="Why this unit matters"
                          body={activeStep.doc}
                        />
                        <LearningBlock
                          eyebrow="Implementation Target"
                          title="Where the work lands"
                          body={`${activeStep.anchor.file} at ${activeStep.anchor.marker}`}
                        />
                      </div>

                      <div className="space-y-4">
                        <MetadataGroup
                          title="Concepts"
                          values={activeStep.concepts}
                          accent="rgba(125,211,252,0.22)"
                        />
                        <MetadataGroup
                          title="Execution constraints"
                          values={activeStep.constraints}
                          accent="rgba(249,115,22,0.22)"
                        />
                        <MetadataGroup
                          title="Targeted tests"
                          values={activeStep.tests}
                          accent="rgba(20,184,166,0.22)"
                        />
                      </div>
                    </div>

                    <section className="space-y-4 border-t border-white/10 pt-5">
                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                            Quick checks
                          </p>
                          <h3 className="text-lg font-semibold text-white">
                            Confirm the operating assumptions before you code.
                          </h3>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
                          {checksAnswered}/{activeStep.checks.length} addressed
                        </span>
                      </div>

                      <div className="space-y-4">
                        {activeStep.checks.length > 0 ? (
                          activeStep.checks.map((check) => (
                            <CheckCard
                              key={check.id}
                              check={check}
                              response={checkResponses[check.id] ?? ""}
                              review={checkReviews[check.id]}
                              onResponseChange={handleCheckResponseChange}
                              onReview={handleCheckReview}
                            />
                          ))
                        ) : (
                          <EmptyState label="This unit does not require a preliminary check." />
                        )}
                      </div>
                    </section>
                  </div>
                </motion.article>
              ) : null}
            </AnimatePresence>

            <section className="flex min-h-[380px] flex-1 flex-col rounded-[30px] border border-white/10 bg-slate-950/45 shadow-xl shadow-cyan-950/15 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                    Editor Surface
                  </p>
                  <h2 className="text-lg font-semibold text-white">
                    {activeFilePath || "Apply a unit to open the implementation target"}
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    {activeStep ? activeStep.title : "No active unit"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                    {surfaceMode === "brief" ? "Brief mode" : "Execution mode"}
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
                  <div className="flex h-full items-center justify-center px-5">
                    <EmptyState label="Review the active unit, then move it into the editor from the guidance console." />
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 bg-slate-950/55 px-5 py-4">
                <PanelTitle
                  title="Execution Output"
                  subtitle="Latest targeted test run for the active unit."
                />
                <div className="mt-3 max-h-[220px] overflow-auto rounded-[22px] border border-white/10 bg-slate-900/65 p-4">
                  <ExecutionOutput
                    activeStep={activeStep}
                    taskRunState={taskRunState}
                    taskResult={activeTaskResult}
                    taskError={taskError}
                  />
                </div>
              </div>
            </section>
          </section>

          <aside className="flex min-h-[760px] flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 shadow-xl shadow-cyan-950/15 backdrop-blur">
            <motion.section
              layout
              className="rounded-[24px] border border-white/10 bg-slate-900/75 p-4 shadow-lg shadow-cyan-950/20"
            >
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                    Guidance Console
                  </p>
                  <h2 className="text-lg font-semibold text-white">
                    {activeStep ? activeStep.title : "No active unit"}
                  </h2>
                  <p className="text-sm leading-6 text-slate-300">
                    {activeStep
                      ? activeStep.summary
                      : "Select a unit to review its brief and execution target."}
                  </p>
                </div>

                {activeStep ? (
                  <>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                        Step {activeStepIndex + 1} / {blueprint?.steps.length ?? 0}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                        {surfaceMode === "brief" ? "Brief mode" : "Execution mode"}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                        {activeStep.tests.length} test
                        {activeStep.tests.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {surfaceMode === "brief" ? (
                      <div className="space-y-4 rounded-[20px] border border-teal-300/15 bg-teal-400/8 p-4">
                        <p className="text-sm leading-6 text-slate-200">
                          Address the quick checks, then move this unit into the editor.
                          Construct will open the exact anchor and keep the execution
                          controls here.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void handleApplyStep();
                          }}
                          disabled={!canApplyStep}
                          className={`w-full rounded-[18px] px-4 py-3 text-sm font-medium transition ${
                            canApplyStep
                              ? "bg-teal-400 text-slate-950 hover:bg-teal-300"
                              : "cursor-not-allowed bg-white/10 text-slate-500"
                          }`}
                        >
                          Apply to workspace
                        </button>
                        <p className="text-xs leading-6 text-slate-400">
                          {activeStep.checks.length > 0 && !canApplyStep
                            ? "Answer the quick checks first so the brief has been acknowledged."
                            : "The editor will jump directly to the task anchor."}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <MetadataGroup
                          title="Targeted tests"
                          values={activeStep.tests}
                          accent="rgba(20,184,166,0.18)"
                        />
                        <MetadataGroup
                          title="Constraints"
                          values={activeStep.constraints}
                          accent="rgba(249,115,22,0.18)"
                        />

                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              void handleSubmitTask();
                            }}
                            disabled={taskRunState === "running"}
                            className={`rounded-[16px] px-4 py-3 text-sm font-medium transition ${
                              taskRunState === "running"
                                ? "cursor-wait bg-white/10 text-slate-400"
                                : "bg-teal-400 text-slate-950 hover:bg-teal-300"
                            }`}
                          >
                            {taskRunState === "running" ? "Running tests..." : "Submit unit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setGuideVisible((current) => !current);
                            }}
                            className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                          >
                            {guideVisible ? "Hide guide prompts" : "Ask guide"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSurfaceMode("brief");
                              setStatusMessage(`Returned to the brief for ${activeStep.title}.`);
                            }}
                            className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                          >
                            Back to brief
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleApplyStep();
                            }}
                            className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                          >
                            Refocus anchor
                          </button>
                        </div>

                        <div className="space-y-3 rounded-[20px] border border-white/10 bg-slate-950/55 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                                Deterministic hints
                              </p>
                              <p className="text-sm leading-6 text-slate-300">
                                Phase 5 ships local hints derived from the unit metadata.
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {[1, 2, 3].map((level) => (
                                <button
                                  key={level}
                                  type="button"
                                  onClick={() => {
                                    setRevealedHintLevel((current) =>
                                      Math.max(current, level)
                                    );
                                  }}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                                >
                                  Hint L{level}
                                </button>
                              ))}
                            </div>
                          </div>

                          {revealedHintLevel > 0 ? (
                            <div className="space-y-3">
                              {stepHints.slice(0, revealedHintLevel).map((hint, index) => (
                                <div
                                  key={hint}
                                  className="rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3"
                                >
                                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                    Hint L{index + 1}
                                  </p>
                                  <p className="mt-2 text-sm leading-6 text-slate-200">
                                    {hint}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm leading-6 text-slate-400">
                              Reveal hints only when you have tried to implement the unit.
                            </p>
                          )}
                        </div>

                        <AnimatePresence initial={false}>
                          {guideVisible ? (
                            <motion.div
                              initial={{ opacity: 0, y: 12, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: "auto" }}
                              exit={{ opacity: 0, y: -12, height: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden rounded-[20px] border border-sky-300/15 bg-sky-400/8 p-4"
                            >
                              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                                Guide prompts
                              </p>
                              <div className="mt-3 space-y-3">
                                {guidePrompts.map((prompt) => (
                                  <div
                                    key={prompt}
                                    className="rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-slate-200"
                                  >
                                    {prompt}
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    )}
                  </>
                ) : (
                  <EmptyState label="Blueprint metadata has not loaded yet." />
                )}
              </div>
            </motion.section>

            <div className="min-h-0 flex-1 overflow-auto rounded-[22px] border border-white/10 bg-slate-900/65 p-3">
              {blueprint ? (
                <section className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                      Execution Units
                    </p>
                    <h3 className="text-sm font-medium text-white">{blueprint.name}</h3>
                    <p className="text-sm leading-6 text-slate-300">
                      {blueprint.description}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {blueprint.steps.map((step, index) => {
                      const isActive = step.id === activeStepId;

                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => {
                            handleStepSelect(step);
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
                          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                            <span>
                              {step.anchor.file} · {step.anchor.marker}
                            </span>
                            <span>
                              {step.estimatedMinutes} min
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <EmptyState label="Blueprint metadata has not loaded yet." />
              )}
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

function LearningBlock({
  eyebrow,
  title,
  body
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-slate-900/65 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p>
      <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-300">{body}</p>
    </section>
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

function CheckCard({
  check,
  response,
  review,
  onResponseChange,
  onReview
}: {
  check: ComprehensionCheck;
  response: string;
  review?: CheckReview;
  onResponseChange: (check: ComprehensionCheck, response: string) => void;
  onReview: (check: ComprehensionCheck) => void;
}) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-slate-900/65 p-4">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
          {check.type === "mcq" ? "Multiple choice" : "Short response"}
        </p>
        <h4 className="text-base font-semibold text-white">{check.prompt}</h4>
      </div>

      {check.type === "mcq" ? (
        <div className="mt-4 space-y-2">
          {check.options.map((option) => {
            const isSelected = response === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onResponseChange(check, option.id);
                }}
                className={`w-full rounded-[16px] border px-4 py-3 text-left text-sm transition ${
                  isSelected
                    ? "border-teal-300/60 bg-teal-400/10 text-teal-100"
                    : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <textarea
            value={response}
            onChange={(event) => {
              onResponseChange(check, event.target.value);
            }}
            placeholder={check.placeholder ?? "Write a short technical explanation."}
            className="min-h-[110px] w-full rounded-[16px] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
          />
          <button
            type="button"
            onClick={() => {
              onReview(check);
            }}
            disabled={!hasAnsweredCheck(check, response)}
            className={`rounded-[16px] px-4 py-2.5 text-sm font-medium transition ${
              hasAnsweredCheck(check, response)
                ? "bg-white/8 text-slate-100 hover:bg-white/12"
                : "cursor-not-allowed bg-white/5 text-slate-500"
            }`}
          >
            Review response
          </button>
        </div>
      )}

      {review ? (
        <div
          className={`mt-4 rounded-[18px] border px-4 py-3 text-sm ${
            review.status === "complete"
              ? "border-teal-300/20 bg-teal-400/10 text-teal-100"
              : "border-amber-300/20 bg-amber-400/10 text-amber-100"
          }`}
        >
          <p>{review.message}</p>
          {review.missingCriteria.length > 0 ? (
            <div className="mt-2 space-y-1 text-xs leading-6 text-slate-200">
              {review.missingCriteria.map((criterion) => (
                <p key={criterion}>Missing: {criterion}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExecutionOutput({
  activeStep,
  taskRunState,
  taskResult,
  taskError
}: {
  activeStep: BlueprintStep | null;
  taskRunState: TaskRunState;
  taskResult: TaskResult | null;
  taskError: string;
}) {
  if (!activeStep) {
    return <EmptyState label="Select a unit to see targeted execution output." />;
  }

  if (taskRunState === "running") {
    return (
      <div className="space-y-2 text-sm text-slate-300">
        <p className="text-white">Running targeted tests for {activeStep.title}.</p>
        <p>Construct is executing only the tests attached to this unit.</p>
      </div>
    );
  }

  if (taskError) {
    return (
      <div className="rounded-[18px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
        {taskError}
      </div>
    );
  }

  if (!taskResult) {
    return (
      <EmptyState label="No targeted test run yet. Submit the active unit from the guidance console." />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.22em] ${
            taskResult.status === "passed"
              ? "bg-teal-400/15 text-teal-100"
              : "bg-amber-400/15 text-amber-100"
          }`}
        >
          {taskResult.status}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
          {formatDuration(taskResult.durationMs)}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
          {taskResult.adapter}
        </span>
      </div>

      {taskResult.failures.length > 0 ? (
        <div className="space-y-3">
          {taskResult.failures.map((failure) => (
            <div
              key={`${failure.testName}-${failure.message}`}
              className="rounded-[18px] border border-amber-300/20 bg-amber-400/10 px-4 py-3"
            >
              <p className="text-sm font-medium text-amber-100">{failure.testName}</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{failure.message}</p>
              {failure.stackTrace ? (
                <pre className="mt-3 overflow-auto rounded-[14px] bg-slate-950/70 p-3 text-xs leading-6 text-slate-300">
                  {failure.stackTrace}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-teal-300/20 bg-teal-400/10 px-4 py-3 text-sm text-teal-100">
          All targeted tests passed for this unit.
        </div>
      )}

      {(taskResult.stdout || taskResult.stderr) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <OutputBlock label="stdout" content={taskResult.stdout} />
          <OutputBlock label="stderr" content={taskResult.stderr} />
        </div>
      )}
    </div>
  );
}

function OutputBlock({ label, content }: { label: string; content: string }) {
  if (!content) {
    return null;
  }

  return (
    <div className="rounded-[18px] border border-white/10 bg-slate-950/70 p-3">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <pre className="mt-2 overflow-auto text-xs leading-6 text-slate-300">{content}</pre>
    </div>
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
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
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

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

const difficultyStyles: Record<BlueprintStep["difficulty"], string> = {
  intro: "bg-sky-400/15 text-sky-100",
  core: "bg-teal-400/15 text-teal-100",
  advanced: "bg-amber-400/15 text-amber-100"
};
