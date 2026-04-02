"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

interface BuilderConfig {
  workspaceRoot: string;
  projectsRoot: string;
  repositoryRoot: string;
  configuredByEnv: boolean;
  safe: boolean;
  reason?: string;
  allowedCommands: string[];
  defaultTemplate: string;
  defaultPackageManager: "NPM" | "PNPM";
  initializeGitByDefault: boolean;
  installDependenciesByDefault: boolean;
  defaultAgenticProfile: string;
  agenticTimeoutSeconds: number;
  agenticMaxIterations: number;
}

interface BuilderTemplatePreset {
  id: string;
  key: string;
  displayName: string;
  description: string;
  enabled: boolean;
  defaultPackageManager: "NPM" | "PNPM";
}

interface BuilderCliProfile {
  id: string;
  key: string;
  displayName: string;
  command: string;
  description: string;
  enabled: boolean;
  supportsNonInteractive: boolean;
  metadata?: {
    available?: boolean;
    resolvedCommand?: string | null;
    availabilityReason?: string | null;
    healthy?: boolean;
    healthReason?: string | null;
    healthCheckedAt?: string | null;
    authReady?: boolean;
    authReason?: string | null;
    ready?: boolean;
    readinessReason?: string | null;
    commandSource?: string;
    platform?: string;
  };
}

interface BuilderProject {
  id: string;
  name: string;
  slug: string;
  relativePath: string;
  template: string;
  packageManager: "NPM" | "PNPM";
  gitInitialized: boolean;
  lastRunStatus: "IDLE" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  latestSessionSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BuilderPlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed";
  notes?: string;
}

interface BuilderProjectContext {
  objective: string | null;
  architectureNotes: string[];
  codingConventions: string[];
  constraints: string[];
  importantCommands: string[];
  currentPlan: BuilderPlanStep[];
  latestSessionSummary: string | null;
  knownFailures: string[];
  nextSteps: string[];
  instructionNotes: string | null;
  updatedAt: string | null;
}

interface BuilderTask {
  id: string;
  title: string;
  description: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  stage: "PLANNING" | "IMPLEMENTING" | "TESTING" | "REVIEW" | "DOCUMENTING" | "DONE";
  summary?: string | null;
  metadata?: {
    retryCount?: number;
    lastStageError?: string | null;
    lastAttemptedStage?: string | null;
    planSteps?: BuilderPlanStep[];
    lastRetryAt?: string | null;
    currentIteration?: number | null;
    maxIterations?: number | null;
    latestLoopSummary?: string | null;
    resumeFromIteration?: number | null;
  } | null;
}

interface BuilderTaskHistoryEntry {
  runId: string;
  taskId: string | null;
  projectId: string;
  iteration: number | null;
  verdict: string;
  status: string;
  summary: string | null;
  stdout: string | null;
  stderr: string | null;
  timestamp: string;
  finishedAt: string | null;
}

interface BuilderTaskHistoryResponse {
  history: BuilderTaskHistoryEntry[];
  error?: string;
}

interface BuilderStats {
  totalRuns: number;
  totalTasksRun: number;
  successRate: number;
  avgIterationsPerTask: number;
  avgIterationsPerRun: number;
  statusCounts: Record<string, number>;
}

interface BuilderReview {
  taskId: string;
  projectId: string;
  status: string;
  stage: string;
  summary: string;
  filesChanged: string[];
  commandsExecuted: string[];
  risks: string[];
  nextSteps: string[];
}

interface BuilderRun {
  id: string;
  kind: string;
  title: string;
  command: string | null;
  status: string;
  summary: string | null;
  stdout: string | null;
  stderr: string | null;
  startedAt: string;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
}

