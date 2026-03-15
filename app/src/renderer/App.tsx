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
  fetchBlueprint,
  fetchLearnerModel,
  fetchRunnerHealth,
  fetchTaskProgress,
  fetchWorkspaceFile,
  fetchWorkspaceFiles,
  saveWorkspaceFile,
  startBlueprintTask,
  submitBlueprintTask
} from "./lib/api";
import { buildWorkspaceTree } from "./lib/tree";
import { monaco } from "./monaco";
import type {
  AnchorLocation,
  BlueprintStep,
  ComprehensionCheck,
  LearnerModel,
  ProjectBlueprint,
  RunnerHealth,
  RuntimeInfo,
  TaskProgress,
  TaskResult,
  TaskSession,
  TaskTelemetry,
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
type ThemeMode = "light" | "dark";
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
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [checkResponses, setCheckResponses] = useState<Record<string, string>>({});
  const [checkReviews, setCheckReviews] = useState<Record<string, CheckReview>>({});
  const [taskRunState, setTaskRunState] = useState<TaskRunState>("idle");
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const [taskSession, setTaskSession] = useState<TaskSession | null>(null);
  const [learnerModel, setLearnerModel] = useState<LearnerModel | null>(null);
  const [taskTelemetry, setTaskTelemetry] = useState<TaskTelemetry>(createEmptyTelemetry());
  const [taskError, setTaskError] = useState("");
  const [guideVisible, setGuideVisible] = useState(false);
  const [revealedHintLevel, setRevealedHintLevel] = useState(0);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const activeRequestIdRef = useRef(0);
  const telemetryRef = useRef<TaskTelemetry>(createEmptyTelemetry());
  const pendingPasteCharsRef = useRef(0);

  const activeStep = useMemo(
    () => blueprint?.steps.find((step) => step.id === activeStepId) ?? null,
    [activeStepId, blueprint]
  );
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaceFiles), [workspaceFiles]);
  const filteredTree = useMemo(
    () => filterTreeNodes(workspaceTree, filterQuery),
    [filterQuery, workspaceTree]
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
  const activeTaskProgress =
    activeStep && taskProgress?.stepId === activeStep.id ? taskProgress : null;
  const blueprintPath = blueprint
    ? resolveBlueprintDefinitionPath(blueprint.projectRoot)
    : "";
  const overlayVisible = surfaceMode === "brief" && Boolean(activeStep);
  const explorerIsFiltered = filterQuery.trim().length > 0;
  const editorTheme = theme === "dark" ? "vs-dark" : "vs";
  const saveStateLabel =
    saveState === "saving"
      ? "Saving"
      : saveState === "error"
        ? "Save failed"
        : "Saved";
  const snapshotLabel = taskSession
    ? `snapshot ${formatCommitId(taskSession.preTaskSnapshot.commitId)}`
    : "No snapshot";
  const taskAttemptLabel = activeTaskProgress
    ? `${activeTaskProgress.totalAttempts} attempt${
        activeTaskProgress.totalAttempts === 1 ? "" : "s"
      }`
    : "No attempts";

  useEffect(() => {
    document.documentElement.dataset.constructTheme = theme;
    window.localStorage.setItem("construct.theme", theme);
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();

    const loadWorkspace = async () => {
      try {
        const [health, blueprintEnvelope, filesEnvelope, learner] = await Promise.all([
          fetchRunnerHealth(controller.signal),
          fetchBlueprint(controller.signal),
          fetchWorkspaceFiles(controller.signal),
          fetchLearnerModel(controller.signal)
        ]);

        setRunnerHealth(health);
        setBlueprint(blueprintEnvelope.blueprint);
        setWorkspaceFiles(filesEnvelope.files);
        setLearnerModel(learner);
        setLoadError("");

        const initialStep = blueprintEnvelope.blueprint.steps[0];
        if (initialStep) {
          setActiveStepId(initialStep.id);
          setSurfaceMode("brief");
          setStatusMessage(`Loaded ${blueprintEnvelope.blueprint.name}.`);
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

  useEffect(() => {
    if (workspaceTree.length === 0) {
      return;
    }

    const directories = collectDirectoryPaths(workspaceTree);
    setExpandedDirectories((current) => {
      const next = { ...current };
      let changed = false;

      for (const directory of directories) {
        if (next[directory] === undefined) {
          next[directory] = true;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [workspaceTree]);

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }

    const ancestorDirectories = getAncestorDirectoryPaths(activeFilePath);
    setExpandedDirectories((current) => {
      const next = { ...current };
      let changed = false;

      for (const directory of ancestorDirectories) {
        if (!next[directory]) {
          next[directory] = true;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [activeFilePath]);

  useEffect(() => {
    if (!activeStepId) {
      setTaskProgress(null);
      setTaskSession(null);
      return;
    }

    const controller = new AbortController();

    const loadStepProgress = async () => {
      try {
        const progress = await fetchTaskProgress(activeStepId, controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        setTaskProgress(progress);
        setTaskSession(progress.activeSession);
        setTaskResult(progress.latestAttempt?.result ?? null);
        setTaskError("");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (runnerHealth?.status === "ready") {
          setTaskError(
            error instanceof Error ? error.message : `Failed to load progress for ${activeStepId}.`
          );
        }
      }
    };

    void loadStepProgress();

    return () => {
      controller.abort();
    };
  }, [activeStepId, runnerHealth?.status]);

  const resetTaskTelemetry = () => {
    const emptyTelemetry = createEmptyTelemetry();
    pendingPasteCharsRef.current = 0;
    telemetryRef.current = emptyTelemetry;
    setTaskTelemetry(emptyTelemetry);
  };

  const syncTelemetry = () => {
    const nextTelemetry = normalizeTelemetryDraft(telemetryRef.current);
    telemetryRef.current = nextTelemetry;
    setTaskTelemetry(nextTelemetry);
  };

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
    setGuideVisible(false);
    setRevealedHintLevel(0);
    resetTaskTelemetry();
    setTaskSession(null);
    setTaskResult((current) => (current?.stepId === step.id ? current : null));
    setTaskError("");
    setStatusMessage(`Opened brief for ${step.title}.`);
  };

  const handleApplyStep = async () => {
    if (!activeStep || !blueprintPath) {
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
    setGuideVisible(false);
    setTaskError("");
    resetTaskTelemetry();

    try {
      const started = await startBlueprintTask(blueprintPath, activeStep.id);
      setTaskSession(started.session);
      setTaskProgress(started.progress);
      setLearnerModel(started.learnerModel);
      setTaskResult(started.progress.latestAttempt?.result ?? null);
      setStatusMessage(
        `Focused ${activeStep.title}. ${formatCommitId(started.session.preTaskSnapshot.commitId)} is ready as the pre-task snapshot.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to start ${activeStep.id}.`;
      setTaskError(message);
      setStatusMessage(message);
    }
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
      let session = taskSession;

      if (!session || session.stepId !== activeStep.id || session.status !== "active") {
        const started = await startBlueprintTask(blueprintPath, activeStep.id);
        session = started.session;
        setTaskSession(started.session);
        setTaskProgress(started.progress);
        setLearnerModel(started.learnerModel);
      }

      const submission = await submitBlueprintTask({
        blueprintPath,
        stepId: activeStep.id,
        sessionId: session.sessionId,
        telemetry: telemetryRef.current
      });

      setTaskSession(submission.session);
      setTaskProgress(submission.progress);
      setLearnerModel(submission.learnerModel);
      setTaskResult(submission.attempt.result);
      setGuideVisible(submission.attempt.status === "failed");
      resetTaskTelemetry();
      setRevealedHintLevel(0);
      setStatusMessage(
        submission.attempt.status === "passed"
          ? `Passed ${activeStep.title} on attempt ${submission.attempt.attempt}.`
          : `Targeted tests failed for ${activeStep.title} on attempt ${submission.attempt.attempt}.`
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

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  return (
    <main className="construct-app">
      <div className="construct-layout">
        <aside className="construct-explorer">
          <div className="construct-filter-shell">
            <input
              value={filterQuery}
              onChange={(event) => {
                setFilterQuery(event.target.value);
              }}
              placeholder="Filter files..."
              className="construct-filter-input"
              aria-label="Filter files"
            />
          </div>

          <div className="construct-explorer-scroll">
            {filteredTree.length > 0 ? (
              <nav className="construct-tree" aria-label="Workspace files">
                {filteredTree.map((node) => (
                  <ExplorerTreeNode
                    key={node.path}
                    node={node}
                    activeFilePath={activeFilePath}
                    onSelectFile={handleFileClick}
                    expandedDirectories={expandedDirectories}
                    onToggleDirectory={(path) => {
                      setExpandedDirectories((current) => ({
                        ...current,
                        [path]: !(current[path] ?? true)
                      }));
                    }}
                    forceExpanded={explorerIsFiltered}
                  />
                ))}
              </nav>
            ) : (
              <div className="construct-explorer-empty">
                {filterQuery.trim().length > 0
                  ? "No files match the current filter."
                  : "No files loaded yet."}
              </div>
            )}
          </div>
        </aside>

        <section className="construct-stage">
          <section className="construct-editor-shell">
            <header className="construct-editor-chrome">
              <div className="construct-editor-chrome-left">
                <span className="construct-toolbar-pill">{saveStateLabel}</span>
                <span className="construct-toolbar-pill">
                  {runnerHealth?.status ?? "offline"}
                </span>
                <span className="construct-toolbar-pill">{taskAttemptLabel}</span>
                <span className="construct-toolbar-pill">{snapshotLabel}</span>
              </div>

              <div className="construct-editor-chrome-center">
                <div className="construct-toolbar-center">
                  <span className="construct-toolbar-title">
                    {activeStep ? activeStep.title : blueprint?.name ?? "Construct"}
                  </span>
                </div>
              </div>

              <div className="construct-editor-chrome-right">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="construct-theme-toggle"
                >
                  {theme === "light" ? "Dark mode" : "Light mode"}
                </button>
              </div>
            </header>

            {activeFilePath ? (
              <Editor
                height="100%"
                theme={editorTheme}
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

                  const domNode = editor.getDomNode();
                  const pasteTarget = domNode?.querySelector(".inputarea") ?? domNode;
                  const handlePaste = (event: Event) => {
                    const clipboardEvent = event as ClipboardEvent;
                    const pastedText = clipboardEvent.clipboardData?.getData("text") ?? "";

                    if (pastedText.length > 0) {
                      pendingPasteCharsRef.current += pastedText.length;
                    }
                  };
                  const changeDisposable = editor.onDidChangeModelContent((event) => {
                    if (event.isFlush || event.isUndoing || event.isRedoing) {
                      return;
                    }

                    let insertedCharacters = event.changes.reduce(
                      (total, change) => total + change.text.length,
                      0
                    );

                    if (insertedCharacters <= 0) {
                      return;
                    }

                    if (pendingPasteCharsRef.current > 0) {
                      const pastedCharacters = Math.min(
                        pendingPasteCharsRef.current,
                        insertedCharacters
                      );
                      telemetryRef.current = {
                        ...telemetryRef.current,
                        pastedChars: telemetryRef.current.pastedChars + pastedCharacters
                      };
                      pendingPasteCharsRef.current -= pastedCharacters;
                      insertedCharacters -= pastedCharacters;
                    }

                    if (insertedCharacters > 0) {
                      telemetryRef.current = {
                        ...telemetryRef.current,
                        typedChars: telemetryRef.current.typedChars + insertedCharacters
                      };
                    }

                    syncTelemetry();
                  });

                  pasteTarget?.addEventListener("paste", handlePaste);
                  editor.onDidDispose(() => {
                    changeDisposable.dispose();
                    pasteTarget?.removeEventListener("paste", handlePaste);
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
                  lineNumbersMinChars: 4,
                  tabSize: 2,
                  padding: {
                    top: 140,
                    bottom: 112
                  }
                }}
              />
            ) : (
              <div className="construct-editor-empty">
                <span>MONACO EDITOR</span>
              </div>
            )}

            <div className="construct-status-strip">
              <span className="construct-status-item">
                {activeFilePath || "No file focused"}
              </span>
              <span className="construct-status-item">
                {statusMessage}
              </span>
              <span className="construct-status-item">
                {activeStep ? `Step ${activeStepIndex + 1}` : "No step"}
              </span>
              {loadError ? (
                <span className="construct-status-item is-error">{loadError}</span>
              ) : null}
            </div>

            {surfaceMode === "focus" && activeStep ? (
              <FloatingGuideCard
                activeStep={activeStep}
                activeStepIndex={activeStepIndex}
                blueprint={blueprint}
                guidePrompts={guidePrompts}
                guideVisible={guideVisible}
                learnerModel={learnerModel}
                onToggleGuide={() => {
                  setGuideVisible((current) => !current);
                }}
                onSubmitTask={() => {
                  void handleSubmitTask();
                }}
                onOpenBrief={() => {
                  setSurfaceMode("brief");
                  setStatusMessage(`Opened brief for ${activeStep.title}.`);
                }}
                onRefocus={() => {
                  void handleApplyStep();
                }}
                onRevealHint={(level) => {
                  setRevealedHintLevel((current) => {
                    if (level <= current) {
                      return current;
                    }

                    telemetryRef.current = {
                      ...telemetryRef.current,
                      hintsUsed: telemetryRef.current.hintsUsed + (level - current)
                    };
                    syncTelemetry();

                    return level;
                  });
                }}
                revealedHintLevel={revealedHintLevel}
                stepHints={stepHints}
                taskProgress={activeTaskProgress}
                taskRunState={taskRunState}
                taskResult={activeTaskResult}
                taskSession={taskSession}
                taskError={taskError}
                taskTelemetry={taskTelemetry}
              />
            ) : null}
          </section>
        </section>
      </div>

      <AnimatePresence>
        {overlayVisible && activeStep ? (
          <BriefOverlay
            key={activeStep.id}
            blueprint={blueprint}
            activeStep={activeStep}
            activeStepIndex={activeStepIndex}
            checksAnswered={checksAnswered}
            canApplyStep={canApplyStep}
            checkResponses={checkResponses}
            checkReviews={checkReviews}
            onSelectStep={handleStepSelect}
            onApply={() => {
              void handleApplyStep();
            }}
            onCheckResponseChange={handleCheckResponseChange}
            onCheckReview={handleCheckReview}
            onToggleTheme={toggleTheme}
            theme={theme}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}

function FloatingGuideCard({
  activeStep,
  activeStepIndex,
  blueprint,
  guidePrompts,
  guideVisible,
  learnerModel,
  onToggleGuide,
  onSubmitTask,
  onOpenBrief,
  onRefocus,
  onRevealHint,
  revealedHintLevel,
  stepHints,
  taskProgress,
  taskRunState,
  taskResult,
  taskSession,
  taskError,
  taskTelemetry
}: {
  activeStep: BlueprintStep;
  activeStepIndex: number;
  blueprint: ProjectBlueprint | null;
  guidePrompts: string[];
  guideVisible: boolean;
  learnerModel: LearnerModel | null;
  onToggleGuide: () => void;
  onSubmitTask: () => void;
  onOpenBrief: () => void;
  onRefocus: () => void;
  onRevealHint: (level: number) => void;
  revealedHintLevel: number;
  stepHints: string[];
  taskProgress: TaskProgress | null;
  taskRunState: TaskRunState;
  taskResult: TaskResult | null;
  taskSession: TaskSession | null;
  taskError: string;
  taskTelemetry: TaskTelemetry;
}) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="construct-floating-card"
    >
      <div className="construct-floating-card-header">
        <div className="construct-floating-card-meta">
          <span className="construct-floating-card-kicker">Guide</span>
          <span className="construct-floating-card-step">
            Step {activeStepIndex + 1} / {blueprint?.steps.length ?? 0}
          </span>
        </div>
        <h2 className="construct-floating-card-title">{activeStep.title}</h2>
        <p className="construct-floating-card-summary">{activeStep.summary}</p>
      </div>

      <div className="construct-floating-card-body">
        <section className="construct-metadata-panel">
          <span className="construct-panel-kicker">Telemetry</span>
          <div className="construct-session-metrics">
            <MetricPill
              label="Attempts"
              value={`${taskProgress?.totalAttempts ?? 0}`}
            />
            <MetricPill
              label="Hints"
              value={`${taskTelemetry.hintsUsed}`}
            />
            <MetricPill
              label="Paste"
              value={`${Math.round(taskTelemetry.pasteRatio * 100)}%`}
            />
            <MetricPill
              label="Snapshot"
              value={
                taskSession ? formatCommitId(taskSession.preTaskSnapshot.commitId) : "pending"
              }
            />
          </div>
          <p className="construct-muted-copy">
            Recorded hints across this step: {learnerModel?.hintsUsed[activeStep.id] ?? 0}
          </p>
        </section>

        <MetadataList title="Tests" values={activeStep.tests} />
        <MetadataList title="Constraints" values={activeStep.constraints} />

        <div className="construct-floating-card-actions">
          <div className="construct-action-cluster">
            <button
              type="button"
              onClick={onSubmitTask}
              disabled={taskRunState === "running"}
              className="construct-primary-button"
            >
              {taskRunState === "running" ? "Running tests..." : "Submit"}
            </button>
            <button
              type="button"
              onClick={onOpenBrief}
              className="construct-secondary-button"
            >
              Open brief
            </button>
          </div>

          <div className="construct-action-cluster is-compact">
            <button
              type="button"
              onClick={onRefocus}
              className="construct-secondary-button"
            >
              Refocus anchor
            </button>
            <button
              type="button"
              onClick={onToggleGuide}
              className="construct-secondary-button"
            >
              {guideVisible ? "Hide guide" : "Ask guide"}
            </button>
          </div>
        </div>

        <div className="construct-floating-hints">
          <div className="construct-floating-hints-header">
            <span>Hints</span>
            <div className="construct-hint-actions">
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    onRevealHint(level);
                  }}
                  className="construct-hint-button"
                >
                  L{level}
                </button>
              ))}
            </div>
          </div>

          {revealedHintLevel > 0 ? (
            <div className="construct-hint-list">
              {stepHints.slice(0, revealedHintLevel).map((hint, index) => (
                <div key={hint} className="construct-hint-item">
                  <span className="construct-hint-label">Hint L{index + 1}</span>
                  <p>{hint}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="construct-muted-copy">
              Reveal hints only after you have tried the implementation.
            </p>
          )}
        </div>

        <AnimatePresence initial={false}>
          {guideVisible ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="construct-guide-prompts"
            >
              {guidePrompts.map((prompt) => (
                <div key={prompt} className="construct-guide-prompt">
                  {prompt}
                </div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <TaskResultPanel
          taskRunState={taskRunState}
          taskResult={taskResult}
          taskError={taskError}
          title={activeStep.title}
        />
      </div>
    </motion.aside>
  );
}

function BriefOverlay({
  blueprint,
  activeStep,
  activeStepIndex,
  checksAnswered,
  canApplyStep,
  checkResponses,
  checkReviews,
  onSelectStep,
  onApply,
  onCheckResponseChange,
  onCheckReview,
  onToggleTheme,
  theme
}: {
  blueprint: ProjectBlueprint | null;
  activeStep: BlueprintStep;
  activeStepIndex: number;
  checksAnswered: number;
  canApplyStep: boolean;
  checkResponses: Record<string, string>;
  checkReviews: Record<string, CheckReview>;
  onSelectStep: (step: BlueprintStep) => void;
  onApply: () => void;
  onCheckResponseChange: (check: ComprehensionCheck, response: string) => void;
  onCheckReview: (check: ComprehensionCheck) => void;
  onToggleTheme: () => void;
  theme: ThemeMode;
}) {
  return (
    <motion.div
      className="construct-brief-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <motion.div
        className="construct-brief-panel"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.985 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      >
        <aside className="construct-brief-rail">
          <div className="construct-brief-rail-header">
            <span className="construct-brief-kicker">Construct</span>
            <button
              type="button"
              onClick={onToggleTheme}
              className="construct-secondary-button"
            >
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
          </div>

          <div className="construct-brief-rail-body">
            <div className="construct-brief-rail-copy">
              <h2>{blueprint?.name ?? "Blueprint"}</h2>
              <p>{blueprint?.description ?? "Loading active blueprint."}</p>
            </div>

            <div className="construct-step-list">
              {blueprint?.steps.map((step, index) => {
                const isActive = step.id === activeStep.id;

                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      onSelectStep(step);
                    }}
                    className={`construct-step-list-item ${
                      isActive ? "is-active" : ""
                    }`}
                  >
                    <span className="construct-step-list-index">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <span>{step.estimatedMinutes} min</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="construct-brief-content">
          <header className="construct-brief-header">
            <div>
              <span className="construct-brief-kicker">Technical brief</span>
              <h1>{activeStep.title}</h1>
              <p>{activeStep.summary}</p>
            </div>
            <div className="construct-brief-header-meta">
              <span className="construct-brief-chip">
                Step {activeStepIndex + 1} / {blueprint?.steps.length ?? 0}
              </span>
              <span className="construct-brief-chip">
                {activeStep.estimatedMinutes} min
              </span>
              <span className="construct-brief-chip">
                {checksAnswered}/{activeStep.checks.length} checks
              </span>
            </div>
          </header>

          <div className="construct-brief-grid">
            <div className="construct-brief-column">
              <InfoPanel
                title="Objective"
                body={activeStep.doc}
              />
              <InfoPanel
                title="Implementation target"
                body={`${activeStep.anchor.file} at ${activeStep.anchor.marker}`}
              />
            </div>

            <div className="construct-brief-column">
              <MetadataList title="Concepts" values={activeStep.concepts} />
              <MetadataList title="Constraints" values={activeStep.constraints} />
              <MetadataList title="Tests" values={activeStep.tests} />
            </div>
          </div>

          <section className="construct-brief-checks">
            <div className="construct-brief-section-header">
              <div>
                <span className="construct-brief-kicker">Checks</span>
                <h2>Confirm the operating assumptions first.</h2>
              </div>
            </div>

            <div className="construct-check-list">
              {activeStep.checks.length > 0 ? (
                activeStep.checks.map((check) => (
                  <CheckCard
                    key={check.id}
                    check={check}
                    response={checkResponses[check.id] ?? ""}
                    review={checkReviews[check.id]}
                    onResponseChange={onCheckResponseChange}
                    onReview={onCheckReview}
                  />
                ))
              ) : (
                <div className="construct-empty-panel">
                  This unit does not require a pre-check.
                </div>
              )}
            </div>
          </section>

          <footer className="construct-brief-footer">
            <div className="construct-brief-footer-copy">
              The brief overlays the entire workspace by design. Apply the unit only
              when you are ready to implement it in the real code.
            </div>
            <button
              type="button"
              onClick={onApply}
              disabled={!canApplyStep}
              className="construct-primary-button"
            >
              Apply to workspace
            </button>
          </footer>
        </section>
      </motion.div>
    </motion.div>
  );
}

function ExplorerTreeNode({
  node,
  activeFilePath,
  onSelectFile,
  expandedDirectories,
  onToggleDirectory,
  forceExpanded,
  depth = 0
}: {
  node: TreeNode;
  activeFilePath: string;
  onSelectFile: (filePath: string) => void;
  expandedDirectories: Record<string, boolean>;
  onToggleDirectory: (path: string) => void;
  forceExpanded: boolean;
  depth?: number;
}) {
  const isDirectory = node.kind === "directory";
  const isExpanded = forceExpanded || expandedDirectories[node.path] !== false;
  const isActive = !isDirectory && node.path === activeFilePath;

  return (
    <div className="construct-tree-node">
      <button
        type="button"
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(node.path);
            return;
          }

          onSelectFile(node.path);
        }}
        className={`construct-tree-row ${isActive ? "is-active" : ""}`}
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        <span className="construct-tree-chevron">
          {isDirectory ? (isExpanded ? "⌄" : "›") : ""}
        </span>
        <span className="construct-tree-icon">
          {isDirectory ? <FolderIcon /> : <FileIcon filePath={node.path} />}
        </span>
        <span className="construct-tree-label">{node.name}</span>
      </button>

      {isDirectory && isExpanded ? (
        <div className="construct-tree-children">
          {node.children.map((child) => (
            <ExplorerTreeNode
              key={child.path}
              node={child}
              activeFilePath={activeFilePath}
              onSelectFile={onSelectFile}
              expandedDirectories={expandedDirectories}
              onToggleDirectory={onToggleDirectory}
              forceExpanded={forceExpanded}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2.75 5.5h4.1l1.2 1.5h9.2v7.25a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1V5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon({ filePath }: { filePath: string }) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  const label =
    extension === "ts" || extension === "tsx"
      ? "TS"
      : extension === "sql"
        ? "SQL"
        : extension === "json"
          ? "{}"
          : "</>";

  return <span className="construct-file-badge">{label}</span>;
}

function InfoPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="construct-info-panel">
      <span className="construct-panel-kicker">{title}</span>
      <p>{body}</p>
    </section>
  );
}

function MetadataList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) {
    return null;
  }

  return (
    <section className="construct-metadata-panel">
      <span className="construct-panel-kicker">{title}</span>
      <div className="construct-tag-list">
        {values.map((value) => (
          <span key={value} className="construct-tag">
            {value}
          </span>
        ))}
      </div>
    </section>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="construct-session-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
    <section className="construct-check-card">
      <div className="construct-check-header">
        <span className="construct-panel-kicker">
          {check.type === "mcq" ? "Multiple choice" : "Short response"}
        </span>
        <h3>{check.prompt}</h3>
      </div>

      {check.type === "mcq" ? (
        <div className="construct-check-options">
          {check.options.map((option) => {
            const isSelected = response === option.id;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onResponseChange(check, option.id);
                }}
                className={`construct-check-option ${isSelected ? "is-selected" : ""}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="construct-check-short-answer">
          <textarea
            value={response}
            onChange={(event) => {
              onResponseChange(check, event.target.value);
            }}
            placeholder={check.placeholder ?? "Write a concise technical answer."}
            className="construct-check-textarea"
          />
          <button
            type="button"
            onClick={() => {
              onReview(check);
            }}
            disabled={!hasAnsweredCheck(check, response)}
            className="construct-secondary-button"
          >
            Review answer
          </button>
        </div>
      )}

      {review ? (
        <div className={`construct-check-review ${review.status}`}>
          <p>{review.message}</p>
          {review.missingCriteria.length > 0 ? (
            <div className="construct-review-list">
              {review.missingCriteria.map((criterion) => (
                <span key={criterion}>{criterion}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TaskResultPanel({
  taskRunState,
  taskResult,
  taskError,
  title
}: {
  taskRunState: TaskRunState;
  taskResult: TaskResult | null;
  taskError: string;
  title: string;
}) {
  return (
    <section className="construct-task-results">
      <span className="construct-panel-kicker">Execution</span>

      {taskRunState === "running" ? (
        <div className="construct-empty-panel">
          Running targeted tests for {title}.
        </div>
      ) : taskError ? (
        <div className="construct-task-error">{taskError}</div>
      ) : !taskResult ? (
        <div className="construct-empty-panel">
          No targeted test run yet.
        </div>
      ) : (
        <div className="construct-task-result-body">
          <div className="construct-task-result-meta">
            <span className={`construct-task-status ${taskResult.status}`}>
              {taskResult.status}
            </span>
            <span className="construct-brief-chip">
              {formatDuration(taskResult.durationMs)}
            </span>
          </div>

          {taskResult.failures.length > 0 ? (
            <div className="construct-task-failures">
              {taskResult.failures.map((failure) => (
                <div
                  key={`${failure.testName}-${failure.message}`}
                  className="construct-task-failure"
                >
                  <strong>{failure.testName}</strong>
                  <p>{failure.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="construct-task-success">
              All targeted tests passed.
            </div>
          )}
        </div>
      )}
    </section>
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

function filterTreeNodes(nodes: TreeNode[], query: string): TreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return nodes;
  }

  const filteredNodes: TreeNode[] = [];

  for (const node of nodes) {
    const nameMatches = node.name.toLowerCase().includes(normalizedQuery);
    const filteredChildren = filterTreeNodes(node.children, query);

    if (nameMatches || filteredChildren.length > 0) {
      filteredNodes.push({
        ...node,
        children: filteredChildren
      });
    }
  }

  return filteredNodes;
}

function collectDirectoryPaths(nodes: TreeNode[]): string[] {
  const directories: string[] = [];

  for (const node of nodes) {
    if (node.kind === "directory") {
      directories.push(node.path, ...collectDirectoryPaths(node.children));
    }
  }

  return directories;
}

function getAncestorDirectoryPaths(filePath: string): string[] {
  const segments = filePath.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
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

function formatCommitId(commitId: string): string {
  return commitId.slice(0, 7);
}

function createEmptyTelemetry(): TaskTelemetry {
  return {
    hintsUsed: 0,
    pasteRatio: 0,
    typedChars: 0,
    pastedChars: 0
  };
}

function normalizeTelemetryDraft(telemetry: TaskTelemetry): TaskTelemetry {
  const totalCharacters = telemetry.typedChars + telemetry.pastedChars;

  return {
    ...telemetry,
    pasteRatio:
      totalCharacters > 0
        ? Number((telemetry.pastedChars / totalCharacters).toFixed(4))
        : 0
  };
}

function getInitialTheme(): ThemeMode {
  const storedTheme = window.localStorage.getItem("construct.theme");

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
