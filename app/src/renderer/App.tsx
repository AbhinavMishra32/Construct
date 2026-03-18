import Editor from "@monaco-editor/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpenTextIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  MoonStarIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SunIcon
} from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight
} from "react-syntax-highlighter/dist/esm/styles/prism";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupText
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { findAnchorLocation } from "./lib/anchors";
import {
  buildGuidancePrompts,
  buildStepHints,
  hasAnsweredCheck
} from "./lib/guide";
import {
  completePlanningSession,
  fetchBlueprint,
  fetchCurrentPlanningState,
  fetchLearnerProfile,
  fetchLearnerModel,
  fetchProjectsDashboard,
  fetchRunnerHealth,
  fetchTaskProgress,
  fetchWorkspaceFile,
  fetchWorkspaceFiles,
  requestBlueprintDeepDive,
  requestRuntimeGuide,
  reviewStepCheck,
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
  CheckReview,
  ComprehensionCheck,
  GeneratedProjectPlan,
  LessonSlide,
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
  StoredKnowledgeConcept,
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

function PrimaryButton({
  className,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button className={cn("construct-primary-button", className)} {...props}>
      {children}
    </Button>
  );
}

function SecondaryButton({
  className,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className={cn("construct-secondary-button", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

function ToolbarPill({
  className,
  variant = "secondary",
  children,
  ...props
}: ComponentProps<typeof Badge> & {
  variant?: "default" | "secondary" | "outline" | "destructive" | "ghost" | "link";
}) {
  return (
    <Badge
      variant={variant}
      className={cn("construct-toolbar-pill", className)}
      {...props}
    >
      {children}
    </Badge>
  );
}

function TagChip({
  className,
  children,
  ...props
}: ComponentProps<typeof Badge>) {
  return (
    <Badge variant="outline" className={cn("construct-tag", className)} {...props}>
      {children}
    </Badge>
  );
}

function InlineError({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn("construct-inline-error", className)}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function EmptyPanel({
  title,
  description,
  className
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Empty className={cn("construct-empty-panel", className)}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ThemeDropdown({
  theme,
  onThemeChange,
  className
}: {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("construct-theme-toggle", className)}
          aria-label="Theme options"
        >
          {theme === "light" ? (
            <MoonStarIcon data-icon="inline-start" />
          ) : (
            <SunIcon data-icon="inline-start" />
          )}
          {theme === "light" ? "Dark" : "Light"}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              onThemeChange("light");
            }}
          >
            <SunIcon data-icon="inline-start" />
            Light
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onThemeChange("dark");
            }}
          >
            <MoonStarIcon data-icon="inline-start" />
            Dark
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailPopover({
  label,
  description,
  children
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">{label}</div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const [checkReviewBusyId, setCheckReviewBusyId] = useState<string | null>(null);
  const [taskRunState, setTaskRunState] = useState<TaskRunState>("idle");
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const [taskSession, setTaskSession] = useState<TaskSession | null>(null);
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfileResponse | null>(null);
  const [learnerModel, setLearnerModel] = useState<LearnerModel | null>(null);
  const [taskTelemetry, setTaskTelemetry] = useState<TaskTelemetry>(createEmptyTelemetry());
  const [taskError, setTaskError] = useState("");
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideMinimized, setGuideMinimized] = useState(false);
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
      ["complete", "skipped"].includes(checkReviews[check.id]?.status ?? "")
    ).length;
  }, [activeStep, checkReviews]);
  const canApplyStep = useMemo(() => {
    if (!activeStep) {
      return false;
    }

    return (
      activeStep.checks.length === 0 ||
      activeStep.checks.every((check) =>
        ["complete", "skipped"].includes(checkReviews[check.id]?.status ?? "")
      )
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
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.add("theme");
    window.localStorage.setItem("construct.theme", theme);
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();

    const loadDashboard = async () => {
      try {
        const [health, projects, profile, planningState] = await Promise.all([
          fetchRunnerHealth(controller.signal),
          fetchProjectsDashboard(controller.signal),
          fetchLearnerProfile(controller.signal),
          fetchCurrentPlanningState(controller.signal)
        ]);

        setRunnerHealth(health);
        setProjectsDashboard(projects);
        setLearnerProfile(profile);
        setPlanningSession(planningState.session);
        setPlanningPlan(planningState.plan);
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
          planningState.session
            ? "Resume the in-progress Architect run or open an existing project."
            : projects.projects.length > 0
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
    setGuideMinimized(false);
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
    setGuideMinimized(false);
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

  const handleMinimizeGuide = () => {
    setGuideMinimized(true);
  };

  const handleExpandGuide = () => {
    setGuideMinimized(false);
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

  const handleCheckReview = async (check: ComprehensionCheck) => {
    if (!activeStep) {
      return;
    }

    const response = checkResponses[check.id] ?? "";
    if (!hasAnsweredCheck(check, response)) {
      return;
    }

    setCheckReviewBusyId(check.id);

    try {
      const attemptCount = checkAttemptCounts[check.id] ?? 0;
      const { review } = await reviewStepCheck({
        stepId: activeStep.id,
        stepTitle: activeStep.title,
        stepSummary: activeStep.summary,
        concepts: activeStep.concepts,
        check,
        response,
        attemptCount
      });

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
        setStatusMessage(`Check complete for ${activeStep.title}.`);
      }

      setLearnerProfile(await fetchLearnerProfile());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to review ${check.id}.`;
      setStatusMessage(message);
    } finally {
      setCheckReviewBusyId(null);
    }
  };

  const handleSkipCheck = (check: ComprehensionCheck) => {
    setCheckReviews((current) => ({
      ...current,
      [check.id]: {
        status: "skipped",
        message:
          "Skipped after multiple tries. Construct will keep this concept marked as weak and can revisit it later.",
        coveredCriteria: [],
        missingCriteria: check.type === "short-answer" ? check.rubric : []
      }
    }));
    setStatusMessage(`Skipped ${check.id} for now. Construct will treat it as a weak concept.`);
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
      setLearnerProfile(await fetchLearnerProfile());
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

  const setThemeMode = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
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
            onThemeChange={setThemeMode}
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
                planningSession={planningSession}
                planningPlan={planningPlan}
                onResumeCreation={() => {
                  setPlanningOverlayOpen(true);
                }}
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
                      <InputGroup className="construct-filter-input">
                        <InputGroupAddon>
                          <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                          value={filterQuery}
                          onChange={(event) => {
                            setFilterQuery(event.target.value);
                          }}
                          placeholder="Filter files..."
                          aria-label="Filter files"
                        />
                      </InputGroup>
                    </div>

                    <ScrollArea className="construct-explorer-scroll">
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
                    </ScrollArea>
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
                            <ToolbarPill>
                              {runnerHealth?.status ?? "offline"}
                            </ToolbarPill>
                            <DetailPopover
                              label="Attempts"
                              description={`Construct has recorded ${activeTaskProgress?.totalAttempts ?? 0} targeted run${
                                activeTaskProgress?.totalAttempts === 1 ? "" : "s"
                              } for this step.`}
                            >
                              <ToolbarPill>{taskAttemptLabel}</ToolbarPill>
                            </DetailPopover>
                            <DetailPopover
                              label="Snapshot"
                              description={
                                taskSession
                                  ? `The pre-task snapshot for this step is ${taskSession.preTaskSnapshot.commitId}.`
                                  : "A pre-task snapshot will appear after the step is focused."
                              }
                            >
                              <ToolbarPill>{snapshotLabel}</ToolbarPill>
                            </DetailPopover>
                            {activeStep ? (
                              <SecondaryButton
                                onClick={() => {
                                  setSurfaceMode("brief");
                                  setStatusMessage(`Opened brief for ${activeStep.title}.`);
                                }}
                              >
                                Open brief
                              </SecondaryButton>
                            ) : null}
                          </div>
                        </header>

                        <div className="construct-editor-breadcrumb">
                          <Breadcrumb>
                            <BreadcrumbList>
                              {editorBreadcrumb.map((segment, index) => {
                                const isActive = index === editorBreadcrumb.length - 1;

                                return (
                                  <Fragment key={`${segment}:${index}`}>
                                    {index > 0 ? (
                                      <BreadcrumbSeparator className="construct-editor-breadcrumb-separator" />
                                    ) : null}
                                    <BreadcrumbItem>
                                      {isActive ? (
                                        <BreadcrumbPage className="construct-editor-breadcrumb-segment is-active">
                                          {segment}
                                        </BreadcrumbPage>
                                      ) : (
                                        <span className="construct-editor-breadcrumb-segment">
                                          {segment}
                                        </span>
                                      )}
                                    </BreadcrumbItem>
                                  </Fragment>
                                );
                              })}
                            </BreadcrumbList>
                          </Breadcrumb>
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
                            <EmptyPanel
                              className="construct-editor-empty"
                              title="Workspace editor"
                              description="Open a file from the explorer to focus the learner-owned implementation region."
                            />
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
                            minimized={guideMinimized}
                            onToggleGuide={handleToggleGuide}
                            onMinimize={handleMinimizeGuide}
                            onExpand={handleExpandGuide}
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
            checkReviewBusyId={checkReviewBusyId}
            onSelectStep={handleStepSelect}
            onApply={() => {
              void handleApplyStep();
            }}
            onCheckResponseChange={handleCheckResponseChange}
            onCheckReview={handleCheckReview}
            onSkipCheck={handleSkipCheck}
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
  minimized,
  onToggleGuide,
  onMinimize,
  onExpand,
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
  minimized: boolean;
  onToggleGuide: () => void;
  onMinimize: () => void;
  onExpand: () => void;
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
  if (minimized) {
    return (
      <motion.aside
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="construct-floating-card is-minimized"
      >
        <Button
          type="button"
          variant="ghost"
          onClick={onExpand}
          className="construct-floating-card-minibar"
          aria-label={`Expand guide for ${activeStep.title}`}
        >
          <span className="construct-floating-card-minibar-kicker">Guide</span>
          <strong>{activeStep.title}</strong>
          <span className="construct-floating-card-minibar-meta">
            Step {activeStepIndex + 1}
          </span>
        </Button>
      </motion.aside>
    );
  }

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
          <div className="construct-floating-card-meta-copy">
            <span className="construct-floating-card-kicker">Guide</span>
            <span className="construct-floating-card-step">
              Step {activeStepIndex + 1} / {blueprint?.steps.length ?? 0}
            </span>
          </div>
          <SecondaryButton
            type="button"
            onClick={onMinimize}
            className="construct-guide-minimize-button"
            aria-label="Minimize tutor"
          >
            Minimize
          </SecondaryButton>
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
              <TagChip>
                type {rewriteGate.requiredTypedChars}+ chars
              </TagChip>
              <TagChip>
                keep paste under {rewriteGate.maxPastedChars} chars
              </TagChip>
              <TagChip>
                paste ratio under {Math.round(rewriteGate.requiredPasteRatio * 100)}%
              </TagChip>
            </div>
          </section>
        ) : null}

        <MetadataList title="Tests" values={activeStep.tests} />
        <MetadataList title="Constraints" values={activeStep.constraints} />

        <div className="construct-floating-card-actions">
          <div className="construct-action-cluster">
            <PrimaryButton
              type="button"
              onClick={onSubmitTask}
              disabled={taskRunState === "running"}
            >
              {taskRunState === "running" ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Running tests...
                </>
              ) : (
                "Submit"
              )}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={onOpenBrief}>
              Open brief
            </SecondaryButton>
          </div>

          <div className="construct-action-cluster is-compact">
            <SecondaryButton type="button" onClick={onRefocus}>
              Refocus anchor
            </SecondaryButton>
            <SecondaryButton type="button" onClick={onToggleGuide}>
              {runtimeGuideBusy
                ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Guide is thinking...
                    </>
                  )
                : guideVisible
                  ? "Hide guide"
                  : "Ask guide"}
            </SecondaryButton>
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
            <SecondaryButton
              type="button"
              onClick={onRequestDeepDive}
              disabled={deepDiveBusy}
            >
              {deepDiveBusy ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Building deeper walkthrough...
                </>
              ) : (
                "Need a deeper walkthrough?"
              )}
            </SecondaryButton>
            {deepDiveError ? <InlineError>{deepDiveError}</InlineError> : null}
          </div>
        ) : null}

        <div className="construct-floating-hints">
          <div className="construct-floating-hints-header">
            <span>Hints</span>
            <div className="construct-hint-actions">
              {[1, 2, 3].map((level) => (
                <Button
                  key={level}
                  type="button"
                  onClick={() => {
                    onRevealHint(level);
                  }}
                  variant={revealedHintLevel >= level ? "secondary" : "outline"}
                  className="construct-hint-button"
                >
                  L{level}
                </Button>
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
                        <TagChip key={observation}>
                          {observation}
                        </TagChip>
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
                <InlineError>{runtimeGuideError}</InlineError>
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
                          <LiveAgentResponseIndicator
                            label="Guide is responding"
                            chunkCount={getAgentStreamChunkCount(event)}
                          />
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
    <SidebarProvider className="construct-app-sidebar-provider">
      <Sidebar collapsible="none" className="construct-app-sidebar">
        <SidebarHeader className="construct-app-sidebar-top">
          <div className="construct-app-brand">
            <div className="flex items-center gap-3">
              <Avatar className="size-10 rounded-xl border border-border/80 bg-background/70">
                <AvatarFallback className="rounded-xl bg-transparent text-sm font-semibold">
                  CT
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="construct-app-brand-kicker">Construct</span>
                <strong>{activeProjectName ?? "Teaching IDE"}</strong>
              </div>
            </div>
          </div>

          <PrimaryButton
            type="button"
            onClick={onStartProject}
            className="construct-app-sidebar-primary"
            disabled={dashboardBusy}
          >
            <PlusIcon data-icon="inline-start" />
            New project
          </PrimaryButton>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="construct-app-sidebar-section">
            <SidebarGroupLabel className="construct-panel-kicker">
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="construct-app-nav">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    onClick={onOpenProjects}
                    isActive={currentView === "projects"}
                    className="construct-app-nav-item"
                    tooltip="Projects"
                  >
                    <FolderTreeIcon />
                    <span>Projects</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    onClick={onOpenLesson}
                    isActive={currentView === "lesson"}
                    className="construct-app-nav-item"
                    tooltip="Lesson"
                    disabled={!activeStep}
                  >
                    <BookOpenTextIcon />
                    <span>Lesson</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    onClick={onOpenCode}
                    isActive={currentView === "code"}
                    className="construct-app-nav-item"
                    tooltip="Code"
                    disabled={!activeStep}
                  >
                    <FolderOpenIcon />
                    <span>Code</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="construct-app-sidebar-section">
            <div className="construct-app-sidebar-section-header">
              <SidebarGroupLabel className="construct-panel-kicker">
                Recents
              </SidebarGroupLabel>
              <ToolbarPill>{recentProjects.length}</ToolbarPill>
            </div>

            <SidebarGroupContent>
              {recentProjects.length > 0 ? (
                <ScrollArea className="max-h-[40vh]">
                  <div className="construct-app-recent-list">
                    {recentProjects.map((project) => (
                      <Button
                        key={project.id}
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          onOpenProject(project);
                        }}
                        className={cn(
                          "construct-app-recent-item",
                          projectsDashboard?.activeProjectId === project.id ? "is-active" : ""
                        )}
                        disabled={dashboardBusy}
                      >
                        <strong>{project.name}</strong>
                        <span>{project.currentStepTitle ?? project.description}</span>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <Empty className="construct-app-sidebar-empty border-none bg-transparent p-0 text-left">
                  <EmptyContent className="items-start">
                    <EmptyDescription>No projects yet.</EmptyDescription>
                  </EmptyContent>
                </Empty>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="construct-app-sidebar-section construct-app-sidebar-section--meta">
          <div className="construct-app-meta-row">
            <span>Runner</span>
            <ToolbarPill variant="outline">{runnerHealth?.status ?? "offline"}</ToolbarPill>
          </div>
          <div className="construct-app-meta-row">
            <span>Projects</span>
            <ToolbarPill variant="outline">
              {projectsDashboard?.projects.length ?? 0}
            </ToolbarPill>
          </div>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
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
  onThemeChange,
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
  onThemeChange: (theme: ThemeMode) => void;
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
        <ButtonGroup className="construct-workbench-mode-switch">
          <Button
            type="button"
            variant={currentView === "projects" ? "secondary" : "ghost"}
            className={cn(
              "construct-workbench-mode-button",
              currentView === "projects" ? "is-active" : ""
            )}
            onClick={onOpenProjects}
          >
            Projects
          </Button>
          <Button
            type="button"
            variant={currentView === "lesson" ? "secondary" : "ghost"}
            className={cn(
              "construct-workbench-mode-button",
              currentView === "lesson" ? "is-active" : ""
            )}
            onClick={onOpenLesson}
          >
            Learn
          </Button>
          <Button
            type="button"
            variant={currentView === "code" ? "secondary" : "ghost"}
            className={cn(
              "construct-workbench-mode-button",
              currentView === "code" ? "is-active" : ""
            )}
            onClick={onOpenCode}
          >
            Code
          </Button>
        </ButtonGroup>
      </div>

      <div className="construct-workbench-topbar-actions">
        <ToolbarPill>{runnerHealth?.status ?? "offline"}</ToolbarPill>
        <ToolbarPill variant="outline">{saveStateLabel}</ToolbarPill>
        <SecondaryButton type="button" onClick={onStartProject}>
          New
        </SecondaryButton>
        <ThemeDropdown theme={theme} onThemeChange={onThemeChange} />
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
  planningSession,
  planningPlan,
  onResumeCreation,
  onOpenProject,
  onStartProject
}: {
  projectsDashboard: ProjectsDashboardResponse | null;
  learnerProfile: LearnerProfileResponse | null;
  runnerHealth: RunnerHealth | null;
  projectsError: string;
  dashboardBusy: boolean;
  planningSession: PlanningSession | null;
  planningPlan: GeneratedProjectPlan | null;
  onResumeCreation: () => void;
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
  const knowledgeRoots = knowledgeBase?.concepts ?? [];
  const knowledgeConcepts = flattenKnowledgeConceptsForUi(knowledgeRoots)
    .slice()
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  const knowledgeStats = learnerProfile?.knowledgeStats ?? {
    rootConceptCount: knowledgeRoots.length,
    totalConceptCount: knowledgeConcepts.length,
    leafConceptCount: knowledgeConcepts.filter((concept) => concept.children.length === 0).length,
    maxDepth: knowledgeConcepts.reduce(
      (depth, concept) => Math.max(depth, concept.id.split(".").length),
      0
    ),
    averageScore:
      knowledgeConcepts.length > 0
        ? Math.round(
            knowledgeConcepts.reduce((sum, concept) => sum + concept.score, 0) /
              knowledgeConcepts.length
          )
        : 0,
    strongConceptCount: knowledgeConcepts.filter((concept) => concept.score >= 75).length,
    developingConceptCount: knowledgeConcepts.filter(
      (concept) => concept.score >= 45 && concept.score < 75
    ).length,
    weakConceptCount: knowledgeConcepts.filter((concept) => concept.score < 45).length
  };
  const recentGoals = knowledgeBase
    ? knowledgeBase.goals
        .slice()
        .sort((left, right) => right.lastPlannedAt.localeCompare(left.lastPlannedAt))
        .slice(0, 5)
    : [];
  const historyEntries = learnerProfile?.learnerModel?.history ?? [];
  const totalHintsUsed = Object.values(learnerProfile?.learnerModel?.hintsUsed ?? {}).reduce(
    (sum, value) => sum + value,
    0
  );
  const resumeCreationAvailable = Boolean(planningSession);
  const resumeProgressLabel = planningPlan
    ? `${planningPlan.steps.length} planned steps`
    : planningSession
      ? `${planningSession.questions.length} tailoring questions`
      : "";
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

      {projectsError ? <InlineError className="construct-home-error">{projectsError}</InlineError> : null}

      <div className="construct-home-dashboard">
        <section className="construct-home-surface construct-home-surface--project">
          {resumeCreationAvailable ? (
            <>
              <div className="construct-home-surface-header">
                <div>
                  <span className="construct-home-section-kicker">Creation in progress</span>
                  <h2>{planningSession?.goal ?? "Resume unfinished project creation"}</h2>
                </div>
                <ToolbarPill>{resumeProgressLabel}</ToolbarPill>
              </div>

              <p className="construct-home-surface-copy">
                The Architect already has your context, research, and partial generation
                state. Resume from the latest completed stage instead of starting over.
              </p>

              <div className="construct-home-inline-note">
                This picks back up from the current planning session and continues the
                course/project creation flow from where it last stopped.
              </div>

              <div className="construct-home-surface-actions">
                <PrimaryButton
                  type="button"
                  onClick={onResumeCreation}
                  disabled={dashboardBusy}
                >
                  Resume creation
                </PrimaryButton>
                <SecondaryButton type="button" onClick={onStartProject}>
                  Start fresh
                </SecondaryButton>
              </div>
            </>
          ) : activeProject ? (
          
            <>
              <div className="construct-home-surface-header">
                <div>
                  <span className="construct-home-section-kicker">Active project</span>
                  <h2>{activeProject.name}</h2>
                </div>
                <ToolbarPill>
                  {activeProject.currentStepIndex !== null
                    ? activeProject.currentStepIndex + 1
                    : 1}
                  /{Math.max(activeProject.totalSteps, 1)}
                </ToolbarPill>
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
                <PrimaryButton
                  type="button"
                  onClick={() => {
                    onOpenProject(activeProject);
                  }}
                  disabled={dashboardBusy}
                >
                  {dashboardBusy ? "Opening..." : "Resume project"}
                </PrimaryButton>
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
                <PrimaryButton
                  type="button"
                  onClick={onStartProject}
                  disabled={dashboardBusy}
                >
                  New project
                </PrimaryButton>
              </div>
            </>
          )}
        </section>

        <section className="construct-home-surface construct-home-surface--knowledge">
          <div className="construct-home-surface-header">
            <div>
              <span className="construct-home-section-kicker">Learner profile</span>
              <h2>Knowledge graph</h2>
            </div>
            <ToolbarPill>{knowledgeConcepts.length}</ToolbarPill>
          </div>

          <p className="construct-home-surface-copy">
            This is the real learner knowledge graph Construct stores and uses while
            planning. Topics can nest as deeply as needed, parent scores roll up from
            child concepts, and runtime signals update the exact subtopic the learner is
            struggling with or mastering.
          </p>

          <div className="construct-home-profile-stats">
            <div className="construct-home-profile-stat">
              <span>Concepts</span>
              <strong>{knowledgeStats.totalConceptCount}</strong>
            </div>
            <div className="construct-home-profile-stat">
              <span>Roots</span>
              <strong>{knowledgeStats.rootConceptCount}</strong>
            </div>
            <div className="construct-home-profile-stat">
              <span>Leaves</span>
              <strong>{knowledgeStats.leafConceptCount}</strong>
            </div>
            <div className="construct-home-profile-stat">
              <span>Depth</span>
              <strong>{knowledgeStats.maxDepth}</strong>
            </div>
          </div>

          <div className="construct-home-knowledge-summary">
            <span>
              Average score <strong>{knowledgeStats.averageScore}</strong>
            </span>
            <span>
              Strong <strong>{knowledgeStats.strongConceptCount}</strong>
            </span>
            <span>
              Developing <strong>{knowledgeStats.developingConceptCount}</strong>
            </span>
            <span>
              Needs support <strong>{knowledgeStats.weakConceptCount}</strong>
            </span>
            <span>
              Goals tracked <strong>{recentGoals.length}</strong>
            </span>
          </div>

          {knowledgeRoots.length > 0 ? (
            <div className="construct-home-knowledge-tree">
              {knowledgeRoots.map((concept) => (
                <KnowledgeTreeNodeView key={concept.id} concept={concept} depth={0} />
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

function flattenKnowledgeConceptsForUi(
  concepts: StoredKnowledgeConcept[]
): StoredKnowledgeConcept[] {
  return concepts.flatMap((concept) => [
    concept,
    ...flattenKnowledgeConceptsForUi(concept.children)
  ]);
}

function KnowledgeTreeNodeView({
  concept,
  depth
}: {
  concept: StoredKnowledgeConcept;
  depth: number;
}) {
  const scoreLabel =
    concept.score >= 75 ? "strong" : concept.score >= 45 ? "developing" : "needs support";
  const latestEvidence = concept.evidence[0] ?? null;

  return (
    <div className="construct-knowledge-node" style={{ "--depth": depth } as CSSProperties}>
      <div className="construct-knowledge-node-row">
        <div className="construct-knowledge-node-copy">
          <div className="construct-knowledge-node-head">
            <strong>{concept.label}</strong>
            <span className="construct-knowledge-node-category">{concept.category}</span>
          </div>
          <div className="construct-knowledge-node-subhead">
            <span>{concept.id}</span>
            <span>
              {concept.children.length > 0
                ? `${concept.children.length} subtopic${concept.children.length === 1 ? "" : "s"}`
                : concept.selfScore === null
                  ? "No direct score yet"
                  : `leaf score ${concept.selfScore}`}
            </span>
          </div>
          <p>{concept.rationale}</p>
          {latestEvidence ? (
            <div className="construct-knowledge-node-evidence">
              <span className="construct-knowledge-node-source">{latestEvidence.source}</span>
              <span>{latestEvidence.summary}</span>
            </div>
          ) : null}
        </div>
        <div className="construct-knowledge-node-meta">
          <span className={`construct-knowledge-score is-${scoreLabel.replace(" ", "-")}`}>
            {concept.score}
          </span>
          <span>{concept.evidence.length} signal{concept.evidence.length === 1 ? "" : "s"}</span>
          <span>{formatProjectTimestamp(concept.updatedAt)}</span>
        </div>
      </div>

      {concept.children.length > 0 ? (
        <div className="construct-knowledge-node-children">
          {concept.children.map((child) => (
            <KnowledgeTreeNodeView key={child.id} concept={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="construct-planning-panel max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[calc(100vw-24px)]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Create a new project</DialogTitle>
          <DialogDescription>
            Work with the Architect to tailor and generate a guided project workspace.
          </DialogDescription>
        </DialogHeader>
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
            <ToolbarPill>
              {planningSession
                ? `${answeredQuestionCount}/${planningSession.questions.length} tailored`
                : "new project"}
            </ToolbarPill>
            <SecondaryButton type="button" onClick={onClose}>
              Close
            </SecondaryButton>
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
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="planning-goal">Project brief</FieldLabel>
                  <FieldDescription>
                    Capture the app, domain, and the concepts you want Construct to teach
                    through the implementation itself.
                  </FieldDescription>
                  <InputGroup className="construct-check-textarea construct-planning-textarea">
                    <InputGroupAddon align="block-start">
                      <InputGroupText>
                        <SparklesIcon />
                        Architect prompt
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupTextarea
                      id="planning-goal"
                      value={planningGoal}
                      onChange={(event) => {
                        onGoalChange(event.target.value);
                      }}
                      placeholder="Build a TypeScript dependency graph visualizer from scratch and teach me enough parsing and graph basics to implement it myself."
                    />
                  </InputGroup>
                </Field>
              </FieldGroup>
              <div className="construct-planning-style-row">
                <div className="construct-planning-style-copy">
                  <span className="construct-panel-kicker">Learning style</span>
                  <p>
                    This guides how much explanation should come before the learner starts
                    writing code in the real project.
                  </p>
                </div>
                <ButtonGroup className="construct-segmented-list construct-segmented-list--inline">
                  {(
                    [
                      ["concept-first", "Concept first"],
                      ["build-first", "Build first"],
                      ["example-first", "Example first"]
                    ] satisfies Array<[LearningStyle, string]>
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      onClick={() => {
                        onLearningStyleChange(value);
                      }}
                      variant={planningLearningStyle === value ? "secondary" : "outline"}
                      className={cn(
                        "construct-check-option",
                        planningLearningStyle === value ? "is-selected" : ""
                      )}
                    >
                      {label}
                    </Button>
                  ))}
                </ButtonGroup>
              </div>
              <div className="construct-planning-composer-actions">
                <PrimaryButton
                  type="button"
                  onClick={onStartPlanning}
                  disabled={planningBusy || planningGoal.trim().length < 3}
                >
                  {planningBusy ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Starting...
                    </>
                  ) : (
                    "Start project creation"
                  )}
                </PrimaryButton>
              </div>
            </section>

            <aside className="construct-planning-sidepanel">
              <section className="construct-info-panel">
                <span className="construct-panel-kicker">What the Architect will produce</span>
                <div className="construct-tag-list">
                  <TagChip>project path</TagChip>
                  <TagChip>lesson slides</TagChip>
                  <TagChip>concept checks</TagChip>
                  <TagChip>real code tasks</TagChip>
                  <TagChip>hidden tests</TagChip>
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
                <TagChip>
                  {formatDetectedLabel(planningSession.detectedDomain)}
                </TagChip>
                <TagChip>
                  {formatDetectedLabel(planningSession.detectedLanguage)}
                </TagChip>
                <TagChip>{planningLearningStyle}</TagChip>
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
                          <TagChip key={note}>
                            {note}
                          </TagChip>
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
          <Dialog open>
            <DialogContent
              showCloseButton={false}
              className="construct-planning-question-modal w-[min(760px,calc(100vw-32px))] max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0"
            >
              <DialogHeader className="sr-only">
                <DialogTitle>Project tailoring question</DialogTitle>
                <DialogDescription>
                  Help the Architect personalize the project flow before generation begins.
                </DialogDescription>
              </DialogHeader>
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
                  <TagChip>
                    Question {activeQuestionIndex + 1} / {questionCount}
                  </TagChip>
                  <TagChip>{answeredQuestionCount} answered</TagChip>
                </div>
              </div>

              <div className="construct-planning-question-progress">
                {planningSession.questions.map((question, index) => (
                  <Button
                    key={question.id}
                    type="button"
                    onClick={() => {
                      setActiveQuestionIndex(index);
                    }}
                    variant="ghost"
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
                    <Button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onOptionAnswerChange(currentQuestion.id, option.id);
                      }}
                      variant={
                        currentAnswer?.answerType === "option" &&
                        currentAnswer.optionId === option.id
                          ? "secondary"
                          : "outline"
                      }
                      className={cn(
                        "construct-check-option",
                        currentAnswer?.answerType === "option" &&
                          currentAnswer.optionId === option.id
                          ? "is-selected"
                          : ""
                      )}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </Button>
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
                    <Textarea
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
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    setActiveQuestionIndex((current) => Math.max(0, current - 1));
                  }}
                  disabled={activeQuestionIndex === 0}
                >
                  Previous
                </SecondaryButton>

                <div className="construct-planning-question-footer-actions">
                  <PrimaryButton
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
                  >
                    {planningBusy
                      ? (
                          <>
                            <Spinner data-icon="inline-start" />
                            Generating project...
                          </>
                        )
                      : activeQuestionIndex < questionCount - 1
                        ? "Next question"
                        : canCompletePlanning
                          ? "Generate project"
                          : `Answer ${questionCount - answeredQuestionCount} more question${
                              questionCount - answeredQuestionCount === 1 ? "" : "s"
                            }`}
                  </PrimaryButton>
                </div>
              </footer>
            </DialogContent>
          </Dialog>
        ) : null}

        {planningError ? <InlineError>{planningError}</InlineError> : null}

        <footer className="construct-planning-footer">
          {planningPlan ? (
            <PrimaryButton type="button" onClick={onClose}>
              Continue to workspace
            </PrimaryButton>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
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
  checkReviewBusyId,
  onSelectStep,
  onApply,
  onCheckResponseChange,
  onCheckReview,
  onSkipCheck,
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
  checkReviewBusyId: string | null;
  onSelectStep: (step: BlueprintStep) => void;
  onApply: () => void;
  onCheckResponseChange: (check: ComprehensionCheck, response: string) => void;
  onCheckReview: (check: ComprehensionCheck) => void | Promise<void>;
  onSkipCheck: (check: ComprehensionCheck) => void;
  onRequestDeepDive: () => void;
  onToggleTheme: () => void;
  theme: ThemeMode;
  deepDiveBusy: boolean;
  deepDiveError: string;
}) {
  const lessonSlides = getRenderableLessonSlides(activeStep);
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
            <Button
              key={step.id}
              type="button"
              variant={isActive ? "secondary" : "ghost"}
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
            </Button>
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
              <ToolbarPill variant="outline" className="construct-brief-chip">
                Step {activeStepIndex + 1} / {courseSteps.length}
              </ToolbarPill>
              <ToolbarPill variant="outline" className="construct-brief-chip">
                {totalCourseMinutes} min total
              </ToolbarPill>
              <ThemeDropdown
                theme={theme}
                onThemeChange={(nextTheme) => {
                  if (nextTheme !== theme) {
                    onToggleTheme();
                  }
                }}
              />
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
                  <PrimaryButton
                    type="button"
                    onClick={() => {
                      setPhase("lesson");
                    }}
                  >
                    {activeStepIndex === 0 ? "Start course" : "Resume lesson"}
                  </PrimaryButton>
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
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      Slide {activeSlideIndex + 1} / {lessonSlides.length}
                    </ToolbarPill>
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      {checksCompleted}/{activeStep.checks.length} checks complete
                    </ToolbarPill>
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      {checksAnswered}/{activeStep.checks.length} attempted
                    </ToolbarPill>
                  </div>
                </header>

                <article className="construct-course-slide-stage">
                  <div className="construct-course-slide-surface">
                    <MarkdownSlide markdown={lessonSlides[activeSlideIndex] ?? ""} />
                  </div>
                </article>

                <footer className="construct-course-stage-footer">
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      if (activeSlideIndex === 0) {
                        setPhase("cover");
                        return;
                      }

                      setActiveSlideIndex((current) => Math.max(0, current - 1));
                    }}
                  >
                    {activeSlideIndex === 0 ? "Back to cover" : "Previous slide"}
                  </SecondaryButton>
                  <PrimaryButton type="button" onClick={advanceSlides}>
                    {activeSlideIndex >= lessonSlides.length - 1
                      ? activeStep.checks.length > 0
                        ? "Go to checks"
                        : "Go to exercise"
                      : "Next slide"}
                  </PrimaryButton>
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
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      Check {activeCheckIndex + 1} / {Math.max(activeStep.checks.length, 1)}
                    </ToolbarPill>
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      {checksCompleted}/{activeStep.checks.length} complete
                    </ToolbarPill>
                  </div>
                </header>

                <article className="construct-course-check-stage">
                  {activeCheck ? (
                    <div className="construct-course-check-surface">
                      <CheckCard
                        check={activeCheck}
                        response={checkResponses[activeCheck.id] ?? ""}
                        review={activeCheckReview}
                        busy={checkReviewBusyId === activeCheck.id}
                        onResponseChange={onCheckResponseChange}
                        onReview={onCheckReview}
                      />

                      {activeCheckReview?.status === "needs-revision" ? (
                        <div className="construct-course-check-support">
                          <SecondaryButton
                            type="button"
                            onClick={() => {
                              setPhase("lesson");
                              setActiveSlideIndex(0);
                            }}
                          >
                            Review lesson again
                          </SecondaryButton>

                          {activeCheckAttempts >= 2 ? (
                            <>
                              <SecondaryButton
                                type="button"
                                onClick={onRequestDeepDive}
                                disabled={deepDiveBusy}
                              >
                                {deepDiveBusy ? (
                                  <>
                                    <Spinner data-icon="inline-start" />
                                    Building a deeper lesson...
                                  </>
                                ) : (
                                  "Need a deeper explanation?"
                                )}
                              </SecondaryButton>
                              <SecondaryButton
                                type="button"
                                onClick={() => {
                                  onSkipCheck(activeCheck);
                                }}
                              >
                                Skip for now
                              </SecondaryButton>
                            </>
                          ) : null}
                        </div>
                      ) : null}

                      {deepDiveError ? <InlineError>{deepDiveError}</InlineError> : null}
                    </div>
                  ) : (
                    <EmptyPanel
                      title="No concept check required"
                      description="This lesson flows directly into the exercise handoff."
                    />
                  )}
                </article>

                <footer className="construct-course-stage-footer">
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      setPhase("lesson");
                      setActiveSlideIndex(Math.max(lessonSlides.length - 1, 0));
                    }}
                  >
                    Back to lesson
                  </SecondaryButton>
                  <PrimaryButton
                    type="button"
                    onClick={advanceChecks}
                    disabled={
                      Boolean(activeCheck) &&
                      !["complete", "skipped"].includes(activeCheckReview?.status ?? "")
                    }
                  >
                    {activeCheckIndex >= activeStep.checks.length - 1
                      ? "Go to exercise"
                      : "Next check"}
                  </PrimaryButton>
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
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      {checksCompleted}/{activeStep.checks.length} checks complete
                    </ToolbarPill>
                    <ToolbarPill variant="outline" className="construct-brief-chip">
                      {activeStep.anchor.file}
                    </ToolbarPill>
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
                  <SecondaryButton
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
                  >
                    Back to lesson flow
                  </SecondaryButton>
                  <PrimaryButton type="button" onClick={onApply} disabled={!canApplyStep}>
                    Open workspace and start coding
                  </PrimaryButton>
                </footer>
              </section>
            </section>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}

function getRenderableLessonSlides(step: BlueprintStep): string[] {
  if (step.lessonSlides.length === 0) {
    return [step.doc];
  }

  const slides = step.lessonSlides
    .map((slide) => normalizeLessonSlideToMarkdown(slide))
    .filter((slide) => slide.trim().length > 0);

  return slides.length > 0 ? slides : [step.doc];
}

function normalizeLessonSlideToMarkdown(slide: string | LessonSlide): string {
  if (typeof slide === "string") {
    return slide;
  }

  return slide.blocks
    .map((block) => {
      if (block.type === "markdown") {
        return block.markdown;
      }

      const check = block.check;
      const promptLines = [
        "## Checkpoint",
        "",
        check.prompt
      ];

      if (check.type === "mcq") {
        promptLines.push(
          "",
          ...check.options.map((option) => `- ${option.label}`)
        );
      } else if (check.placeholder) {
        promptLines.push("", `_Prompt: ${check.placeholder}_`);
      }

      return promptLines.join("\n");
    })
    .join("\n\n");
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
      <Button
        type="button"
        variant="ghost"
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
      </Button>

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
    <Card className="construct-info-panel" size="sm">
      <CardHeader className="gap-2">
        <span className="construct-panel-kicker">{title}</span>
      </CardHeader>
      <CardContent>
        {markdown ? <MarkdownSlide markdown={body} /> : <p>{body}</p>}
      </CardContent>
    </Card>
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
    <Card className="construct-metadata-panel" size="sm">
      <CardHeader className="gap-2">
        <span className="construct-panel-kicker">{title}</span>
      </CardHeader>
      <CardContent>
        <div className="construct-tag-list">
          {values.map((value) => (
            <TagChip key={value}>{value}</TagChip>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <Card className="construct-session-metric" size="sm">
      <CardContent className="flex items-center justify-between gap-3 px-3 py-2">
        <span>{label}</span>
        <strong>{value}</strong>
      </CardContent>
    </Card>
  );
}

function CheckCard({
  check,
  response,
  review,
  busy,
  onResponseChange,
  onReview
}: {
  check: ComprehensionCheck;
  response: string;
  review?: CheckReview;
  busy: boolean;
  onResponseChange: (check: ComprehensionCheck, response: string) => void;
  onReview: (check: ComprehensionCheck) => void | Promise<void>;
}) {
  return (
    <Card className="construct-check-card">
      <CardHeader className="construct-check-header">
        <span className="construct-panel-kicker">
          {check.type === "mcq" ? "Multiple choice" : "Short response"}
        </span>
        <CardTitle>{check.prompt}</CardTitle>
      </CardHeader>

      <CardContent className="construct-check-short-answer">
        {check.type === "mcq" ? (
          <>
            <div className="construct-check-options">
              {check.options.map((option) => {
                const isSelected = response === option.id;

                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant={isSelected ? "secondary" : "outline"}
                    onClick={() => {
                      onResponseChange(check, option.id);
                    }}
                    className={cn(
                      "construct-check-option",
                      isSelected ? "is-selected" : ""
                    )}
                  >
                    <strong>{option.label}</strong>
                    {option.rationale ? <span>{option.rationale}</span> : null}
                  </Button>
                );
              })}
            </div>
            <SecondaryButton
              type="button"
              onClick={() => {
                void onReview(check);
              }}
              disabled={!hasAnsweredCheck(check, response) || busy}
            >
              {busy ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Reviewing...
                </>
              ) : (
                "Check answer"
              )}
            </SecondaryButton>
          </>
        ) : (
          <>
            <Textarea
              value={response}
              onChange={(event) => {
                onResponseChange(check, event.target.value);
              }}
              placeholder={check.placeholder ?? "Write a concise technical answer."}
              className="construct-check-textarea"
            />
            <SecondaryButton
              type="button"
              onClick={() => {
                void onReview(check);
              }}
              disabled={!hasAnsweredCheck(check, response) || busy}
            >
              {busy ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Reviewing...
                </>
              ) : (
                "Review answer"
              )}
            </SecondaryButton>
          </>
        )}

        {review ? (
          <Alert
            variant={review.status === "needs-revision" ? "destructive" : "default"}
            className={`construct-check-review ${review.status}`}
          >
            <AlertDescription>
              <p>{review.message}</p>
              {review.missingCriteria.length > 0 ? (
                <div className="construct-review-list">
                  {review.missingCriteria.map((criterion) => (
                    <TagChip key={criterion}>{criterion}</TagChip>
                  ))}
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
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
    <Card className="construct-task-results">
      <CardHeader className="gap-2">
        <span className="construct-panel-kicker">Execution</span>
      </CardHeader>

      <CardContent>
        {taskRunState === "running" ? (
          <EmptyPanel
            title="Running targeted tests"
            description={`Construct is executing the current validation set for ${title}.`}
          />
        ) : taskError ? (
          <InlineError>{taskError}</InlineError>
        ) : !taskResult ? (
          <EmptyPanel
            title="No targeted run yet"
            description="Submit the step to see the latest targeted test result and verification guidance."
          />
        ) : (
          <div className="construct-task-result-body">
            <div className="construct-task-result-meta">
              <ToolbarPill className={`construct-task-status ${taskStatusClassName}`}>
                {taskStatusLabel}
              </ToolbarPill>
              <ToolbarPill variant="outline" className="construct-brief-chip">
                {formatDuration(taskResult.durationMs)}
              </ToolbarPill>
            </div>

            {taskResult.failures.length > 0 ? (
              <div className="construct-task-failures">
                {taskResult.failures.map((failure) => (
                  <Alert
                    key={`${failure.testName}-${failure.message}`}
                    variant="destructive"
                    className="construct-task-failure"
                  >
                    <AlertDescription>
                      <strong>{failure.testName}</strong>
                      <p>{failure.message}</p>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : isVerificationBlocked && rewriteGate ? (
              <Alert className="construct-task-warning">
                <AlertDescription>
                  <strong>Targeted tests passed, but verification is still open.</strong>
                  <p>{rewriteGate.guidance}</p>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="construct-task-success">
                <AlertDescription>All targeted tests passed.</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
  streamChunkCount: number;
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
            <p>
              {isStreamAgentEvent(latestActiveGroup.latestEvent)
                ? "The Architect is actively generating the current stage."
                : latestActiveGroup.latestEvent.detail ?? latestActiveGroup.latestEvent.title}
            </p>
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

            {!isStreamAgentEvent(group.latestEvent) ? (
              <>
                <strong>{group.latestEvent.title}</strong>
                {group.latestEvent.detail ? <p>{group.latestEvent.detail}</p> : null}
              </>
            ) : (
              <strong>{group.latestEvent.title}</strong>
            )}

            {group.streamChunkCount > 0 ? (
              <LiveAgentResponseIndicator
                label="Architect is still responding"
                chunkCount={group.streamChunkCount}
              />
            ) : null}

            {buildPlanningEventTags(group.latestEvent).length > 0 ? (
              <div className="construct-tag-list">
                {buildPlanningEventTags(group.latestEvent).map((tag) => (
                  <TagChip key={`${group.key}-${tag}`}>
                    {tag}
                  </TagChip>
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
        streamChunkCount: isStreamAgentEvent(event) ? 1 : 0
      });
      continue;
    }

    existing.events.push(event);
    existing.latestEvent = event;
    existing.status = architectStatusFromLevel(event.level);

    if (isStreamAgentEvent(event)) {
      existing.streamChunkCount += 1;
    }
  }

  return order.map((key) => groups.get(key)!);
}

function LiveAgentResponseIndicator({
  label,
  chunkCount
}: {
  label: string;
  chunkCount: number;
}) {
  const pulseCount = Math.max(3, Math.min(6, chunkCount || 3));

  return (
    <div className="construct-agent-live-response" aria-live="polite">
      <div className="construct-agent-live-response-header">
        <span className="construct-panel-kicker">{label}</span>
        <span className="construct-agent-live-response-count">
          {chunkCount} update{chunkCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="construct-agent-live-response-body">
        <div className="construct-agent-live-pulse-track" aria-hidden="true">
          {Array.from({ length: pulseCount }).map((_, index) => (
            <span
              key={index}
              className="construct-agent-live-pulse"
              style={{ animationDelay: `${index * 0.14}s` }}
            />
          ))}
        </div>
        <p>
          New model output is arriving and Construct is folding it into the current stage.
        </p>
      </div>
    </div>
  );
}

function getAgentStreamChunkCount(event: AgentEvent): number {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const text = String(payload.text ?? event.detail ?? "");

  if (!text) {
    return 0;
  }

  const estimatedChunks = Math.ceil(text.length / 120);
  return Math.max(1, estimatedChunks);
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