interface BuilderRunVerificationStep {
  script: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

interface BuilderRunIteration {
  iteration: number;
  changedFiles: string[];
  verification: {
    scripts: string[];
    steps: BuilderRunVerificationStep[];
    passed: boolean;
    skipped: boolean;
    summary: string;
  };
  review: {
    verdict: "complete" | "retry" | "blocked" | "max_iterations";
    reason: string;
  };
}

interface BuilderRunLoopMetadata {
  maxIterations: number;
  finalVerdict?: "complete" | "blocked" | "max_iterations";
  verified: boolean;
  verificationSkipped: boolean;
  selectedScripts: string[];
  summary: string;
  iterations: BuilderRunIteration[];
  currentIteration?: number;
  phase?: "acting" | "verifying" | "reviewing" | "complete";
}

interface BuilderStatusResponse {
  config: BuilderConfig;
  templates: BuilderTemplatePreset[];
  cliProfiles: BuilderCliProfile[];
  projects: {
    total: number;
    running: number;
  };
}

interface BuilderProjectsResponse {
  projects: BuilderProject[];
  error?: string;
}

interface BuilderProjectDetailResponse {
  project: BuilderProject;
  context: BuilderProjectContext;
  tasks: BuilderTask[];
  currentTask: BuilderTask | null;
  runs: BuilderRun[];
  latestReview: BuilderReview | null;
  nextRecommendedStep: string | null;
  error?: string;
}

type BuilderShortcutAction = "retry-last-failed-task" | "open-current-task-logs" | "cancel-running-task";

function normalizeBuilderShortcutAction(value: string | null | undefined): BuilderShortcutAction | null {
  switch (value) {
    case "retry-last-failed-task":
    case "open-current-task-logs":
    case "cancel-running-task":
      return value;
    default:
      return null;
  }
}

function readBuilderShortcutFromHash(): BuilderShortcutAction | null {
  if (typeof window === "undefined" || !window.location.hash) {
    return null;
  }

  const match = window.location.hash.match(/builder-shortcut=([^&]+)/);
  return normalizeBuilderShortcutAction(match ? decodeURIComponent(match[1] ?? "") : null);
}

function clearBuilderShortcutHash(): void {
  if (typeof window === "undefined" || !window.location.hash.includes("builder-shortcut=")) {
    return;
  }

  const nextUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", nextUrl);
}

function formatPercentage(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function getRunLoopMetadata(metadata: Record<string, unknown> | null | undefined): BuilderRunLoopMetadata | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const candidate = metadata.loop;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return candidate as BuilderRunLoopMetadata;
}

const EMPTY_CREATE_PROJECT = {
  name: "",
  template: "node-cli",
  packageManager: "NPM" as "NPM" | "PNPM",
};

export default function BuilderPage() {
  const [status, setStatus] = useState<BuilderStatusResponse | null>(null);
  const [projects, setProjects] = useState<BuilderProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [projectDetail, setProjectDetail] = useState<BuilderProjectDetailResponse | null>(null);
  const [taskHistory, setTaskHistory] = useState<BuilderTaskHistoryEntry[]>([]);
  const [builderStats, setBuilderStats] = useState<BuilderStats | null>(null);
  const [createDraft, setCreateDraft] = useState(EMPTY_CREATE_PROJECT);
  const [installPackages, setInstallPackages] = useState("");
  const [scriptName, setScriptName] = useState("build");
  const [taskRequest, setTaskRequest] = useState("");
  const [agenticPrompt, setAgenticPrompt] = useState("");
  const [agenticProfile, setAgenticProfile] = useState("");
  const [agenticModel, setAgenticModel] = useState("");
  const [bootstrapOptions, setBootstrapOptions] = useState({ initializeGit: true, installDependencies: false });
  const [saving, setSaving] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [highlightedRunId, setHighlightedRunId] = useState<string | null>(null);
  const [pendingShortcutAction, setPendingShortcutAction] = useState<BuilderShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const recentRunsRef = useRef<HTMLElement | null>(null);

  async function loadStatus(): Promise<BuilderStatusResponse> {
    const response = await fetch("/api/builder/status");
    const payload = (await response.json()) as BuilderStatusResponse & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder status.");
    }
    setStatus(payload);
    setBootstrapOptions({
      initializeGit: payload.config.initializeGitByDefault,
      installDependencies: payload.config.installDependenciesByDefault,
    });
    return payload;
  }

  async function loadProjects(nextSelectedProjectId?: string | null): Promise<BuilderProject[]> {
    const response = await fetch("/api/builder/projects");
    const payload = (await response.json()) as BuilderProjectsResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder projects.");
    }
    setProjects(payload.projects);

