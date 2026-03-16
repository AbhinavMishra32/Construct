import Editor from "@monaco-editor/react";
import { AnimatePresence, motion } from "framer-motion";
import type { editor as MonacoEditor } from "monaco-editor";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight
} from "react-syntax-highlighter/dist/esm/styles/prism";

import { findAnchorLocation } from "./lib/anchors";
import {
  buildGuidancePrompts,
  buildStepHints,
  evaluateCheckResponse,
  hasAnsweredCheck,
  type CheckReview
} from "./lib/guide";
import {
  completePlanningSession,
  fetchBlueprint,
  fetchLearnerProfile,
  fetchLearnerModel,
  fetchProjectsDashboard,
  fetchRunnerHealth,
  fetchTaskProgress,
  fetchWorkspaceFile,
  fetchWorkspaceFiles,
  requestBlueprintDeepDive,
  requestRuntimeGuide,
  saveWorkspaceFile,
  selectProject,
  startPlanningSession,
  startBlueprintTask,
  submitBlueprintTask,
  syncCurrentProjectStep
} from "./lib/api";
import { buildWorkspaceTree } from "./lib/tree";
import { monaco } from "./monaco";
import type {
  AgentEvent,
  AnchorLocation,
  BlueprintDeepDiveResponse,
  BlueprintStep,
  ComprehensionCheck,
  GeneratedProjectPlan,
  LearningStyle,
  LearnerProfileResponse,
  LearnerModel,
  PlanningAnswer,
  PlanningSession,
  ProjectSummary,
  ProjectBlueprint,
  ProjectsDashboardResponse,
  RewriteGate,
  RunnerHealth,
  RuntimeInfo,
  RuntimeGuideResponse,
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
type PlanningAnswerDraft =
  | {
      answerType: "option";
      optionId: string;
    }
  | {
      answerType: "custom";
      customResponse: string;
    };

const runtimeInfo = window.construct.getRuntimeInfo();
const SAVE_DEBOUNCE_MS = 450;

function hasPlanningAnswer(answer: PlanningAnswerDraft | undefined): answer is PlanningAnswerDraft {
  if (!answer) {
    return false;
  }

  return answer.answerType === "option"
    ? Boolean(answer.optionId)
    : answer.customResponse.trim().length > 0;
}

export default function App() {
  const [runnerHealth, setRunnerHealth] = useState<RunnerHealth | null>(null);
  const [projectsDashboard, setProjectsDashboard] =
    useState<ProjectsDashboardResponse | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [blueprint, setBlueprint] = useState<ProjectBlueprint | null>(null);
  const [blueprintPath, setBlueprintPath] = useState("");
  const [canonicalBlueprintPath, setCanonicalBlueprintPath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [editorValue, setEditorValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [activeStepId, setActiveStepId] = useState("");
  const [anchorLocation, setAnchorLocation] = useState<AnchorLocation | null>(null);
  const [loadError, setLoadError] = useState("");
  const [projectsError, setProjectsError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [statusMessage, setStatusMessage] = useState("Loading Construct workspace...");
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("brief");
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [planningSession, setPlanningSession] = useState<PlanningSession | null>(null);
  const [planningPlan, setPlanningPlan] = useState<GeneratedProjectPlan | null>(null);
  const [planningOverlayOpen, setPlanningOverlayOpen] = useState(false);
  const [planningEvents, setPlanningEvents] = useState<AgentEvent[]>([]);
  const [planningGoal, setPlanningGoal] = useState("");
  const [planningLearningStyle, setPlanningLearningStyle] =
    useState<LearningStyle>("concept-first");
  const [planningAnswers, setPlanningAnswers] = useState<Record<string, PlanningAnswerDraft>>({});
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [checkResponses, setCheckResponses] = useState<Record<string, string>>({});
  const [checkReviews, setCheckReviews] = useState<Record<string, CheckReview>>({});
  const [checkAttemptCounts, setCheckAttemptCounts] = useState<Record<string, number>>({});
  const [taskRunState, setTaskRunState] = useState<TaskRunState>("idle");
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const [taskSession, setTaskSession] = useState<TaskSession | null>(null);
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfileResponse | null>(null);
  const [learnerModel, setLearnerModel] = useState<LearnerModel | null>(null);
  const [taskTelemetry, setTaskTelemetry] = useState<TaskTelemetry>(createEmptyTelemetry());
  const [taskError, setTaskError] = useState("");
  const [guideVisible, setGuideVisible] = useState(false);
  const [runtimeGuide, setRuntimeGuide] = useState<RuntimeGuideResponse | null>(null);
  const [runtimeGuideEvents, setRuntimeGuideEvents] = useState<AgentEvent[]>([]);
  const [runtimeGuideBusy, setRuntimeGuideBusy] = useState(false);
  const [runtimeGuideError, setRuntimeGuideError] = useState("");
  const [deepDiveBusy, setDeepDiveBusy] = useState(false);
  const [deepDiveError, setDeepDiveError] = useState("");
  const [revealedHintLevel, setRevealedHintLevel] = useState(0);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const activeRequestIdRef = useRef(0);
  const telemetryRef = useRef<TaskTelemetry>(createEmptyTelemetry());
  const pendingPasteCharsRef = useRef(0);
  const rewriteGateRef = useRef<RewriteGate | null>(null);

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
  const guideQuestions = runtimeGuide?.socraticQuestions ?? guidePrompts;
  const visibleHints = runtimeGuide
    ? [
        runtimeGuide.hints.level1,
        runtimeGuide.hints.level2,
        runtimeGuide.hints.level3
      ]
    : stepHints;
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
  const checksCompleted = useMemo(() => {
    if (!activeStep) {
      return 0;
    }

    return activeStep.checks.filter((check) =>
      checkReviews[check.id]?.status === "complete"
    ).length;
  }, [activeStep, checkReviews]);
  const canApplyStep = useMemo(() => {
    if (!activeStep) {
      return false;
    }

    return (
      activeStep.checks.length === 0 ||
      activeStep.checks.every((check) => checkReviews[check.id]?.status === "complete")
    );
  }, [activeStep, checkReviews]);
  const canCompletePlanning = useMemo(() => {
    if (!planningSession) {
      return false;
    }

    return planningSession.questions.every((question) =>
      hasPlanningAnswer(planningAnswers[question.id])
    );
  }, [planningAnswers, planningSession]);
  const activeTaskResult =
    activeStep && taskResult?.stepId === activeStep.id ? taskResult : null;
  const activeTaskProgress =
    activeStep && taskProgress?.stepId === activeStep.id ? taskProgress : null;
  const activeRewriteGate =
    activeTaskProgress?.activeSession?.rewriteGate ?? taskSession?.rewriteGate ?? null;
  const activeAttemptStatus = activeTaskProgress?.latestAttempt?.status ?? null;
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
    ? `snap ${formatCommitId(taskSession.preTaskSnapshot.commitId)}`
    : "No snap";
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

    const loadDashboard = async () => {
      try {
        const [health, projects, profile] = await Promise.all([
          fetchRunnerHealth(controller.signal),
          fetchProjectsDashboard(controller.signal),
          fetchLearnerProfile(controller.signal)
        ]);

        setRunnerHealth(health);
        setProjectsDashboard(projects);
        setLearnerProfile(profile);
        setPlanningSession(null);
        setPlanningPlan(null);
        setPlanningAnswers({});
        setPlanningEvents([]);
        setPlanningError("");
        setPlanningGoal("");
        setLoadError("");
        setProjectsError("");
        setBlueprint(null);
        setBlueprintPath("");
        setCanonicalBlueprintPath("");
        setWorkspaceFiles([]);
        setLearnerModel(null);
        setActiveStepId("");
        setTaskProgress(null);
        setTaskSession(null);
        setTaskResult(null);
        setActiveFilePath("");
        setEditorValue("");
        setSavedValue("");
        setAnchorLocation(null);
        setSurfaceMode("brief");
        setPlanningOverlayOpen(false);
        setDashboardOpen(true);
        setStatusMessage(
          projects.projects.length > 0
            ? "Choose a project to resume or start a new one."
            : "Start the first project to generate a guided build."
        );
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Runner is not reachable.";
        setLoadError(message);
        setProjectsError(message);
        setLearnerProfile(null);
        setStatusMessage("Construct is waiting for the local runner.");
      }
    };

    void loadDashboard();

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

  useEffect(() => {
    rewriteGateRef.current = activeRewriteGate;
  }, [activeRewriteGate]);

  useEffect(() => {
    if (!dashboardOpen) {
      return;
    }

    void refreshDashboardState().catch(() => {
      // Keep the last successful dashboard state if a refresh misses.
    });
  }, [dashboardOpen]);

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

  const appendPlanningEvent = (event: AgentEvent) => {
    setPlanningEvents((current) => appendAgentEvent(current, event));
  };

  const appendRuntimeGuideEvent = (event: AgentEvent) => {
    setRuntimeGuideEvents((current) => appendAgentEvent(current, event));
  };

  const hydrateWorkspace = async (preferredStepId?: string | null) => {
    const [blueprintEnvelope, filesEnvelope, learner] = await Promise.all([
      fetchBlueprint(),
      fetchWorkspaceFiles(),
      fetchLearnerModel()
    ]);

    if (!blueprintEnvelope.blueprint) {
      setBlueprint(null);
      setBlueprintPath("");
      setCanonicalBlueprintPath("");
      setWorkspaceFiles([]);
      setLearnerModel(null);
      setActiveStepId("");
      setTaskProgress(null);
      setTaskSession(null);
      setTaskResult(null);
      setActiveFilePath("");
      setEditorValue("");
      setSavedValue("");
      setAnchorLocation(null);
      setSurfaceMode("brief");
      return null;
    }

    const preferredStep =
      (preferredStepId
        ? blueprintEnvelope.blueprint.steps.find((step) => step.id === preferredStepId)
        : null) ?? blueprintEnvelope.blueprint.steps[0] ?? null;

    setBlueprint(blueprintEnvelope.blueprint);
    setBlueprintPath(blueprintEnvelope.blueprintPath);
    setCanonicalBlueprintPath(blueprintEnvelope.canonicalBlueprintPath ?? "");
    setWorkspaceFiles(filesEnvelope.files);
    setLearnerModel(learner);
    setActiveFilePath("");
    setEditorValue("");
    setSavedValue("");
    setAnchorLocation(null);
    setTaskProgress(null);
    setTaskSession(null);
    setTaskResult(null);
    setSurfaceMode("brief");

    if (preferredStep) {
      setActiveStepId(preferredStep.id);
    } else {
      setActiveStepId("");
    }

    return blueprintEnvelope.blueprint;
  };

  const refreshDashboardState = async (signal?: AbortSignal) => {
    const [projects, profile] = await Promise.all([
      fetchProjectsDashboard(signal),
      fetchLearnerProfile(signal)
    ]);
    setProjectsDashboard(projects);
    setLearnerProfile(profile);
    setProjectsError("");
    return projects;
  };

  const openProject = async (project: ProjectSummary) => {
    setDashboardBusy(true);
    setProjectsError("");

    try {
      const selection = await selectProject(project.id);
      const dashboardState = await refreshDashboardState();
      const selectedProject =
        dashboardState.projects.find((entry) => entry.id === selection.activeProjectId) ?? project;
      await hydrateWorkspace(selectedProject.currentStepId);
      setDashboardOpen(false);
      setPlanningOverlayOpen(false);
      setStatusMessage(
        `Resumed ${selectedProject.name} at ${
          selectedProject.currentStepTitle ?? "the current step"
        }.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to open ${project.name}.`;
      setProjectsError(message);
      setStatusMessage(message);
    } finally {
      setDashboardBusy(false);
    }
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
    setDeepDiveError("");
    setGuideVisible(false);
    setRuntimeGuide(null);
    setRuntimeGuideEvents([]);
    setRuntimeGuideError("");
    setRevealedHintLevel(0);
    resetTaskTelemetry();
    setTaskSession(null);
    setTaskResult((current) => (current?.stepId === step.id ? current : null));
    setTaskError("");
    setStatusMessage(`Opened brief for ${step.title}.`);
    void syncCurrentProjectStep(step.id).catch(() => {
      // Keep step selection local even if project syncing misses once.
    });
  };

  const handleApplyStep = async () => {
    if (!activeStep || !blueprintPath) {
      return;
    }

    setDeepDiveError("");
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
    setRuntimeGuide(null);
    setRuntimeGuideEvents([]);
    setRuntimeGuideError("");
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

  const loadRuntimeGuide = async (latestResult: TaskResult | null) => {
    if (!activeStep) {
      return;
    }

    setRuntimeGuideBusy(true);
    setRuntimeGuideError("");
    setGuideVisible(true);
    setRuntimeGuide(null);
    setRuntimeGuideEvents([]);
    setRevealedHintLevel(0);

    try {
      const response = await requestRuntimeGuide(
        {
          stepId: activeStep.id,
          stepTitle: activeStep.title,
          stepSummary: activeStep.summary,
          filePath: activeFilePath || activeStep.anchor.file,
          anchorMarker: activeStep.anchor.marker,
          codeSnippet:
            buildAnchorSnippet(editorValue, anchorLocation) ||
            `Anchor marker: ${activeStep.anchor.marker}`,
          constraints: activeStep.constraints,
          tests: activeStep.tests,
          taskResult: latestResult,
          learnerModel
        },
        appendRuntimeGuideEvent
      );

      setRuntimeGuide(response);
      setStatusMessage(`Guide updated for ${activeStep.title}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to load guide for ${activeStep.id}.`;
      setRuntimeGuideError(message);
      setStatusMessage(message);
    } finally {
      setRuntimeGuideBusy(false);
    }
  };

  const handleToggleGuide = () => {
    if (guideVisible && (runtimeGuide || runtimeGuideBusy)) {
      setGuideVisible(false);
      return;
    }

    void loadRuntimeGuide(activeTaskResult);
  };

  const handleRequestDeepDive = async () => {
    if (!activeStep || !blueprintPath || !canonicalBlueprintPath) {
      return;
    }

    setDeepDiveBusy(true);
    setDeepDiveError("");
    setRuntimeGuideEvents([]);

    try {
      const response: BlueprintDeepDiveResponse = await requestBlueprintDeepDive(
        {
          canonicalBlueprintPath,
          learnerBlueprintPath: blueprintPath,
          stepId: activeStep.id,
          learnerModel,
          taskResult: activeTaskResult,
          failureCount: activeTaskProgress?.totalAttempts ?? 0,
          hintsUsed: taskTelemetry.hintsUsed,
          revealedHints: visibleHints.slice(0, revealedHintLevel)
        },
        appendRuntimeGuideEvent
      );

      const blueprintEnvelope = await fetchBlueprint();

      if (!blueprintEnvelope.blueprint) {
        throw new Error("The deeper walkthrough completed, but the active blueprint could not be reloaded.");
      }

      setBlueprint(blueprintEnvelope.blueprint);
      setBlueprintPath(blueprintEnvelope.blueprintPath);
      setCanonicalBlueprintPath(blueprintEnvelope.canonicalBlueprintPath ?? "");
      setGuideVisible(false);
      setRuntimeGuide(null);
      setRuntimeGuideError("");
      setSurfaceMode("brief");
      setStatusMessage(response.note);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to deepen ${activeStep.id}.`;
      setDeepDiveError(message);
      setStatusMessage(message);
    } finally {
      setDeepDiveBusy(false);
    }
  };

  const handleCheckResponseChange = (
    check: ComprehensionCheck,
    response: string
  ) => {
    setCheckResponses((current) => ({
      ...current,
      [check.id]: response
    }));
    setCheckReviews((current) => {
      const next = { ...current };
      delete next[check.id];
      return next;
    });
  };

  const handleCheckReview = (check: ComprehensionCheck) => {
    const response = checkResponses[check.id] ?? "";
    if (!hasAnsweredCheck(check, response)) {
      return;
    }

    const review = evaluateCheckResponse(check, response);

    setCheckReviews((current) => ({
      ...current,
      [check.id]: review
    }));

    if (review.status === "needs-revision") {
      setCheckAttemptCounts((current) => ({
        ...current,
        [check.id]: (current[check.id] ?? 0) + 1
      }));
      setStatusMessage(`Review the lesson again before retrying ${check.id}.`);
    } else {
      setStatusMessage(`Check complete for ${activeStep?.title ?? "this step"}.`);
    }
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
      setGuideVisible(submission.attempt.status !== "passed");
      resetTaskTelemetry();
      setRevealedHintLevel(0);

      if (submission.attempt.status !== "passed") {
        void loadRuntimeGuide(submission.attempt.result);
      }

      setStatusMessage(
        submission.attempt.status === "passed"
          ? `Passed ${activeStep.title} on attempt ${submission.attempt.attempt}.`
          : submission.attempt.status === "needs-review" && submission.session.rewriteGate
            ? `Tests passed, but completion is blocked. Retype at least ${submission.session.rewriteGate.requiredTypedChars} characters without large paste and resubmit.`
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

  const handleStartPlanning = async () => {
    setPlanningBusy(true);
    setPlanningError("");
    setPlanningEvents([]);

    try {
      const started = await startPlanningSession({
        goal: planningGoal,
        learningStyle: planningLearningStyle
      }, appendPlanningEvent);

      setPlanningSession(started.session);
      setPlanningPlan(null);
      setPlanningAnswers({});
      setPlanningOverlayOpen(true);
      setStatusMessage(`Started planning for ${started.session.goal}.`);
    } catch (error) {
      setPlanningError(
        error instanceof Error ? error.message : "Failed to start the planning session."
      );
    } finally {
      setPlanningBusy(false);
    }
  };

  const handleCompletePlanning = async () => {
    if (!planningSession) {
      return;
    }

    setPlanningBusy(true);
    setPlanningError("");
    setPlanningEvents([]);

    try {
      const answers: PlanningAnswer[] = planningSession.questions.map((question) => {
        const answer = planningAnswers[question.id];

        if (!hasPlanningAnswer(answer)) {
          throw new Error(`Question ${question.id} is still unanswered.`);
        }

        return answer.answerType === "custom"
          ? {
              questionId: question.id,
              answerType: "custom",
              customResponse: answer.customResponse.trim()
            }
          : {
              questionId: question.id,
              answerType: "option",
              optionId: answer.optionId
            };
      });

      const completed = await completePlanningSession({
        sessionId: planningSession.sessionId,
        answers
      }, appendPlanningEvent);

      setPlanningSession(completed.session);
      setPlanningPlan(completed.plan);
      const dashboardState = await refreshDashboardState();
      const activeProjectSummary =
        dashboardState.projects.find(
          (project) => project.id === dashboardState.activeProjectId
        ) ?? null;
      const openedBlueprint = await hydrateWorkspace(activeProjectSummary?.currentStepId);

      if (!openedBlueprint) {
        throw new Error("Planning completed, but no active generated project was activated.");
      }

      resetTaskTelemetry();
      const firstGeneratedStep =
        (activeProjectSummary?.currentStepId
          ? openedBlueprint.steps.find((step) => step.id === activeProjectSummary.currentStepId)
          : null) ?? openedBlueprint.steps[0];

      if (firstGeneratedStep) {
        setActiveStepId(firstGeneratedStep.id);
        setSurfaceMode("brief");
      }
      setDashboardOpen(false);
      setPlanningOverlayOpen(false);
      setStatusMessage(
        `Generated ${openedBlueprint.name}. Start the lesson, then move into the code workspace when the step opens up.`
      );
    } catch (error) {
      setPlanningError(
        error instanceof Error ? error.message : "Failed to complete the planning session."
      );
    } finally {
      setPlanningBusy(false);
    }
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const openFreshPlanningOverlay = () => {
    setPlanningSession(null);
    setPlanningPlan(null);
    setPlanningAnswers({});
    setPlanningEvents([]);
    setPlanningError("");
    setPlanningGoal("");
    setPlanningOverlayOpen(true);
  };

  const currentView: "projects" | "lesson" | "code" =
    dashboardOpen
      ? "projects"
      : surfaceMode === "brief" && activeStep
        ? "lesson"
        : "code";
  const showAppSidebar = currentView !== "code";
  const editorBreadcrumb = buildEditorBreadcrumb(blueprint?.name ?? "Project", activeFilePath);

  return (
    <main className="construct-app">
      <div className={`construct-shell ${showAppSidebar ? "" : "is-code-view"}`.trim()}>
        {showAppSidebar ? (
          <AppSidebar
            projectsDashboard={projectsDashboard}
            runnerHealth={runnerHealth}
            dashboardBusy={dashboardBusy}
            currentView={currentView}
            activeStep={activeStep}
            activeProjectName={blueprint?.name ?? null}
            onOpenProject={(project) => {
              void openProject(project);
            }}
            onOpenProjects={() => {
              setDashboardOpen(true);
              setPlanningOverlayOpen(false);
              setStatusMessage("Opened projects dashboard.");
            }}
            onOpenLesson={() => {
              if (!activeStep) {
                return;
              }

              setDashboardOpen(false);
              setSurfaceMode("brief");
              setStatusMessage(`Opened lesson for ${activeStep.title}.`);
            }}
            onOpenCode={() => {
              setDashboardOpen(false);
              setSurfaceMode("focus");
              setStatusMessage(
                activeStep
                  ? `Returned to the code workspace for ${activeStep.title}.`
                  : "Returned to the code workspace."
              );
            }}
            onStartProject={openFreshPlanningOverlay}
          />
        ) : null}

        <section className="construct-shell-main">
          <WorkbenchTopbar
            currentView={currentView}
            activeProjectName={blueprint?.name ?? null}
            activeStepTitle={activeStep?.title ?? null}
            activeFilePath={activeFilePath}
            runnerHealth={runnerHealth}
            saveStateLabel={saveStateLabel}
            onOpenProjects={() => {
              setDashboardOpen(true);
              setPlanningOverlayOpen(false);
              setStatusMessage("Opened projects dashboard.");
            }}
            onOpenLesson={() => {
              if (!activeStep) {
                return;
              }

              setDashboardOpen(false);
              setSurfaceMode("brief");
              setStatusMessage(`Opened lesson for ${activeStep.title}.`);
            }}
            onOpenCode={() => {
              setDashboardOpen(false);
              setSurfaceMode("focus");
              setStatusMessage(
                activeStep
                  ? `Returned to the code workspace for ${activeStep.title}.`
                  : "Returned to the code workspace."
              );
            }}
            onStartProject={openFreshPlanningOverlay}
            onToggleTheme={toggleTheme}
            theme={theme}
          />

          <div className="construct-shell-content">
            {dashboardOpen ? (
              <ProjectsHome
                projectsDashboard={projectsDashboard}
                learnerProfile={learnerProfile}
                runnerHealth={runnerHealth}
                projectsError={projectsError}
                dashboardBusy={dashboardBusy}
                onOpenProject={(project) => {
                  void openProject(project);
                }}
                onStartProject={() => {
                  openFreshPlanningOverlay();
                }}
              />
            ) : (
              <div className="construct-workbench">
                <div className="construct-layout">
                  <aside className="construct-explorer">
                    <div className="construct-explorer-header">
                      <span className="construct-panel-kicker">Project</span>
                      <strong>{blueprint?.name ?? "Workspace"}</strong>
                    </div>

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
                    <div className="construct-workspace-shell">
                      <section className="construct-editor-shell">
                        <header className="construct-editor-header">
                          <div className="construct-editor-tabs">
                            <span className="construct-editor-tab construct-editor-tab--context">
                              Code
                            </span>
                            <span className="construct-editor-tab is-active">
                              {labelForEditorPath(activeFilePath)}
                            </span>
                            {activeStep ? (
                              <span className="construct-editor-tab">
                                Step {activeStepIndex + 1}
                              </span>
                            ) : null}
                          </div>

                          <div className="construct-editor-header-actions">
                            <span className="construct-toolbar-pill">
                              {runnerHealth?.status ?? "offline"}
                            </span>
                            <span className="construct-toolbar-pill">{taskAttemptLabel}</span>
                            <span className="construct-toolbar-pill">{snapshotLabel}</span>
                            {activeStep ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSurfaceMode("brief");
                                  setStatusMessage(`Opened brief for ${activeStep.title}.`);
                                }}
                                className="construct-secondary-button"
                              >
                                Open brief
                              </button>
                            ) : null}
                          </div>
                        </header>

                        <div className="construct-editor-breadcrumb">
                          {editorBreadcrumb.map((segment, index) => (
                            <Fragment key={`${segment}:${index}`}>
                              {index > 0 ? (
                                <span className="construct-editor-breadcrumb-separator">/</span>
                              ) : null}
                              <span
                                className={`construct-editor-breadcrumb-segment ${
                                  index === editorBreadcrumb.length - 1 ? "is-active" : ""
                                }`}
                              >
                                {segment}
                              </span>
                            </Fragment>
                          ))}
                        </div>

                        <div className="construct-editor-main">
                          {activeFilePath ? (
                            <Editor
                              height="100%"
                              theme={editorTheme}
                              path={activeFilePath}
                              language={languageForPath(activeFilePath)}
                              value={editorValue}
                              onMount={(editor) => {
                                editorRef.current = editor;
                                applyAnchorDecoration(
                                  editor,
                                  anchorLocation,
                                  decorationIdsRef.current,
                                  {
                                    setDecorationIds(nextIds) {
                                      decorationIdsRef.current = nextIds;
                                    }
                                  }
                                );

                                const domNode = editor.getDomNode();
                                const pasteTarget =
                                  domNode?.querySelector(".inputarea") ?? domNode;
                                const handlePaste = (event: Event) => {
                                  if (rewriteGateRef.current) {
                                    event.preventDefault();
                                    setStatusMessage(
                                      "Verification rewrite is active. Retype the anchored code from memory instead of pasting."
                                    );
                                    return;
                                  }

                                  const clipboardEvent = event as ClipboardEvent;
                                  const pastedText =
                                    clipboardEvent.clipboardData?.getData("text") ?? "";

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
                                      pastedChars:
                                        telemetryRef.current.pastedChars + pastedCharacters
                                    };
                                    pendingPasteCharsRef.current -= pastedCharacters;
                                    insertedCharacters -= pastedCharacters;
                                  }

                                  if (insertedCharacters > 0) {
                                    telemetryRef.current = {
                                      ...telemetryRef.current,
                                      typedChars:
                                        telemetryRef.current.typedChars + insertedCharacters
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
                                  top: 22,
                                  bottom: 104
                                }
                              }}
                            />
                          ) : (
                            <div className="construct-editor-empty">
                              <span>MONACO EDITOR</span>
                            </div>
                          )}
                        </div>

                        <div className="construct-status-strip">
                          <span className="construct-status-item">
                            {activeFilePath || "No file focused"}
                          </span>
                          <span className="construct-status-item">{statusMessage}</span>
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
                            guidePrompts={guideQuestions}
                            guideVisible={guideVisible}
                            runtimeGuide={runtimeGuide}
                            runtimeGuideBusy={runtimeGuideBusy}
                            runtimeGuideError={runtimeGuideError}
                            deepDiveBusy={deepDiveBusy}
                            deepDiveError={deepDiveError}
                            runtimeGuideEvents={runtimeGuideEvents}
                            learnerModel={learnerModel}
                            onToggleGuide={handleToggleGuide}
                            onRequestDeepDive={() => {
                              void handleRequestDeepDive();
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
                            stepHints={visibleHints}
                            attemptStatus={activeAttemptStatus}
                            rewriteGate={activeRewriteGate}
                            taskProgress={activeTaskProgress}
                            taskRunState={taskRunState}
                            taskResult={activeTaskResult}
                            taskSession={taskSession}
                            taskError={taskError}
                            taskTelemetry={taskTelemetry}
                          />
                        ) : null}
                      </section>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {planningOverlayOpen ? (
          <PlanningOverlay
            planningBusy={planningBusy}
            planningEvents={planningEvents}
            planningError={planningError}
            planningGoal={planningGoal}
            planningLearningStyle={planningLearningStyle}
            planningPlan={planningPlan}
            planningAnswers={planningAnswers}
            planningSession={planningSession}
            onClose={() => {
              setPlanningOverlayOpen(false);
            }}
            onGoalChange={setPlanningGoal}
            onLearningStyleChange={setPlanningLearningStyle}
            onOptionAnswerChange={(questionId, optionId) => {
              setPlanningAnswers((current) => ({
                ...current,
                [questionId]: {
                  answerType: "option",
                  optionId
                }
              }));
            }}
            onCustomAnswerChange={(questionId, customResponse) => {
              setPlanningAnswers((current) => ({
                ...current,
                [questionId]: {
                  answerType: "custom",
                  customResponse
                }
              }));
            }}
            onStartPlanning={() => {
              void handleStartPlanning();
            }}
            onCompletePlanning={() => {
              void handleCompletePlanning();
            }}
            canCompletePlanning={canCompletePlanning}
          />
        ) : null}

        {overlayVisible && activeStep ? (
          <BriefOverlay
            key={`${activeStep.id}:${activeStep.lessonSlides.length}:${activeStep.checks.length}`}
            blueprint={blueprint}
            activeStep={activeStep}
            activeStepIndex={activeStepIndex}
            checksAnswered={checksAnswered}
            checksCompleted={checksCompleted}
            canApplyStep={canApplyStep}
            checkResponses={checkResponses}
            checkReviews={checkReviews}
            checkAttemptCounts={checkAttemptCounts}
            onSelectStep={handleStepSelect}
            onApply={() => {
              void handleApplyStep();
            }}
            onCheckResponseChange={handleCheckResponseChange}
            onCheckReview={handleCheckReview}
            onRequestDeepDive={() => {
              void handleRequestDeepDive();
            }}
            onToggleTheme={toggleTheme}
            theme={theme}
            deepDiveBusy={deepDiveBusy}
            deepDiveError={deepDiveError}
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
  runtimeGuide,
  runtimeGuideBusy,
  runtimeGuideError,
  deepDiveBusy,
  deepDiveError,
  runtimeGuideEvents,
  learnerModel,
  onToggleGuide,
  onRequestDeepDive,
  onSubmitTask,
  onOpenBrief,
  onRefocus,
  onRevealHint,
  revealedHintLevel,
  stepHints,
  attemptStatus,
  rewriteGate,
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
  runtimeGuide: RuntimeGuideResponse | null;
  runtimeGuideBusy: boolean;
  runtimeGuideError: string;
  deepDiveBusy: boolean;
  deepDiveError: string;
  runtimeGuideEvents: AgentEvent[];
  learnerModel: LearnerModel | null;
  onToggleGuide: () => void;
  onRequestDeepDive: () => void;
  onSubmitTask: () => void;
  onOpenBrief: () => void;
  onRefocus: () => void;
  onRevealHint: (level: number) => void;
  revealedHintLevel: number;
  stepHints: string[];
  attemptStatus: "failed" | "passed" | "needs-review" | null;
  rewriteGate: RewriteGate | null;
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

        {rewriteGate ? (
          <section className="construct-verification-panel">
            <span className="construct-panel-kicker">Verification Gate</span>
            <p className="construct-verification-copy">
              Tests are green, but this step stays open because the paste ratio hit{" "}
              {Math.round(rewriteGate.pasteRatio * 100)}%. Retype the anchored implementation
              from memory and resubmit.
            </p>
            <div className="construct-tag-list">
              <span className="construct-tag">
                type {rewriteGate.requiredTypedChars}+ chars
              </span>
              <span className="construct-tag">
                keep paste under {rewriteGate.maxPastedChars} chars
              </span>
              <span className="construct-tag">
                paste ratio under {Math.round(rewriteGate.requiredPasteRatio * 100)}%
              </span>
            </div>
          </section>
        ) : null}

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
              {runtimeGuideBusy
                ? "Guide is thinking..."
                : guideVisible
                  ? "Hide guide"
                  : "Ask guide"}
            </button>
          </div>
        </div>

        {attemptStatus !== "passed" && (taskProgress?.totalAttempts ?? 0) >= 2 ? (
          <div className="construct-escalation-panel">
            <div>
              <span className="construct-panel-kicker">Need more support?</span>
              <p className="construct-muted-copy">
                Construct can deepen this step with extra concept slides and a tighter
                quiz before you retry the implementation.
              </p>
            </div>
            <button
              type="button"
              onClick={onRequestDeepDive}
              disabled={deepDiveBusy}
              className="construct-secondary-button"
            >
              {deepDiveBusy ? "Building deeper walkthrough..." : "Need a deeper walkthrough?"}
            </button>
            {deepDiveError ? (
              <div className="construct-inline-error">{deepDiveError}</div>
            ) : null}
          </div>
        ) : null}

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
              {runtimeGuide ? (
                <div className="construct-guide-runtime-summary">
                  <span className="construct-panel-kicker">Live Guide</span>
                  <p>{runtimeGuide.summary}</p>
                  {runtimeGuide.observations.length > 0 ? (
                    <div className="construct-tag-list">
                      {runtimeGuide.observations.map((observation) => (
                        <span key={observation} className="construct-tag">
                          {observation}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {runtimeGuideBusy ? (
                <div className="construct-guide-prompt">
                  Construct is analyzing the current code, learner profile, and latest test result.
                </div>
              ) : null}

              {runtimeGuideError ? (
                <div className="construct-inline-error">{runtimeGuideError}</div>
              ) : null}

              {guidePrompts.map((prompt) => (
                <div key={prompt} className="construct-guide-prompt">
                  {prompt}
                </div>
              ))}

              {runtimeGuide?.nextAction ? (
                <div className="construct-guide-next-action">
                  <span className="construct-panel-kicker">Next action</span>
                  <p>{runtimeGuide.nextAction}</p>
                </div>
              ) : null}

              {runtimeGuideEvents.length > 0 ? (
                <div className="construct-guide-event-log">
                  <span className="construct-panel-kicker">Agent activity</span>
                  {runtimeGuideEvents.slice(-4).map((event) => (
                    <div key={event.id} className="construct-guide-event-item">
                      <strong>{event.title}</strong>
                      {event.detail ? (
                        isStreamAgentEvent(event) ? (
                          <pre className="construct-agent-stream-output">{event.detail}</pre>
                        ) : (
                          <p>{event.detail}</p>
                        )
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <TaskResultPanel
          attemptStatus={attemptStatus}
          rewriteGate={rewriteGate}
          taskRunState={taskRunState}
          taskResult={taskResult}
          taskError={taskError}
          title={activeStep.title}
        />
      </div>
    </motion.aside>
  );
}

function AppSidebar({
  projectsDashboard,
  runnerHealth,
  dashboardBusy,
  currentView,
  activeStep,
  activeProjectName,
  onOpenProject,
  onOpenProjects,
  onOpenLesson,
  onOpenCode,
  onStartProject
}: {
  projectsDashboard: ProjectsDashboardResponse | null;
  runnerHealth: RunnerHealth | null;
  dashboardBusy: boolean;
  currentView: "projects" | "lesson" | "code";
  activeStep: BlueprintStep | null;
  activeProjectName: string | null;
  onOpenProject: (project: ProjectSummary) => void;
  onOpenProjects: () => void;
  onOpenLesson: () => void;
  onOpenCode: () => void;
  onStartProject: () => void;
}) {
  const recentProjects = (projectsDashboard?.projects ?? []).slice(0, 5);

  return (
    <aside className="construct-app-sidebar">
      <div className="construct-app-sidebar-top">
        <div className="construct-app-brand">
          <span className="construct-app-brand-kicker">Construct</span>
          <strong>{activeProjectName ?? "Teaching IDE"}</strong>
        </div>

        <button
          type="button"
          onClick={onStartProject}
          className="construct-app-sidebar-primary"
          disabled={dashboardBusy}
        >
          New project
        </button>
      </div>

      <nav className="construct-app-nav" aria-label="App sections">
        <button
          type="button"
          onClick={onOpenProjects}
          className={`construct-app-nav-item ${currentView === "projects" ? "is-active" : ""}`}
        >
          Projects
        </button>
        <button
          type="button"
          onClick={onOpenLesson}
          className={`construct-app-nav-item ${currentView === "lesson" ? "is-active" : ""}`}
          disabled={!activeStep}
        >
          Lesson
        </button>
        <button
          type="button"
          onClick={onOpenCode}
          className={`construct-app-nav-item ${currentView === "code" ? "is-active" : ""}`}
          disabled={!activeStep}
        >
          Code
        </button>
      </nav>

      <section className="construct-app-sidebar-section">
        <div className="construct-app-sidebar-section-header">
          <span className="construct-panel-kicker">Recents</span>
        </div>

        {recentProjects.length > 0 ? (
          <div className="construct-app-recent-list">
            {recentProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  onOpenProject(project);
                }}
                className={`construct-app-recent-item ${
                  projectsDashboard?.activeProjectId === project.id ? "is-active" : ""
                }`}
                disabled={dashboardBusy}
              >
                <strong>{project.name}</strong>
                <span>{project.currentStepTitle ?? project.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="construct-app-sidebar-empty">No projects yet.</p>
        )}
      </section>

      <section className="construct-app-sidebar-section construct-app-sidebar-section--meta">
        <div className="construct-app-meta-row">
          <span>Runner</span>
          <strong>{runnerHealth?.status ?? "offline"}</strong>
        </div>
        <div className="construct-app-meta-row">
          <span>Projects</span>
          <strong>{projectsDashboard?.projects.length ?? 0}</strong>
        </div>
      </section>
    </aside>
  );
}

function WorkbenchTopbar({
  currentView,
  activeProjectName,
  activeStepTitle,
  activeFilePath,
  runnerHealth,
  saveStateLabel,
  onOpenProjects,
  onOpenLesson,
  onOpenCode,
  onStartProject,
  onToggleTheme,
  theme
}: {
  currentView: "projects" | "lesson" | "code";
  activeProjectName: string | null;
  activeStepTitle: string | null;
  activeFilePath: string | null;
  runnerHealth: RunnerHealth | null;
  saveStateLabel: string;
  onOpenProjects: () => void;
  onOpenLesson: () => void;
  onOpenCode: () => void;
  onStartProject: () => void;
  onToggleTheme: () => void;
  theme: ThemeMode;
}) {
  return (
    <header className="construct-workbench-topbar">
      <div className="construct-workbench-topbar-context">
        <span className="construct-panel-kicker">
          {currentView === "projects" ? "Projects" : activeProjectName ?? "Workspace"}
        </span>
        <strong>
          {currentView === "projects"
            ? "Return to any saved project and keep learning."
            : activeFilePath ?? activeStepTitle ?? activeProjectName ?? "No file focused"}
        </strong>
      </div>

      <div className="construct-workbench-mode-switch" role="tablist" aria-label="Current view">
        <button
          type="button"
          onClick={onOpenProjects}
          className={`construct-workbench-mode-button ${
            currentView === "projects" ? "is-active" : ""
          }`}
        >
          Projects
        </button>
        <button
          type="button"
          onClick={onOpenLesson}
          className={`construct-workbench-mode-button ${
            currentView === "lesson" ? "is-active" : ""
          }`}
        >
          Learn
        </button>
        <button
          type="button"
          onClick={onOpenCode}
          className={`construct-workbench-mode-button ${
            currentView === "code" ? "is-active" : ""
          }`}
        >
          Code
        </button>
      </div>

      <div className="construct-workbench-topbar-actions">
        <span className="construct-toolbar-pill">{runnerHealth?.status ?? "offline"}</span>
        <span className="construct-toolbar-pill">{saveStateLabel}</span>
        <button type="button" onClick={onStartProject} className="construct-secondary-button">
          New
        </button>
        <button type="button" onClick={onToggleTheme} className="construct-theme-toggle">
          {theme === "light" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}

function ProjectsHome({
  projectsDashboard,
  learnerProfile,
  runnerHealth,
  projectsError,
  dashboardBusy,
  onOpenProject,
  onStartProject
}: {
  projectsDashboard: ProjectsDashboardResponse | null;
  learnerProfile: LearnerProfileResponse | null;
  runnerHealth: RunnerHealth | null;
  projectsError: string;
  dashboardBusy: boolean;
  onOpenProject: (project: ProjectSummary) => void;
  onStartProject: () => void;
}) {
  const projects = projectsDashboard?.projects ?? [];
  const activeProject =
    projectsDashboard?.activeProjectId
      ? projects.find((project) => project.id === projectsDashboard.activeProjectId) ?? null
      : null;
  const completedProjects = projects.filter((project) => project.status === "completed").length;
  const knowledgeBase = learnerProfile?.knowledgeBase ?? null;
  const knowledgeConcepts = knowledgeBase
    ? knowledgeBase.concepts
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    : [];
  const recentGoals = knowledgeBase
    ? knowledgeBase.goals
        .slice()
        .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
        .slice(0, 5)
    : [];
  const historyEntries = learnerProfile?.learnerModel?.history ?? [];
  const knowledgeByCategory = {
    language: knowledgeConcepts.filter((concept) => concept.category === "language"),
    domain: knowledgeConcepts.filter((concept) => concept.category === "domain"),
    workflow: knowledgeConcepts.filter((concept) => concept.category === "workflow")
  };
  const comfortableConcepts = knowledgeConcepts.filter(
    (concept) => concept.confidence === "comfortable"
  ).length;
  const shakyConcepts = knowledgeConcepts.filter((concept) => concept.confidence === "shaky").length;
  const newConcepts = knowledgeConcepts.filter((concept) => concept.confidence === "new").length;
  const totalHintsUsed = Object.values(learnerProfile?.learnerModel?.hintsUsed ?? {}).reduce(
    (sum, value) => sum + value,
    0
  );
  const passedAttempts = historyEntries.filter((entry) => entry.status === "passed").length;
  const strugglingAttempts = historyEntries.filter(
    (entry) => entry.status === "failed" || entry.status === "needs-review"
  ).length;

  return (
    <section className="construct-home">
      <header className="construct-home-header">
        <div className="construct-home-header-copy">
          <span className="construct-home-kicker">Projects</span>
          <h1 className="construct-home-title">Pick up where you left off.</h1>
          <p className="construct-home-copy">
            Use the sidebar to jump between saved projects. This space shows the active
            project and the learner knowledge base the Architect is already using to
            tailor future questions, lesson depth, and step order.
          </p>
        </div>

        <div className="construct-home-actions">
          <div className="construct-home-stats-inline">
            <div className="construct-home-inline-stat">
              <span>Runner</span>
              <strong>{runnerHealth?.status ?? "offline"}</strong>
            </div>
            <div className="construct-home-inline-stat">
              <span>Projects</span>
              <strong>{projects.length}</strong>
            </div>
            <div className="construct-home-inline-stat">
              <span>Completed</span>
              <strong>{completedProjects}</strong>
            </div>
          </div>
        </div>
      </header>

      {projectsError ? (
        <div className="construct-home-error">{projectsError}</div>
      ) : null}

      <div className="construct-home-dashboard">
        <section className="construct-home-surface construct-home-surface--project">
          {activeProject ? (
            <>
              <div className="construct-home-surface-header">
                <div>
                  <span className="construct-home-section-kicker">Active project</span>
                  <h2>{activeProject.name}</h2>
                </div>
                <span className="construct-toolbar-pill">
                  {activeProject.currentStepIndex !== null
                    ? activeProject.currentStepIndex + 1
                    : 1}
                  /{Math.max(activeProject.totalSteps, 1)}
                </span>
              </div>

              <p className="construct-home-surface-copy">{activeProject.description}</p>

              <div className="construct-home-fact-grid">
                <div className="construct-home-fact">
                  <span>Current step</span>
                  <strong>{activeProject.currentStepTitle ?? "Ready to begin"}</strong>
                </div>
                <div className="construct-home-fact">
                  <span>Language</span>
                  <strong>{activeProject.language}</strong>
                </div>
                <div className="construct-home-fact">
                  <span>Completed</span>
                  <strong>{activeProject.completedStepsCount}</strong>
                </div>
                <div className="construct-home-fact">
                  <span>Last opened</span>
                  <strong>
                    {formatProjectTimestamp(activeProject.lastOpenedAt ?? activeProject.updatedAt)}
                  </strong>
                </div>
              </div>

              <div className="construct-home-inline-note">
                The sidebar handles project switching. This panel stays focused on the
                project you are currently advancing.
              </div>

              <div className="construct-home-surface-actions">
                <button
                  type="button"
                  onClick={() => {
                    onOpenProject(activeProject);
                  }}
                  className="construct-primary-button"
                  disabled={dashboardBusy}
                >
                  {dashboardBusy ? "Opening..." : "Resume project"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="construct-home-surface-header">
                <div>
                  <span className="construct-home-section-kicker">Start</span>
                  <h2>Create a new guided project.</h2>
                </div>
              </div>
              <p className="construct-home-surface-copy">
                Tell Construct what you want to build. The Architect will generate the
                project, lessons, checks, hidden tests, and implementation path around
                that goal.
              </p>
              <div className="construct-home-inline-note">
                Once the first project is planned, its current step will appear here and
                the learner knowledge base will start filling in beside it.
              </div>
              <div className="construct-home-surface-actions">
                <button
                  type="button"
                  onClick={onStartProject}
                  className="construct-primary-button"
                  disabled={dashboardBusy}
                >
                  New project
                </button>
              </div>
            </>
          )}
        </section>

        <section className="construct-home-surface construct-home-surface--knowledge">
          <div className="construct-home-surface-header">
            <div>
              <span className="construct-home-section-kicker">Learner profile</span>
              <h2>Knowledge base</h2>
            </div>
            <span className="construct-toolbar-pill">{knowledgeConcepts.length}</span>
          </div>

          <p className="construct-home-surface-copy">
            The Architect stores exact concepts here and reuses them when tailoring new
            project questions, teaching depth, and build order.
          </p>

          <div className="construct-home-profile-stats">
            <div className="construct-home-profile-stat">
              <span>Comfortable</span>
              <strong>{comfortableConcepts}</strong>
            </div>
            <div className="construct-home-profile-stat">
              <span>Shaky</span>
              <strong>{shakyConcepts}</strong>
            </div>
            <div className="construct-home-profile-stat">
              <span>New</span>
              <strong>{newConcepts}</strong>
            </div>
            <div className="construct-home-profile-stat">
              <span>Goals tracked</span>
              <strong>{recentGoals.length}</strong>
            </div>
          </div>

          {knowledgeConcepts.length > 0 ? (
            <div className="construct-home-knowledge-groups">
              {(
                [
                  ["language", "Language"],
                  ["domain", "Domain"],
                  ["workflow", "Workflow"]
                ] as const
              ).map(([category, label]) => (
                <section key={category} className="construct-home-knowledge-group">
                  <div className="construct-home-knowledge-group-header">
                    <h3>{label}</h3>
                    <span>{knowledgeByCategory[category].length}</span>
                  </div>

                  {knowledgeByCategory[category].length > 0 ? (
                    <div className="construct-home-knowledge-list">
                      {knowledgeByCategory[category].map((concept) => (
                        <div key={concept.id} className="construct-home-knowledge-item">
                          <div className="construct-home-knowledge-item-head">
                            <strong>{concept.label}</strong>
                            <span
                              className={`construct-home-confidence is-${concept.confidence}`}
                            >
                              {concept.confidence}
                            </span>
                          </div>
                          <p>{concept.rationale}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="construct-home-empty">
                      No {label.toLowerCase()} concepts recorded yet.
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="construct-home-empty">
              No stored learner knowledge yet. Start a project and answer the Architect's
              tailoring questions so Construct can build a concept-level profile.
            </div>
          )}
        </section>
      </div>

      <div className="construct-home-dashboard-secondary">
        <section className="construct-home-surface">
          <div className="construct-home-surface-header">
            <div>
              <span className="construct-home-section-kicker">Goal history</span>
              <h2>Recent planned goals</h2>
            </div>
          </div>

          {recentGoals.length > 0 ? (
            <div className="construct-home-goal-list">
              {recentGoals.map((goal) => (
                <div key={`${goal.goal}-${goal.lastPlannedAt}`} className="construct-home-goal-item">
                  <div className="construct-home-goal-head">
                    <strong>{goal.goal}</strong>
                    <span>{formatProjectTimestamp(goal.lastPlannedAt)}</span>
                  </div>
                  <p>
                    {goal.language} · {goal.domain}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="construct-home-empty">
              Planned goals will accumulate here once the Architect has tailored a few
              projects around the learner.
            </div>
          )}
        </section>

        <section className="construct-home-surface">
          <div className="construct-home-surface-header">
            <div>
              <span className="construct-home-section-kicker">Learning signals</span>
              <h2>Runtime evidence</h2>
            </div>
          </div>

          <div className="construct-home-signal-grid">
            <div className="construct-home-fact">
              <span>Attempt history</span>
              <strong>{historyEntries.length}</strong>
            </div>
            <div className="construct-home-fact">
              <span>Passed attempts</span>
              <strong>{passedAttempts}</strong>
            </div>
            <div className="construct-home-fact">
              <span>Needs work</span>
              <strong>{strugglingAttempts}</strong>
            </div>
            <div className="construct-home-fact">
              <span>Hints used</span>
              <strong>{totalHintsUsed}</strong>
            </div>
          </div>

          {historyEntries.length > 0 ? (
            <div className="construct-home-signal-list">
              {historyEntries
                .slice()
                .reverse()
                .slice(0, 5)
                .map((entry) => (
                  <div
                    key={`${entry.stepId}-${entry.recordedAt}-${entry.attempt}`}
                    className="construct-home-signal-item"
                  >
                    <div className="construct-home-signal-head">
                      <strong>{entry.stepId}</strong>
                      <span>{formatProjectTimestamp(entry.recordedAt)}</span>
                    </div>
                    <p>
                      {entry.status} · attempt {entry.attempt} · {entry.timeSpentMs} ms ·
                      hints {entry.hintsUsed}
                    </p>
                  </div>
                ))}
            </div>
          ) : (
            <div className="construct-home-empty">
              Task execution signals will appear here as the learner moves through code
              steps and hidden tests.
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function PlanningOverlay({
  planningBusy,
  planningEvents,
  planningError,
  planningGoal,
  planningLearningStyle,
  planningPlan,
  planningAnswers,
  planningSession,
  onClose,
  onGoalChange,
  onLearningStyleChange,
  onOptionAnswerChange,
  onCustomAnswerChange,
  onStartPlanning,
  onCompletePlanning,
  canCompletePlanning
}: {
  planningBusy: boolean;
  planningEvents: AgentEvent[];
  planningError: string;
  planningGoal: string;
  planningLearningStyle: LearningStyle;
  planningPlan: GeneratedProjectPlan | null;
  planningAnswers: Record<string, PlanningAnswerDraft>;
  planningSession: PlanningSession | null;
  onClose: () => void;
  onGoalChange: (value: string) => void;
  onLearningStyleChange: (value: LearningStyle) => void;
  onOptionAnswerChange: (questionId: string, optionId: string) => void;
  onCustomAnswerChange: (questionId: string, customResponse: string) => void;
  onStartPlanning: () => void;
  onCompletePlanning: () => void;
  canCompletePlanning: boolean;
}) {
  const isQuestionPhase = planningSession && !planningPlan;
  const answeredQuestionCount = planningSession
    ? planningSession.questions.filter((question) =>
        hasPlanningAnswer(planningAnswers[question.id])
      ).length
    : 0;
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const questionCount = planningSession?.questions.length ?? 0;
  const currentQuestion = isQuestionPhase ? planningSession.questions[activeQuestionIndex] : null;
  const currentAnswer = currentQuestion ? planningAnswers[currentQuestion.id] : undefined;
  const currentQuestionAnswered = currentQuestion ? hasPlanningAnswer(currentAnswer) : false;

  useEffect(() => {
    if (!planningSession || planningPlan) {
      setActiveQuestionIndex(0);
      return;
    }

    const nextIndex = planningSession.questions.findIndex((question) =>
      !hasPlanningAnswer(planningAnswers[question.id])
    );
    setActiveQuestionIndex(nextIndex === -1 ? planningSession.questions.length - 1 : nextIndex);
  }, [planningSession, planningPlan, planningAnswers]);

  return (
    <motion.div
      className="construct-planning-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <motion.section
        className="construct-planning-panel"
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <header className="construct-planning-header">
          <div className="construct-planning-header-copy">
            <span className="construct-brief-kicker">Architect</span>
            <h1>Create a new project.</h1>
            <p>
              Describe the project once, then Construct will tailor the teaching path,
              code tasks, and hidden tests around the learner.
            </p>
          </div>
          <div className="construct-planning-header-actions">
            <span className="construct-toolbar-pill">
              {planningSession
                ? `${answeredQuestionCount}/${planningSession.questions.length} tailored`
                : "new project"}
            </span>
            <button type="button" onClick={onClose} className="construct-secondary-button">
              Close
            </button>
          </div>
        </header>

        {!planningSession ? (
          <div className="construct-planning-start">
            <section className="construct-planning-composer">
              <span className="construct-panel-kicker">Project goal</span>
              <h2>Describe the project.</h2>
              <p>
                Tell Construct what you want to build. The Architect will shape the
                lessons, checks, implementation order, and hidden validation around this
                goal.
              </p>
              <textarea
                value={planningGoal}
                onChange={(event) => {
                  onGoalChange(event.target.value);
                }}
                className="construct-check-textarea construct-planning-textarea"
                placeholder="Build a TypeScript dependency graph visualizer from scratch and teach me enough parsing and graph basics to implement it myself."
              />
              <div className="construct-planning-style-row">
                <div className="construct-planning-style-copy">
                  <span className="construct-panel-kicker">Learning style</span>
                  <p>
                    This guides how much explanation should come before the learner starts
                    writing code in the real project.
                  </p>
                </div>
                <div className="construct-segmented-list construct-segmented-list--inline">
                  {(
                    [
                      ["concept-first", "Concept first"],
                      ["build-first", "Build first"],
                      ["example-first", "Example first"]
                    ] satisfies Array<[LearningStyle, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        onLearningStyleChange(value);
                      }}
                      className={`construct-check-option ${
                        planningLearningStyle === value ? "is-selected" : ""
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="construct-planning-composer-actions">
                <button
                  type="button"
                  onClick={onStartPlanning}
                  disabled={planningBusy || planningGoal.trim().length < 3}
                  className="construct-primary-button"
                >
                  {planningBusy ? "Starting..." : "Start project creation"}
                </button>
              </div>
            </section>

            <aside className="construct-planning-sidepanel">
              <section className="construct-info-panel">
                <span className="construct-panel-kicker">What the Architect will produce</span>
                <div className="construct-tag-list">
                  <span className="construct-tag">project path</span>
                  <span className="construct-tag">lesson slides</span>
                  <span className="construct-tag">concept checks</span>
                  <span className="construct-tag">real code tasks</span>
                  <span className="construct-tag">hidden tests</span>
                </div>
                <p>
                  Construct creates the project, writes the course, prepares hidden tests,
                  and then hands the learner into the code workspace at the right step.
                </p>
              </section>

              {planningEvents.length > 0 ? (
                <section className="construct-planning-event-log">
                  <div className="construct-brief-section-header">
                    <div>
                      <span className="construct-brief-kicker">Agent Activity</span>
                      <h2>What the Architect is doing right now.</h2>
                    </div>
                  </div>
                  <ArchitectTaskBoard events={planningEvents} />
                </section>
              ) : null}
            </aside>
          </div>
        ) : null}

        {isQuestionPhase ? (
          <div
            className={`construct-planning-start ${
              planningBusy ? "" : "construct-planning-start--question"
            }`}
          >
            <section className="construct-info-panel">
              <span className="construct-panel-kicker">Project brief</span>
              <h2 className="construct-modal-underlay-title">{planningGoal.trim()}</h2>
              <p>
                Construct has finished the first pass and is now tailoring the project
                path, lesson depth, and hidden tests before it materializes the real
                workspace.
              </p>
              <div className="construct-tag-list">
                <span className="construct-tag">
                  {formatDetectedLabel(planningSession.detectedDomain)}
                </span>
                <span className="construct-tag">
                  {formatDetectedLabel(planningSession.detectedLanguage)}
                </span>
                <span className="construct-tag">{planningLearningStyle}</span>
              </div>
              {planningBusy ? (
                <p className="construct-muted-copy">
                  The Architect is generating the project path, course flow, codebase, and
                  hidden tests now. This screen stays visible so you can follow the live
                  activity without the UI looking paused.
                </p>
              ) : null}
            </section>

            <aside className="construct-planning-sidepanel">
              {planningEvents.length > 0 ? (
                <section className="construct-planning-event-log">
                  <div className="construct-brief-section-header">
                    <div>
                      <span className="construct-brief-kicker">Agent Activity</span>
                      <h2>What the Architect has already done.</h2>
                    </div>
                  </div>
                  <ArchitectTaskBoard events={planningEvents} />
                </section>
              ) : null}
            </aside>
          </div>
        ) : null}

        {planningPlan ? (
          <section className="construct-planning-results">
            <div className="construct-brief-grid">
              <div className="construct-brief-column">
                <InfoPanel title="Plan summary" body={planningPlan.summary} />
                <MetadataList
                  title="Strengths"
                  values={planningPlan.knowledgeGraph.strengths}
                />
                <MetadataList title="Gaps" values={planningPlan.knowledgeGraph.gaps} />
              </div>

              <div className="construct-brief-column">
                <MetadataList
                  title="Architecture"
                  values={planningPlan.architecture.map((component) => component.label)}
                />
                <MetadataList
                  title="First validations"
                  values={planningPlan.steps[0]?.validationFocus ?? []}
                />
              </div>
            </div>

            <section className="construct-step-list construct-step-list--planning">
              {planningPlan.steps.map((step, index) => (
                <div key={step.id} className="construct-step-list-item is-active">
                  <span className="construct-step-list-index">{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.objective}</span>
                    <small>{step.rationale}</small>
                    {step.implementationNotes.length > 0 ? (
                      <div className="construct-tag-list">
                        {step.implementationNotes.map((note) => (
                          <span key={note} className="construct-tag">
                            {note}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          </section>
        ) : null}

        {planningEvents.length > 0 && !(!planningPlan && isQuestionPhase) && !(!planningSession) ? (
          <section className="construct-planning-event-log">
            <div className="construct-brief-section-header">
              <div>
                <span className="construct-brief-kicker">Agent Activity</span>
                <h2>What the Architect is doing right now.</h2>
              </div>
            </div>

            <ArchitectTaskBoard events={planningEvents} />
          </section>
        ) : null}

        {isQuestionPhase && currentQuestion && !planningBusy ? (
          <div className="construct-planning-question-layer">
            <div className="construct-planning-question-dim" aria-hidden="true" />
            <motion.section
              className="construct-planning-question-modal"
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.985 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className="construct-planning-question-header">
                <div>
                  <span className="construct-panel-kicker">Project tailoring</span>
                  <h2>
                    Help the Architect shape {formatDetectedLabel(planningSession.detectedDomain)}{" "}
                    in {formatDetectedLabel(planningSession.detectedLanguage)} around the
                    learner.
                  </h2>
                  <p>
                    These are not assessment questions. They help Construct decide where to
                    slow down, what to explain more carefully, and how much support the
                    project should provide as the learner builds it.
                  </p>
                </div>
                <div className="construct-tag-list">
                  <span className="construct-tag">
                    Question {activeQuestionIndex + 1} / {questionCount}
                  </span>
                  <span className="construct-tag">{answeredQuestionCount} answered</span>
                </div>
              </div>

              <div className="construct-planning-question-progress">
                {planningSession.questions.map((question, index) => (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => {
                      setActiveQuestionIndex(index);
                    }}
                    className={`construct-question-dot ${
                      index === activeQuestionIndex ? "is-active" : ""
                    } ${hasPlanningAnswer(planningAnswers[question.id]) ? "is-complete" : ""}`}
                    aria-label={`Question ${index + 1}`}
                  />
                ))}
              </div>

              <section className="construct-check-card construct-check-card--question-modal">
                <div className="construct-check-header">
                  <span className="construct-panel-kicker">
                    {formatPlanningQuestionCategory(currentQuestion.category)}
                  </span>
                  <h3>{currentQuestion.prompt}</h3>
                </div>

                <div className="construct-check-options">
                  {currentQuestion.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onOptionAnswerChange(currentQuestion.id, option.id);
                      }}
                      className={`construct-check-option ${
                        currentAnswer?.answerType === "option" &&
                        currentAnswer.optionId === option.id
                          ? "is-selected"
                          : ""
                      }`}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}

                  <div
                    className={`construct-check-option construct-check-option--custom ${
                      currentAnswer?.answerType === "custom" ? "is-selected" : ""
                    }`}
                  >
                    <div className="construct-check-option-header">
                      <strong>Tell the Architect in your own words</strong>
                      <span>
                        Use this when none of the generated options fit. Your exact wording
                        goes back into the Architect so the project path can adapt to the
                        learner’s real background and preferences.
                      </span>
                    </div>
                    <textarea
                      value={
                        currentAnswer?.answerType === "custom"
                          ? currentAnswer.customResponse
                          : ""
                      }
                      onFocus={() => {
                        if (currentAnswer?.answerType !== "custom") {
                          onCustomAnswerChange(currentQuestion.id, "");
                        }
                      }}
                      onChange={(event) => {
                        onCustomAnswerChange(currentQuestion.id, event.target.value);
                      }}
                      className="construct-check-textarea construct-check-textarea--compact"
                      placeholder="Describe the learner’s actual background, blockers, or the type of support the project should provide."
                    />
                  </div>
                </div>
              </section>

              <footer className="construct-planning-question-footer">
                <button
                  type="button"
                  onClick={() => {
                    setActiveQuestionIndex((current) => Math.max(0, current - 1));
                  }}
                  className="construct-secondary-button"
                  disabled={activeQuestionIndex === 0}
                >
                  Previous
                </button>

                <div className="construct-planning-question-footer-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeQuestionIndex < questionCount - 1) {
                        setActiveQuestionIndex((current) =>
                          Math.min(questionCount - 1, current + 1)
                        );
                      } else {
                        onCompletePlanning();
                      }
                    }}
                    disabled={
                      planningBusy ||
                      (!currentQuestionAnswered && activeQuestionIndex < questionCount - 1) ||
                      (activeQuestionIndex === questionCount - 1 && !canCompletePlanning)
                    }
                    className="construct-primary-button"
                  >
                    {planningBusy
                      ? "Generating project..."
                      : activeQuestionIndex < questionCount - 1
                        ? "Next question"
                        : canCompletePlanning
                          ? "Generate project"
                          : `Answer ${questionCount - answeredQuestionCount} more question${
                              questionCount - answeredQuestionCount === 1 ? "" : "s"
                            }`}
                  </button>
                </div>
              </footer>
            </motion.section>
          </div>
        ) : null}

        {planningError ? <div className="construct-inline-error">{planningError}</div> : null}

        <footer className="construct-planning-footer">
          {planningPlan ? (
            <button type="button" onClick={onClose} className="construct-primary-button">
              Continue to workspace
            </button>
          ) : null}
        </footer>
      </motion.section>
    </motion.div>
  );
}

function formatAgentStageLabel(stage: string): string {
  return stage
    .replace(/-stream$/, "")
    .replace(/^blueprint-/, "")
    .replace(/^research-/, "research ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildPlanningEventTags(event: AgentEvent): string[] {
  const tags: string[] = [];
  const payload = event.payload as Record<string, unknown> | undefined;

  if (!payload) {
    return tags;
  }

  if (event.stage.startsWith("research") && Array.isArray(payload.sources)) {
    for (const source of payload.sources as Array<{ title?: string }>) {
      if (typeof source?.title === "string" && source.title.trim()) {
        tags.push(source.title);
      }
    }
  }

  if (typeof payload.fileCount === "number") {
    tags.push(`${payload.fileCount} files`);
  }

  if (typeof payload.stepCount === "number") {
    tags.push(`${payload.stepCount} steps`);
  }

  if (typeof payload.architectureNodeCount === "number") {
    tags.push(`${payload.architectureNodeCount} architecture nodes`);
  }

  if (typeof payload.supportFileCount === "number") {
    tags.push(`${payload.supportFileCount} support files`);
  }

  if (typeof payload.canonicalFileCount === "number") {
    tags.push(`${payload.canonicalFileCount} canonical files`);
  }

  if (typeof payload.learnerFileCount === "number") {
    tags.push(`${payload.learnerFileCount} learner files`);
  }

  if (typeof payload.testCount === "number") {
    tags.push(`${payload.testCount} hidden tests`);
  }

  if (typeof payload.hiddenTestCount === "number") {
    tags.push(`${payload.hiddenTestCount} hidden tests`);
  }

  if (typeof payload.packageManager === "string" && payload.packageManager !== "none") {
    const status =
      typeof payload.status === "string" ? `${payload.packageManager} ${payload.status}` : payload.packageManager;
    tags.push(status);
  }

  if (Array.isArray(payload.samplePaths)) {
    for (const entry of payload.samplePaths.slice(0, 4)) {
      tags.push(String(entry));
    }
  }

  return Array.from(new Set(tags));
}

function BriefOverlay({
  blueprint,
  activeStep,
  activeStepIndex,
  checksAnswered,
  checksCompleted,
  canApplyStep,
  checkResponses,
  checkReviews,
  checkAttemptCounts,
  onSelectStep,
  onApply,
  onCheckResponseChange,
  onCheckReview,
  onRequestDeepDive,
  onToggleTheme,
  theme,
  deepDiveBusy,
  deepDiveError
}: {
  blueprint: ProjectBlueprint | null;
  activeStep: BlueprintStep;
  activeStepIndex: number;
  checksAnswered: number;
  checksCompleted: number;
  canApplyStep: boolean;
  checkResponses: Record<string, string>;
  checkReviews: Record<string, CheckReview>;
  checkAttemptCounts: Record<string, number>;
  onSelectStep: (step: BlueprintStep) => void;
  onApply: () => void;
  onCheckResponseChange: (check: ComprehensionCheck, response: string) => void;
  onCheckReview: (check: ComprehensionCheck) => void;
  onRequestDeepDive: () => void;
  onToggleTheme: () => void;
  theme: ThemeMode;
  deepDiveBusy: boolean;
  deepDiveError: string;
}) {
  const lessonSlides =
    activeStep.lessonSlides.length > 0 ? activeStep.lessonSlides : [activeStep.doc];
  const courseSteps = blueprint?.steps ?? [activeStep];
  const totalCourseMinutes = courseSteps.reduce(
    (total, step) => total + step.estimatedMinutes,
    0
  );
  const [phase, setPhase] = useState<"cover" | "lesson" | "check" | "exercise">("cover");
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activeCheckIndex, setActiveCheckIndex] = useState(0);
  const overlayScrollRef = useRef<HTMLDivElement | null>(null);
  const activeCheck = activeStep.checks[activeCheckIndex] ?? null;
  const activeCheckReview = activeCheck ? checkReviews[activeCheck.id] : undefined;
  const activeCheckAttempts = activeCheck ? checkAttemptCounts[activeCheck.id] ?? 0 : 0;

  useEffect(() => {
    setPhase("cover");
    setActiveSlideIndex(0);
    setActiveCheckIndex(0);
  }, [activeStep.id]);

  useEffect(() => {
    if (!overlayScrollRef.current) {
      return;
    }

    overlayScrollRef.current.scrollTop = 0;
  }, [activeStep.id, activeSlideIndex, activeCheckIndex, phase]);

  const goToExercise = () => {
    setPhase("exercise");
  };

  const goToChecks = () => {
    if (activeStep.checks.length === 0) {
      goToExercise();
      return;
    }

    setPhase("check");
    setActiveCheckIndex(0);
  };

  const advanceSlides = () => {
    if (activeSlideIndex < lessonSlides.length - 1) {
      setActiveSlideIndex((current) => current + 1);
      return;
    }

    goToChecks();
  };

  const advanceChecks = () => {
    if (!activeCheck) {
      goToExercise();
      return;
    }

    if (activeCheckReview?.status !== "complete") {
      return;
    }

    if (activeCheckIndex < activeStep.checks.length - 1) {
      setActiveCheckIndex((current) => current + 1);
      return;
    }

    goToExercise();
  };

  const courseOutline = (
    <aside className="construct-course-outline construct-course-outline--persistent">
      <div className="construct-course-outline-header">
        <span className="construct-panel-kicker">Learning path</span>
        <p className="construct-course-outline-copy">
          Construct keeps the project on track here, then deepens or adjusts the path when
          the learner struggles on checks or implementation.
        </p>
      </div>

      <div className="construct-step-list">
        {courseSteps.map((step, index) => {
          const isActive = step.id === activeStep.id;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                onSelectStep(step);
              }}
              className={`construct-step-list-item ${isActive ? "is-active" : ""}`}
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
    </aside>
  );

  return (
    <motion.div
      ref={overlayScrollRef}
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
        <div className="construct-course-shell">
          <header className="construct-course-topbar">
            <div className="construct-course-topbar-copy">
              <span className="construct-brief-kicker">Construct course</span>
              <strong>{blueprint?.name ?? "Generated course"}</strong>
            </div>
            <div className="construct-course-topbar-actions">
              <span className="construct-brief-chip">
                Step {activeStepIndex + 1} / {courseSteps.length}
              </span>
              <span className="construct-brief-chip">{totalCourseMinutes} min total</span>
              <button
                type="button"
                onClick={onToggleTheme}
                className="construct-secondary-button"
              >
                {theme === "light" ? "Dark mode" : "Light mode"}
              </button>
            </div>
          </header>

          {phase === "cover" ? (
            <section className="construct-course-cover construct-course-stage-shell">
              {courseOutline}

              <div className="construct-course-cover-main construct-course-cover-main--hero">
                <div className="construct-course-cover-copy">
                  <span className="construct-brief-kicker">Course cover</span>
                  <h1>{blueprint?.name ?? activeStep.title}</h1>
                  <p>{blueprint?.description ?? activeStep.summary}</p>
                </div>

                <div className="construct-course-cover-grid">
                  <InfoPanel
                    title="Current lesson"
                    body={`## ${activeStep.title}\n\n${activeStep.summary}`}
                    markdown
                  />
                  <InfoPanel
                    title="How this works"
                    body={[
                      "## Learn, confirm, implement",
                      "",
                      "- Construct teaches the concept in full-page lesson slides first.",
                      "- Then it checks understanding before unlocking the coding exercise.",
                      "- Only after the concept is clear do you enter the real code workspace.",
                      "- If you struggle, Construct can expand the lesson and insert deeper teaching."
                    ].join("\n")}
                    markdown
                  />
                  <MetadataList title="Concepts in this lesson" values={activeStep.concepts} />
                  <MetadataList title="What the hidden checks will verify" values={activeStep.tests} />
                </div>

                <div className="construct-course-cover-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setPhase("lesson");
                    }}
                    className="construct-primary-button"
                  >
                    {activeStepIndex === 0 ? "Start course" : "Resume lesson"}
                  </button>
                  <p className="construct-muted-copy">
                    You will stay in lesson mode until the concept is explained and the
                    checks are complete. The code editor opens only when the exercise handoff
                    begins.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {phase === "lesson" ? (
            <section className="construct-course-stage-shell">
              {courseOutline}

              <section className="construct-course-stage">
                <header className="construct-course-stage-meta">
                  <div className="construct-course-stage-meta-copy">
                    <span className="construct-brief-kicker">Lesson</span>
                    <strong>{activeStep.title}</strong>
                  </div>
                  <div className="construct-brief-header-meta">
                    <span className="construct-brief-chip">
                      Slide {activeSlideIndex + 1} / {lessonSlides.length}
                    </span>
                    <span className="construct-brief-chip">
                      {checksCompleted}/{activeStep.checks.length} checks complete
                    </span>
                    <span className="construct-brief-chip">
                      {checksAnswered}/{activeStep.checks.length} attempted
                    </span>
                  </div>
                </header>

                <article className="construct-course-slide-stage">
                  <div className="construct-course-slide-surface">
                    <MarkdownSlide markdown={lessonSlides[activeSlideIndex] ?? ""} />
                  </div>
                </article>

                <footer className="construct-course-stage-footer">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeSlideIndex === 0) {
                        setPhase("cover");
                        return;
                      }

                      setActiveSlideIndex((current) => Math.max(0, current - 1));
                    }}
                    className="construct-secondary-button"
                  >
                    {activeSlideIndex === 0 ? "Back to cover" : "Previous slide"}
                  </button>
                  <button
                    type="button"
                    onClick={advanceSlides}
                    className="construct-primary-button"
                  >
                    {activeSlideIndex >= lessonSlides.length - 1
                      ? activeStep.checks.length > 0
                        ? "Go to checks"
                        : "Go to exercise"
                      : "Next slide"}
                  </button>
                </footer>
              </section>
            </section>
          ) : null}

          {phase === "check" ? (
            <section className="construct-course-stage-shell">
              {courseOutline}

              <section className="construct-course-stage">
                <header className="construct-course-stage-meta">
                  <div className="construct-course-stage-meta-copy">
                    <span className="construct-brief-kicker">Concept check</span>
                    <strong>{activeStep.title}</strong>
                  </div>
                  <div className="construct-brief-header-meta">
                    <span className="construct-brief-chip">
                      Check {activeCheckIndex + 1} / {Math.max(activeStep.checks.length, 1)}
                    </span>
                    <span className="construct-brief-chip">
                      {checksCompleted}/{activeStep.checks.length} complete
                    </span>
                  </div>
                </header>

                <article className="construct-course-check-stage">
                  {activeCheck ? (
                    <div className="construct-course-check-surface">
                      <CheckCard
                        check={activeCheck}
                        response={checkResponses[activeCheck.id] ?? ""}
                        review={activeCheckReview}
                        onResponseChange={onCheckResponseChange}
                        onReview={onCheckReview}
                      />

                      {activeCheckReview?.status === "needs-revision" ? (
                        <div className="construct-course-check-support">
                          <button
                            type="button"
                            onClick={() => {
                              setPhase("lesson");
                              setActiveSlideIndex(0);
                            }}
                            className="construct-secondary-button"
                          >
                            Review lesson again
                          </button>

                          {activeCheckAttempts >= 2 ? (
                            <button
                              type="button"
                              onClick={onRequestDeepDive}
                              disabled={deepDiveBusy}
                              className="construct-secondary-button"
                            >
                              {deepDiveBusy
                                ? "Building a deeper lesson..."
                                : "Need a deeper explanation?"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {deepDiveError ? (
                        <div className="construct-inline-error">{deepDiveError}</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="construct-empty-panel">
                      This unit does not require a pre-check.
                    </div>
                  )}
                </article>

                <footer className="construct-course-stage-footer">
                  <button
                    type="button"
                    onClick={() => {
                      setPhase("lesson");
                      setActiveSlideIndex(Math.max(lessonSlides.length - 1, 0));
                    }}
                    className="construct-secondary-button"
                  >
                    Back to lesson
                  </button>
                  <button
                    type="button"
                    onClick={advanceChecks}
                    disabled={Boolean(activeCheck) && activeCheckReview?.status !== "complete"}
                    className="construct-primary-button"
                  >
                    {activeCheckIndex >= activeStep.checks.length - 1
                      ? "Go to exercise"
                      : "Next check"}
                  </button>
                </footer>
              </section>
            </section>
          ) : null}

          {phase === "exercise" ? (
            <section className="construct-course-stage-shell">
              {courseOutline}

              <section className="construct-course-stage">
                <header className="construct-course-stage-header construct-course-stage-header--compact">
                  <div className="construct-course-stage-header-copy">
                    <span className="construct-brief-kicker">Implementation handoff</span>
                    <strong>{activeStep.title}</strong>
                    <p>
                      You have the concept. Now Construct will open the exact file and anchor
                      where this lesson turns into implementation work.
                    </p>
                  </div>
                  <div className="construct-brief-header-meta">
                    <span className="construct-brief-chip">
                      {checksCompleted}/{activeStep.checks.length} checks complete
                    </span>
                    <span className="construct-brief-chip">{activeStep.anchor.file}</span>
                  </div>
                </header>

                <div className="construct-course-exercise-grid">
                  <InfoPanel
                    title="Implementation brief"
                    body={activeStep.doc}
                    markdown
                  />
                  <InfoPanel
                    title="Where Construct will take you"
                    body={[
                      `## ${activeStep.anchor.file}`,
                      "",
                      `Anchor: \`${activeStep.anchor.marker}\``,
                      "",
                      "Construct will open the exact file and focus the learner-owned region for this step."
                    ].join("\n")}
                    markdown
                  />
                  <MetadataList title="Constraints" values={activeStep.constraints} />
                  <MetadataList title="Hidden validations" values={activeStep.tests} />
                </div>

                <footer className="construct-course-stage-footer">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeStep.checks.length > 0) {
                        setPhase("check");
                        setActiveCheckIndex(Math.max(activeStep.checks.length - 1, 0));
                        return;
                      }

                      setPhase("lesson");
                      setActiveSlideIndex(Math.max(lessonSlides.length - 1, 0));
                    }}
                    className="construct-secondary-button"
                  >
                    Back to lesson flow
                  </button>
                  <button
                    type="button"
                    onClick={onApply}
                    disabled={!canApplyStep}
                    className="construct-primary-button"
                  >
                    Open workspace and start coding
                  </button>
                </footer>
              </section>
            </section>
          ) : null}
        </div>
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

function labelForEditorPath(filePath: string | null) {
  if (!filePath) {
    return "Untitled";
  }

  const segments = filePath.split("/");
  return segments[segments.length - 1] ?? filePath;
}

function buildEditorBreadcrumb(projectName: string, filePath: string | null) {
  if (!filePath) {
    return [projectName];
  }

  return [projectName, ...filePath.split("/")];
}

function InfoPanel({
  title,
  body,
  markdown = false
}: {
  title: string;
  body: string;
  markdown?: boolean;
}) {
  return (
    <section className="construct-info-panel">
      <span className="construct-panel-kicker">{title}</span>
      {markdown ? <MarkdownSlide markdown={body} /> : <p>{body}</p>}
    </section>
  );
}

function MarkdownSlide({ markdown }: { markdown: string }) {
  const codeTheme = getConstructThemeMode() === "dark" ? oneDark : oneLight;
  const normalizedMarkdown = normalizeLessonMarkdown(markdown);
  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const languageMatch = /language-([\w-]+)/.exec(className ?? "");
      const rawCode = String(children);
      const code = rawCode.replace(/\n$/, "");
      const isInlineLike = !languageMatch && !rawCode.includes("\n");

      if (isInlineLike) {
        return (
          <code className="construct-markdown-inline-code" {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="construct-markdown-code-frame">
          <div className="construct-markdown-code-header">
            <span>{languageMatch?.[1] ?? "code"}</span>
          </div>
          <SyntaxHighlighter
            style={codeTheme}
            language={languageMatch?.[1] ?? "text"}
            PreTag="div"
            className="construct-markdown-code-block"
            customStyle={{
              margin: 0,
              padding: "18px 20px",
              background: "transparent",
              borderRadius: 0,
              fontSize: "13.5px",
              lineHeight: "1.65",
              overflowX: "auto"
            }}
            codeTagProps={{
              style: {
                fontFamily: "var(--course-font-mono)"
              }
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    },
    a({ className, ...props }) {
      return <a className={`construct-markdown-link ${className ?? ""}`.trim()} {...props} />;
    },
    ul({ className, ...props }) {
      return (
        <ul
          className={`construct-markdown-list construct-markdown-list--unordered ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    ol({ className, ...props }) {
      return (
        <ol
          className={`construct-markdown-list construct-markdown-list--ordered ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    li({ className, ...props }) {
      return (
        <li
          className={`construct-markdown-list-item ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    table({ className, ...props }) {
      return (
        <div className="construct-markdown-table-wrap">
          <table className={`construct-markdown-table ${className ?? ""}`.trim()} {...props} />
        </div>
      );
    },
    blockquote({ className, ...props }) {
      return (
        <blockquote
          className={`construct-markdown-quote ${className ?? ""}`.trim()}
          {...props}
        />
      );
    },
    hr({ className, ...props }) {
      return <hr className={`construct-markdown-divider ${className ?? ""}`.trim()} {...props} />;
    }
  };

  return (
    <div className="construct-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function normalizeLessonMarkdown(markdown: string): string {
  const sourceLines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let inFence = false;
  let colonListActive = false;

  for (const line of sourceLines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      normalized.push(line);
      continue;
    }

    if (inFence) {
      normalized.push(line);
      continue;
    }

    if (!trimmed) {
      normalized.push("");
      continue;
    }

    let nextLine = line
      .replace(/^(\s*)[•●▪◦‣]\s+/, "$1- ")
      .replace(/^(\s*)[–—]\s+/, "$1- ");

    const isExplicitListItem = /^\s*([-*+]|\d+\.)\s+/.test(nextLine);
    const isIndentedContent = /^\s{2,}\S/.test(nextLine);
    const isHeadingLike = /^\s*#{1,6}\s+/.test(nextLine);
    const isBlockLike =
      /^\s*(>|```|\|)/.test(nextLine) || /^[-*_]{3,}\s*$/.test(trimmed);
    const isPlainFollowupLine =
      colonListActive &&
      !isExplicitListItem &&
      !isIndentedContent &&
      !isHeadingLike &&
      !isBlockLike &&
      !/[.:]$/.test(trimmed) &&
      /^[A-Za-z0-9`"'[(]/.test(trimmed);

    if (isIndentedContent && !isExplicitListItem && colonListActive) {
      nextLine = `- ${nextLine.trim()}`;
    }

    if (isPlainFollowupLine) {
      nextLine = `- ${trimmed}`;
    }

    normalized.push(nextLine);

    if (/:\s*$/.test(trimmed)) {
      colonListActive = true;
      continue;
    }

    if (isExplicitListItem || (isIndentedContent && colonListActive)) {
      continue;
    }

    colonListActive = false;
  }

  return normalized.join("\n");
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
        <div className="construct-check-short-answer">
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
                  <strong>{option.label}</strong>
                  {option.rationale ? <span>{option.rationale}</span> : null}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              onReview(check);
            }}
            disabled={!hasAnsweredCheck(check, response)}
            className="construct-secondary-button"
          >
            Check answer
          </button>
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
  attemptStatus,
  rewriteGate,
  taskRunState,
  taskResult,
  taskError,
  title
}: {
  attemptStatus: "failed" | "passed" | "needs-review" | null;
  rewriteGate: RewriteGate | null;
  taskRunState: TaskRunState;
  taskResult: TaskResult | null;
  taskError: string;
  title: string;
}) {
  const isVerificationBlocked =
    attemptStatus === "needs-review" &&
    taskResult?.status === "passed" &&
    Boolean(rewriteGate);
  const taskStatusLabel = isVerificationBlocked ? "review" : taskResult?.status ?? "";
  const taskStatusClassName = isVerificationBlocked ? "needs-review" : taskResult?.status ?? "";

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
            <span className={`construct-task-status ${taskStatusClassName}`}>
              {taskStatusLabel}
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
          ) : isVerificationBlocked && rewriteGate ? (
            <div className="construct-task-warning">
              <strong>Targeted tests passed, but verification is still open.</strong>
              <p>{rewriteGate.guidance}</p>
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

function formatDetectedLabel(value: string): string {
  return value
    .split(/[-.]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPlanningQuestionCategory(value: string): string {
  switch (value) {
    case "language":
      return "Language fit";
    case "domain":
      return "Project fit";
    case "workflow":
      return "Learning fit";
    default:
      return formatDetectedLabel(value);
  }
}

function getConstructThemeMode(): ThemeMode {
  return document.documentElement.dataset.constructTheme === "dark" ? "dark" : "light";
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

function appendAgentEvent(events: AgentEvent[], nextEvent: AgentEvent): AgentEvent[] {
  if (events.some((event) => event.id === nextEvent.id)) {
    return events;
  }

  if (isStreamAgentEvent(nextEvent)) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const current = events[index];

      if (!isStreamAgentEvent(current) || current.stage !== nextEvent.stage) {
        continue;
      }

      const currentPayload = (current.payload ?? {}) as Record<string, unknown>;
      const nextPayload = (nextEvent.payload ?? {}) as Record<string, unknown>;
      const mergedText = `${String(currentPayload.text ?? current.detail ?? "")}${String(
        nextPayload.text ?? nextEvent.detail ?? ""
      )}`;
      const mergedEvent: AgentEvent = {
        ...current,
        timestamp: nextEvent.timestamp,
        level: nextEvent.level,
        title: nextEvent.title,
        detail: mergedText,
        payload: {
          ...currentPayload,
          ...nextPayload,
          text: mergedText,
          stream: true
        }
      };

      return [
        ...events.slice(0, index),
        mergedEvent,
        ...events.slice(index + 1)
      ];
    }
  }

  return [...events, nextEvent];
}

function isStreamAgentEvent(event: AgentEvent): boolean {
  return Boolean((event.payload as Record<string, unknown> | undefined)?.stream);
}

type ArchitectTaskGroup = {
  key: string;
  label: string;
  eyebrow: string;
  status: "working" | "done" | "warning" | "error";
  events: AgentEvent[];
  latestEvent: AgentEvent;
  streamText: string;
};

function ArchitectTaskBoard({ events }: { events: AgentEvent[] }) {
  const groups = buildArchitectTaskGroups(events);
  const latestActiveGroup =
    groups.find((group) => group.status === "working") ?? groups.at(-1) ?? null;

  return (
    <div className="construct-agent-task-board">
      {latestActiveGroup ? (
        <section className="construct-agent-live-banner">
          <div>
            <span className="construct-brief-kicker">Live Architect step</span>
            <h3>{latestActiveGroup.label}</h3>
            <p>{latestActiveGroup.latestEvent.detail ?? latestActiveGroup.latestEvent.title}</p>
          </div>
          <span className={`construct-agent-task-pill is-${latestActiveGroup.status}`}>
            {formatArchitectStatus(latestActiveGroup.status)}
          </span>
        </section>
      ) : null}

      <div className="construct-agent-task-grid">
        {groups.map((group) => (
          <section key={group.key} className="construct-agent-task-card">
            <div className="construct-agent-task-card-header">
              <div>
                <span className="construct-brief-kicker">{group.eyebrow}</span>
                <h3>{group.label}</h3>
              </div>
              <span className={`construct-agent-task-pill is-${group.status}`}>
                {formatArchitectStatus(group.status)}
              </span>
            </div>

            <div className="construct-guide-event-meta">
              <span className="construct-task-status">
                {formatAgentStageLabel(group.latestEvent.stage)}
              </span>
              <span className={`construct-task-status ${group.latestEvent.level}`}>
                {group.latestEvent.level}
              </span>
            </div>

            <strong>{group.latestEvent.title}</strong>
            {group.latestEvent.detail ? <p>{group.latestEvent.detail}</p> : null}

            {group.streamText ? (
              <div className="construct-agent-stream-block">
                <span className="construct-panel-kicker">Live model draft</span>
                <pre className="construct-agent-stream-output">{group.streamText}</pre>
              </div>
            ) : null}

            {buildPlanningEventTags(group.latestEvent).length > 0 ? (
              <div className="construct-tag-list">
                {buildPlanningEventTags(group.latestEvent).map((tag) => (
                  <span key={`${group.key}-${tag}`} className="construct-tag">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

function buildArchitectTaskGroups(events: AgentEvent[]): ArchitectTaskGroup[] {
  const order: string[] = [];
  const groups = new Map<string, ArchitectTaskGroup>();

  for (const event of events) {
    const key = normalizeArchitectTaskKey(event.stage);
    const existing = groups.get(key);

    if (!existing) {
      order.push(key);
      groups.set(key, {
        key,
        ...describeArchitectTask(key),
        status: architectStatusFromLevel(event.level),
        events: [event],
        latestEvent: event,
        streamText: isStreamAgentEvent(event) ? event.detail ?? "" : ""
      });
      continue;
    }

    existing.events.push(event);
    existing.latestEvent = event;
    existing.status = architectStatusFromLevel(event.level);

    if (isStreamAgentEvent(event)) {
      existing.streamText = `${existing.streamText}${event.detail ?? ""}`;
    }
  }

  return order.map((key) => groups.get(key)!);
}

function normalizeArchitectTaskKey(stage: string): string {
  return stage.replace(/-stream$/, "");
}

function describeArchitectTask(key: string): { label: string; eyebrow: string } {
  if (key.startsWith("research-")) {
    return {
      label: formatAgentStageLabel(key),
      eyebrow: "Research"
    };
  }

  if (key === "plan-generation") {
    return {
      label: "Personalized roadmap synthesis",
      eyebrow: "Planning"
    };
  }

  if (key === "blueprint-generation" || key === "blueprint-synthesis") {
    return {
      label: "Runnable project generation",
      eyebrow: "Generation"
    };
  }

  if (key.includes("support-files") || key.includes("canonical-files") || key.includes("learner-mask")) {
    return {
      label: formatAgentStageLabel(key),
      eyebrow: "Files"
    };
  }

  if (key.includes("hidden-tests")) {
    return {
      label: "Hidden validation creation",
      eyebrow: "Validation"
    };
  }

  if (key.includes("dependency-install")) {
    return {
      label: "Dependency preparation",
      eyebrow: "Install"
    };
  }

  if (key.includes("activation") || key.includes("layout")) {
    return {
      label: formatAgentStageLabel(key),
      eyebrow: "Workspace"
    };
  }

  return {
    label: formatAgentStageLabel(key),
    eyebrow: "Architect"
  };
}

function architectStatusFromLevel(
  level: AgentEvent["level"]
): ArchitectTaskGroup["status"] {
  if (level === "success") {
    return "done";
  }

  if (level === "warning") {
    return "warning";
  }

  if (level === "error") {
    return "error";
  }

  return "working";
}

function formatArchitectStatus(status: ArchitectTaskGroup["status"]): string {
  switch (status) {
    case "done":
      return "Done";
    case "warning":
      return "Needs attention";
    case "error":
      return "Failed";
    default:
      return "Working";
  }
}

function buildAnchorSnippet(
  content: string,
  anchor: AnchorLocation | null,
  radius = 24
): string {
  const lines = content.split("\n");

  if (lines.length === 0) {
    return "";
  }

  if (!anchor) {
    return lines.slice(0, 80).join("\n");
  }

  const start = Math.max(anchor.lineNumber - radius - 1, 0);
  const end = Math.min(anchor.lineNumber + radius, lines.length);
  return lines.slice(start, end).join("\n");
}

function formatProjectTimestamp(value: string): string {
  const date = new Date(value);
  const deltaMs = Date.now() - date.getTime();
  const deltaMinutes = Math.max(1, Math.round(deltaMs / 60_000));

  if (deltaMinutes < 60) {
    return `${deltaMinutes} min ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) {
    return `${deltaHours} hr ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  if (deltaDays < 14) {
    return `${deltaDays} day ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
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