    const desiredProjectId = nextSelectedProjectId ?? selectedProjectId ?? payload.projects[0]?.id ?? null;
    setSelectedProjectId(desiredProjectId);
    return payload.projects;
  }

  async function loadProjectDetail(projectId: string): Promise<void> {
    const response = await fetch(`/api/builder/projects/${projectId}`);
    const payload = (await response.json()) as BuilderProjectDetailResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder project details.");
    }
    setProjectDetail(payload);
    setSelectedTaskId((current) => {
      if (current && payload.tasks.some((task) => task.id === current)) {
        return current;
      }

      return payload.currentTask?.id ?? payload.tasks[0]?.id ?? null;
    });
  }

  async function loadBuilderStats(projectId: string): Promise<void> {
    const response = await fetch(`/api/analytics/builder-stats?projectId=${encodeURIComponent(projectId)}`);
    const payload = (await response.json()) as BuilderStats & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder stats.");
    }
    setBuilderStats(payload);
  }

  async function loadTaskHistory(taskId: string): Promise<void> {
    const response = await fetch(`/api/builder/tasks/${taskId}/history`);
    const payload = (await response.json()) as BuilderTaskHistoryResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load task history.");
    }
    setTaskHistory(payload.history);
  }

  async function refresh(nextSelectedProjectId?: string | null): Promise<void> {
    setError(null);
    await loadStatus();
    const loadedProjects = await loadProjects(nextSelectedProjectId);
    const projectId = nextSelectedProjectId ?? selectedProjectId ?? loadedProjects[0]?.id ?? null;
    if (projectId) {
      await loadProjectDetail(projectId);
    } else {
      setProjectDetail(null);
    }
  }

  const refreshBuilderData = useEffectEvent((nextSelectedProjectId?: string | null) => {
    void refresh(nextSelectedProjectId).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh builder data.");
    });
  });

  useEffect(() => {
    refreshBuilderData();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      void loadProjectDetail(selectedProjectId).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to load builder project details.");
      });
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setBuilderStats(null);
      return;
    }

    void loadBuilderStats(selectedProjectId).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load builder stats.");
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskHistory([]);
      return;
    }

    void loadTaskHistory(selectedTaskId).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load task history.");
    });
  }, [selectedTaskId]);

  const enabledAgentProfiles = useMemo(
    () => (status?.cliProfiles ?? []).filter((profile) => profile.enabled && profile.metadata?.ready === true),
    [status],
  );

  useEffect(() => {
    if (!agenticProfile) {
      return;
    }

    if (!enabledAgentProfiles.some((profile) => profile.key === agenticProfile)) {
      setAgenticProfile("");
    }
  }, [agenticProfile, enabledAgentProfiles]);

  const hasRunningRun = useMemo(
    () => (projectDetail?.runs ?? []).some((run) => run.status === "RUNNING"),
    [projectDetail],
  );

  useEffect(() => {
    if (!selectedProjectId || !hasRunningRun) {
      return;
    }

    const interval = window.setInterval(() => {
      refreshBuilderData(selectedProjectId);
    }, 2000);

    return () => window.clearInterval(interval);
  }, [hasRunningRun, selectedProjectId]);

  async function createProject(): Promise<void> {
    if (!createDraft.name.trim()) {
      setError("Project name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch("/api/builder/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createDraft),
      });
      const payload = (await response.json()) as { project?: BuilderProject; error?: string };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to create builder project.");
      }
      setCreateDraft({
        name: "",
        template: status?.config.defaultTemplate ?? EMPTY_CREATE_PROJECT.template,
        packageManager: status?.config.defaultPackageManager ?? EMPTY_CREATE_PROJECT.packageManager,
      });
      setResultNotice(`Created project ${payload.project.name}.`);
      await refresh(payload.project.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create builder project.");
    } finally {
      setSaving(false);
    }
  }

  async function runProjectAction(path: string, body?: Record<string, unknown>): Promise<void> {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as { error?: string; runId?: string; status?: string; result?: { ok?: boolean } };
      if (!response.ok) {
        throw new Error(payload.error ?? "Builder action failed.");
      }
      setResultNotice(payload.status === "RUNNING"
        ? `Started run ${payload.runId}. Polling live progress.`
        : payload.runId
          ? `Started run ${payload.runId}.`
          : "Builder action completed.");
      await refresh(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Builder action failed.");
    } finally {
      setSaving(false);
    }
  }

  async function resumeTask(taskId: string, options?: { fromIteration?: number; profile?: string; model?: string }): Promise<void> {
    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/tasks/${taskId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      });
      const payload = (await response.json()) as { error?: string; runId?: string; taskId?: string; status?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to resume builder task.");
      }
      setResultNotice(payload.runId ? `Resumed task ${payload.taskId} as run ${payload.runId}.` : "Builder task resumed.");
      if (selectedProjectId) {
        await refresh(selectedProjectId);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to resume builder task.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelRun(runId: string): Promise<void> {
    setCancellingRunId(runId);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/runs/${runId}/cancel`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string; status?: string; runId?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel builder run.");
      }
      setResultNotice(payload.status === "NOT_RUNNING"
        ? `Run ${payload.runId} was no longer running.`
        : `Cancellation requested for run ${payload.runId}.`);
      await refresh(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to cancel builder run.");
    } finally {
      setCancellingRunId(null);
    }
  }

  function focusRunLogs(runId?: string): void {
    const targetRun = runId
      ? projectDetail?.runs.find((run) => run.id === runId) ?? null
      : projectDetail?.runs?.[0] ?? null;
    if (!targetRun) {
      setResultNotice("No builder run logs are available for this project yet.");
      return;
    }

    setHighlightedRunId(targetRun.id);
    recentRunsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setResultNotice(`Focused logs for run ${targetRun.id}.`);
  }

  const handleDesktopShortcut = useEffectEvent((action: BuilderShortcutAction) => {
    if (!selectedProjectId || !projectDetail) {
      return;
    }

    if (action === "open-current-task-logs") {
      focusRunLogs();
      setPendingShortcutAction(null);
      return;
    }

    if (saving || cancellingRunId) {
      return;
    }

    if (action === "cancel-running-task") {
      const runningRun = projectDetail.runs.find((run) => run.status === "RUNNING");
      if (!runningRun) {
        setResultNotice("No running builder run is available to cancel.");
        setPendingShortcutAction(null);
        return;
      }

      void cancelRun(runningRun.id).finally(() => {
        setPendingShortcutAction(null);
      });
      return;
    }

    const failedTask = projectDetail.tasks.find((task) => task.status === "FAILED");
    if (!failedTask) {
      setResultNotice("No failed builder task is available to retry.");
      setPendingShortcutAction(null);
      return;
    }

    void resumeTask(failedTask.id, {
      fromIteration: failedTask.metadata?.currentIteration ?? failedTask.metadata?.resumeFromIteration ?? undefined,
    }).finally(() => {
      setPendingShortcutAction(null);
    });
  });

  useEffect(() => {
    const handleHashShortcut = () => {
      const action = readBuilderShortcutFromHash();
      if (action) {
        setPendingShortcutAction(action);
        clearBuilderShortcutHash();
      }
    };

    const handleCustomShortcut = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = normalizeBuilderShortcutAction(detail?.action);
      if (action) {
        setPendingShortcutAction(action);
      }
    };

    handleHashShortcut();
    window.addEventListener("hashchange", handleHashShortcut);
    window.addEventListener("bizbot:builder-shortcut", handleCustomShortcut as EventListener);
    return () => {
      window.removeEventListener("hashchange", handleHashShortcut);
      window.removeEventListener("bizbot:builder-shortcut", handleCustomShortcut as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!pendingShortcutAction) {
      return;
    }

    handleDesktopShortcut(pendingShortcutAction);
  }, [pendingShortcutAction]);

  const selectedProject = projectDetail?.project ?? projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedTask = projectDetail?.tasks.find((task) => task.id === selectedTaskId) ?? projectDetail?.currentTask ?? null;
  const projectsPagination = usePagination(projects, 15);
  const runsPagination = usePagination(projectDetail?.runs ?? [], 15);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="space-y-5">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] font-medium mb-1" style={{ color: "var(--text-muted)" }}>builder mode</div>
              <div className="text-sm" style={{ color: "var(--text-dim)" }}>
                Safe project creation, preset bootstrapping, and typed package actions are the primary supported Builder path. Agentic CLI adapters stay opt-in and blocked unless they are explicitly ready.
              </div>
            </div>
            <button onClick={() => void refresh(selectedProjectId)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              refresh
            </button>
          </div>
          {error ? <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>{error}</div> : null}
          {resultNotice ? <div className="text-sm mb-3" style={{ color: "var(--success)" }}>{resultNotice}</div> : null}
          {hasRunningRun ? <div className="text-xs mb-3" style={{ color: "var(--text-dim)" }}>Polling live builder progress every 2 seconds.</div> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "workspace", value: status?.config.safe ? "safe" : "blocked" },
              { label: "projects", value: String(status?.projects.total ?? 0) },
              { label: "running", value: String(status?.projects.running ?? 0) },
              { label: "agentic profile", value: status?.config.defaultAgenticProfile || "none configured" },
            ].map((card) => (
              <div key={card.label} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
              </div>
            ))}
          </div>
          {!status?.config.safe && status?.config.reason ? (
            <div className="mt-4 text-xs leading-6" style={{ color: "var(--danger)" }}>{status.config.reason}</div>
          ) : null}
          <div className="mt-4 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            Workspace root: {status?.config.workspaceRoot ?? "loading"}
          </div>
        </section>

        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>create project</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Project name</label>
              <input value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Template</label>
              <select value={createDraft.template} onChange={(event) => setCreateDraft((current) => ({ ...current, template: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                {(status?.templates ?? []).map((template) => (
                  <option key={template.key} value={template.key}>{template.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Package manager</label>
              <select value={createDraft.packageManager} onChange={(event) => setCreateDraft((current) => ({ ...current, packageManager: event.target.value as "NPM" | "PNPM" }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <option value="NPM">NPM</option>
                <option value="PNPM">PNPM</option>
              </select>
            </div>
            <div className="flex items-end">
              <button disabled={saving || !status?.config.safe} onClick={() => void createProject()} className="w-full px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                create project
              </button>
            </div>
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>CLI profiles</div>
          <div className="space-y-3 text-sm">
            {(status?.cliProfiles ?? []).map((profile) => (
              <div key={profile.key} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span>{profile.displayName}</span>
                  <span style={{ color: profile.enabled ? (profile.metadata?.available ? "var(--success)" : "var(--danger)") : "var(--text-dim)" }}>
                    {profile.enabled ? (profile.metadata?.ready ? "enabled and ready" : "enabled but blocked") : "disabled"}
                  </span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.command}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.description}</div>
                {profile.metadata?.readinessReason ? <div className="text-xs leading-6" style={{ color: profile.metadata.ready ? "var(--success)" : "var(--danger)" }}>{profile.metadata.readinessReason}</div> : null}
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="space-y-5">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>projects</div>
          <div className="space-y-3 text-sm">
            {projects.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No builder projects yet.</div>
            ) : projectsPagination.pageItems.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className="w-full border p-3 text-left"
                style={{
                  borderColor: project.id === selectedProjectId ? "var(--accent)" : "var(--border-sub)",
                  background: project.id === selectedProjectId ? "var(--accent-glow)" : "var(--bg-raised)",
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <span>{project.name}</span>
                  <span style={{ color: project.lastRunStatus === "FAILED" ? "var(--danger)" : project.lastRunStatus === "SUCCEEDED" ? "var(--success)" : "var(--text-dim)" }}>{project.lastRunStatus.toLowerCase()}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{project.relativePath}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{project.template} · {project.packageManager}</div>
              </button>
            ))}
            <PaginationControls {...projectsPagination} />
          </div>
        </section>

        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>selected project</div>
            {selectedProject ? <div className="text-xs" style={{ color: "var(--text-dim)" }}>{selectedProject.slug}</div> : null}
          </div>
          {!selectedProject ? (
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>Select a builder project to inspect runs and execute actions.</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>path</div>
                  <div className="text-sm">{selectedProject.relativePath}</div>
                </div>
                <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>git</div>
                  <div className="text-sm">{selectedProject.gitInitialized ? "initialized" : "not initialized"}</div>
                </div>
                <div className="border p-3 sm:col-span-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>objective</div>
                  <div className="text-sm" style={{ color: projectDetail?.context.objective ? "var(--text-primary)" : "var(--text-dim)" }}>
                    {projectDetail?.context.objective ?? "No durable Builder objective recorded yet."}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>current task</div>
                  {selectedTask ? (
                    <>
                      <div className="text-sm">{selectedTask.title}</div>
                      <div className="text-xs" style={{ color: "var(--text-dim)" }}>{selectedTask.stage.toLowerCase()} · {selectedTask.status.toLowerCase()}</div>
                      {selectedTask.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{selectedTask.summary}</div> : null}
                      {selectedTask.metadata?.latestLoopSummary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{selectedTask.metadata.latestLoopSummary}</div> : null}
                    </>
                  ) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No Builder task is active yet.</div>}
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>next recommended step</div>
                  <div className="text-sm" style={{ color: projectDetail?.nextRecommendedStep ? "var(--text-primary)" : "var(--text-dim)" }}>
                    {projectDetail?.nextRecommendedStep ?? "No next step has been synthesized yet."}
                  </div>
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>builder stats</div>
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>project scoped</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "success rate", value: formatPercentage(builderStats?.successRate) },
                    { label: "avg iterations / task", value: String(builderStats?.avgIterationsPerTask ?? 0) },
                    { label: "avg iterations / run", value: String(builderStats?.avgIterationsPerRun ?? 0) },
                    { label: "total runs", value: String(builderStats?.totalRuns ?? 0) },
                  ].map((card) => (
                    <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                      <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
                    </div>
                  ))}
                </div>
                {builderStats ? (
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Status counts: {Object.entries(builderStats.statusCounts).length > 0
                      ? Object.entries(builderStats.statusCounts).map(([statusKey, count]) => `${statusKey.toLowerCase()}: ${count}`).join("; ")
                      : "none recorded"}
                  </div>
                ) : null}
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>builder task</div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Task request</label>
                  <textarea value={taskRequest} onChange={(event) => setTaskRequest(event.target.value)} rows={4} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} placeholder="Describe the next Builder step for this project." />
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  Builder tasks now run through BizBot&apos;s native in-process builder operator. The CLI profile section below remains available only for direct adapter prompts.
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  Desktop shortcuts: Ctrl+Shift+R retries the latest failed task, Ctrl+Shift+L focuses current logs, and Ctrl+Shift+K cancels the active run.
                </div>
                <div className="flex flex-wrap gap-3">
                  <button disabled={saving || !taskRequest.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/tasks`, { request: taskRequest })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                    start builder task
                  </button>
                  <button disabled={saving || !taskRequest.trim() || !projectDetail?.currentTask} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/tasks`, { request: taskRequest, taskId: projectDetail?.currentTask?.id })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    continue current task
                  </button>
                  <button disabled={saving || !taskRequest.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/tasks`, { request: taskRequest, retryFailed: true })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    retry last failed
                  </button>
                  <button disabled={saving || !selectedTask || selectedTask.status === "RUNNING" || selectedTask.status === "PENDING"} onClick={() => selectedTask ? void resumeTask(selectedTask.id) : undefined} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    resume selected task
                  </button>
                  <button disabled={!projectDetail?.runs?.length} onClick={() => focusRunLogs()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    open current logs
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>plan</div>
                  {(projectDetail?.context.currentPlan ?? []).length > 0 ? projectDetail?.context.currentPlan.map((step) => (
                    <div key={step.id} className="text-xs leading-6" style={{ color: step.status === "completed" ? "var(--success)" : step.status === "in_progress" ? "var(--accent)" : "var(--text-dim)" }}>
                      [{step.status.replace("_", " ")}] {step.label}
                    </div>
                  )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No active plan recorded yet.</div>}
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>latest review</div>
                  {projectDetail?.latestReview ? (
                    <>
                      <div className="text-sm">{projectDetail.latestReview.summary}</div>
                      {projectDetail.latestReview.risks.length > 0 ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>Risks: {projectDetail.latestReview.risks.join("; ")}</div> : null}
                      {projectDetail.latestReview.nextSteps.length > 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Next: {projectDetail.latestReview.nextSteps.join("; ")}</div> : null}
                    </>
                  ) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No structured Builder review yet.</div>}
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>recent tasks</div>
                  {selectedTask ? <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>history target: {selectedTask.title}</div> : null}
                </div>
                {(projectDetail?.tasks ?? []).length > 0 ? projectDetail?.tasks.slice(0, 5).map((task) => (
                  <button key={task.id} onClick={() => setSelectedTaskId(task.id)} className="w-full border p-2 text-left" style={{ borderColor: task.id === selectedTaskId ? "var(--accent)" : "var(--border)", background: task.id === selectedTaskId ? "var(--accent-glow)" : "var(--bg-surface)" }}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{task.title}</span>
                      <span style={{ color: task.status === "FAILED" ? "var(--danger)" : task.status === "SUCCEEDED" ? "var(--success)" : "var(--text-dim)" }}>{task.status.toLowerCase()}</span>
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{task.stage.toLowerCase()} · {task.description}</div>
                    {task.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{task.summary}</div> : null}
                  </button>
                )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No Builder tasks recorded yet.</div>}
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>task history</div>
                  {selectedTask ? <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{selectedTask.status.toLowerCase()}</div> : null}
                </div>
                {selectedTask ? (
                  taskHistory.length > 0 ? taskHistory.map((entry) => (
                    <div key={`${entry.runId}-${entry.iteration ?? "run"}`} className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>
                          {entry.iteration ? `iteration ${entry.iteration}` : "run replay"}
                        </span>
                        <span style={{ color: entry.verdict === "complete" || entry.status === "SUCCEEDED" ? "var(--success)" : entry.verdict === "retry" ? "var(--accent)" : "var(--danger)" }}>
                          {entry.verdict.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        {new Date(entry.timestamp).toLocaleString()} · run {entry.runId}
                      </div>
                      {entry.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{entry.summary}</div> : null}
                      <div className="flex flex-wrap gap-3">
                        <button disabled={saving || selectedTask.status === "RUNNING"} onClick={() => void resumeTask(selectedTask.id, { fromIteration: entry.iteration ?? undefined })} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                          resume from here
                        </button>
                        <button onClick={() => focusRunLogs(entry.runId)} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                          show run logs
                        </button>
                      </div>
                    </div>
                  )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No task history recorded for the selected task yet.</div>
                ) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>Select a task to inspect its run history.</div>}
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>bootstrap</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                    <span>Initialize git</span>
                    <input type="checkbox" checked={bootstrapOptions.initializeGit} onChange={(event) => setBootstrapOptions((current) => ({ ...current, initializeGit: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                    <span>Install dependencies</span>
                    <input type="checkbox" checked={bootstrapOptions.installDependencies} onChange={(event) => setBootstrapOptions((current) => ({ ...current, installDependencies: event.target.checked }))} />
                  </label>
                </div>
                <button disabled={saving || !status?.config.safe} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/bootstrap`, bootstrapOptions)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  bootstrap project
                </button>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>package actions</div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Install packages</label>
                  <input value={installPackages} onChange={(event) => setInstallPackages(event.target.value)} placeholder="react react-dom" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button disabled={saving} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "install_dependencies", packages: installPackages.split(/\s+/).filter(Boolean) })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    install
                  </button>
                  <button disabled={saving} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "initialize_git" })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    init git
                  </button>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Run script</label>
                  <div className="flex gap-3">
                    <input value={scriptName} onChange={(event) => setScriptName(event.target.value)} className="flex-1 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    <button disabled={saving || !scriptName.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "run_script", script: scriptName })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                      run
                    </button>
                  </div>
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>direct cli prompt</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Profile</label>
                    <select value={agenticProfile} onChange={(event) => setAgenticProfile(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <option value="">Select a profile</option>
                      {enabledAgentProfiles.map((profile) => (
                        <option key={profile.key} value={profile.key}>{profile.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Model override</label>
                    <input value={agenticModel} onChange={(event) => setAgenticModel(event.target.value)} placeholder="optional" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Prompt</label>
                  <textarea value={agenticPrompt} onChange={(event) => setAgenticPrompt(event.target.value)} rows={5} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </div>
                <button disabled={saving || !agenticPrompt.trim() || !agenticProfile} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "run_agentic_task", profile: agenticProfile, prompt: agenticPrompt, model: agenticModel || undefined })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  run raw agentic prompt
                </button>
              </div>
            </>
          )}
        </section>

        <section ref={recentRunsRef} className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>recent runs</div>
          <div className="space-y-3 text-sm">
            {(projectDetail?.runs ?? []).length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No recorded runs for this project yet.</div>
            ) : runsPagination.pageItems.map((run) => (
              <div key={run.id} className="border p-3" style={{ borderColor: highlightedRunId === run.id ? "var(--accent)" : "var(--border-sub)", background: highlightedRunId === run.id ? "var(--accent-glow)" : "var(--bg-raised)" }}>
                {(() => {
                  const loop = getRunLoopMetadata(run.metadata);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-4">
                        <span>{run.title}</span>
                        <div className="flex items-center gap-3">
                          {run.status === "RUNNING" ? (
                            <button
                              disabled={cancellingRunId === run.id}
                              onClick={() => void cancelRun(run.id)}
                              className="px-2 py-1 border text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
                              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                            >
                              {cancellingRunId === run.id ? "cancelling" : "cancel"}
                            </button>
                          ) : null}
                          <span style={{ color: run.status === "FAILED" ? "var(--danger)" : run.status === "SUCCEEDED" ? "var(--success)" : run.status === "CANCELLED" ? "var(--danger)" : "var(--text-dim)" }}>{run.status.toLowerCase()}</span>
                        </div>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.command ?? "command unavailable"}</div>
                      {run.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.summary}</div> : null}
                      {loop ? (
                        <div className="mt-3 border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                            <span>{(loop.finalVerdict ?? run.status.toLowerCase()).replace(/_/g, " ")}</span>
                            <span>{loop.iterations.length}/{loop.maxIterations} iterations</span>
                            <span>{loop.verified ? "verified" : loop.verificationSkipped ? "verification skipped" : "not verified"}</span>
                            {loop.selectedScripts.length > 0 ? <span>scripts {loop.selectedScripts.join(", ")}</span> : null}
                            {loop.phase ? <span>phase {loop.phase}</span> : null}
                            {loop.currentIteration ? <span>current {loop.currentIteration}</span> : null}
                          </div>
                          {run.status === "RUNNING" ? <div className="text-xs" style={{ color: "var(--accent)" }}>{loop.summary}</div> : null}
                          {loop.iterations.map((iteration) => (
                            <details key={`${run.id}-iteration-${iteration.iteration}`} className="border p-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                              <summary className="cursor-pointer text-xs flex flex-wrap gap-3" style={{ color: "var(--text-primary)" }}>
                                <span>attempt {iteration.iteration}</span>
                                <span style={{ color: iteration.review.verdict === "complete" ? "var(--success)" : iteration.review.verdict === "retry" ? "var(--accent)" : "var(--danger)" }}>
                                  {iteration.review.verdict.replace(/_/g, " ")}
                                </span>
                                <span style={{ color: "var(--text-dim)" }}>{iteration.verification.summary}</span>
                              </summary>
                              <div className="mt-2 space-y-2 text-xs" style={{ color: "var(--text-dim)" }}>
                                <div>{iteration.review.reason}</div>
                                {iteration.changedFiles.length > 0 ? <div>changed files: {iteration.changedFiles.join(", ")}</div> : <div>changed files: none detected</div>}
                                {iteration.verification.steps.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {iteration.verification.steps.map((step) => (
                                      <span key={`${run.id}-iteration-${iteration.iteration}-${step.script}`} className="border px-2 py-1" style={{ borderColor: step.ok ? "rgba(36,196,162,0.35)" : "rgba(255,90,90,0.35)", color: step.ok ? "var(--success)" : "var(--danger)" }}>
                                        {step.script} {step.ok ? "passed" : `failed (${step.exitCode ?? "?"})`}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : null}
                      {run.stdout ? <pre className="mt-2 text-xs whitespace-pre-wrap border p-2 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}>{run.stdout}</pre> : null}
                      {run.stderr ? <pre className="mt-2 text-xs whitespace-pre-wrap border p-2 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--danger)" }}>{run.stderr}</pre> : null}
                    </>
                  );
                })()}
              </div>
            ))}
            <PaginationControls {...runsPagination} />
          </div>
        </section>
      </section>
    </div>
  );
}