"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useMemo, useState } from "react";

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
  createdAt: string;
  updatedAt: string;
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
  runs: BuilderRun[];
  error?: string;
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
  const [projectDetail, setProjectDetail] = useState<BuilderProjectDetailResponse | null>(null);
  const [createDraft, setCreateDraft] = useState(EMPTY_CREATE_PROJECT);
  const [installPackages, setInstallPackages] = useState("");
  const [scriptName, setScriptName] = useState("build");
  const [agenticPrompt, setAgenticPrompt] = useState("");
  const [agenticProfile, setAgenticProfile] = useState("codex");
  const [agenticModel, setAgenticModel] = useState("");
  const [bootstrapOptions, setBootstrapOptions] = useState({ initializeGit: true, installDependencies: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);

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
    setAgenticProfile(payload.config.defaultAgenticProfile);
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
  }

  async function refresh(nextSelectedProjectId?: string | null): Promise<void> {
    setError(null);
    const loadedStatus = await loadStatus();
    const loadedProjects = await loadProjects(nextSelectedProjectId);
    const projectId = nextSelectedProjectId ?? selectedProjectId ?? loadedProjects[0]?.id ?? null;
    if (projectId) {
      await loadProjectDetail(projectId);
    } else {
      setProjectDetail(null);
    }
    if (!nextSelectedProjectId && !selectedProjectId && loadedStatus.config.defaultAgenticProfile) {
      setAgenticProfile(loadedStatus.config.defaultAgenticProfile);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      void loadProjectDetail(selectedProjectId).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to load builder project details.");
      });
    }
  }, [selectedProjectId]);

  const enabledAgentProfiles = useMemo(
    () => (status?.cliProfiles ?? []).filter((profile) => profile.enabled),
    [status],
  );

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
      const payload = (await response.json()) as { error?: string; runId?: string; result?: { ok?: boolean } };
      if (!response.ok) {
        throw new Error(payload.error ?? "Builder action failed.");
      }
      setResultNotice(payload.runId ? `Started run ${payload.runId}.` : "Builder action completed.");
      await refresh(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Builder action failed.");
    } finally {
      setSaving(false);
    }
  }

  const selectedProject = projectDetail?.project ?? projects.find((project) => project.id === selectedProjectId) ?? null;
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
                Safe project creation, preset bootstrapping, typed package actions, and optional agentic Codex runs inside an external workspace.
              </div>
            </div>
            <button onClick={() => void refresh(selectedProjectId)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              refresh
            </button>
          </div>
          {error ? <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>{error}</div> : null}
          {resultNotice ? <div className="text-sm mb-3" style={{ color: "var(--success)" }}>{resultNotice}</div> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "workspace", value: status?.config.safe ? "safe" : "blocked" },
              { label: "projects", value: String(status?.projects.total ?? 0) },
              { label: "running", value: String(status?.projects.running ?? 0) },
              { label: "agentic profile", value: status?.config.defaultAgenticProfile ?? "codex" },
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
                    {profile.enabled ? (profile.metadata?.available ? "enabled" : "enabled but unavailable") : "disabled"}
                  </span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.command}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.description}</div>
                {profile.metadata?.availabilityReason ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{profile.metadata.availabilityReason}</div> : null}
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
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>agentic task</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Profile</label>
                    <select value={agenticProfile} onChange={(event) => setAgenticProfile(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      {(enabledAgentProfiles.length > 0 ? enabledAgentProfiles : status?.cliProfiles ?? []).map((profile) => (
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
                <button disabled={saving || !agenticPrompt.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "run_agentic_task", profile: agenticProfile, prompt: agenticPrompt, model: agenticModel || undefined })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  run agentic task
                </button>
              </div>
            </>
          )}
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>recent runs</div>
          <div className="space-y-3 text-sm">
            {(projectDetail?.runs ?? []).length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No recorded runs for this project yet.</div>
            ) : runsPagination.pageItems.map((run) => (
              <div key={run.id} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span>{run.title}</span>
                  <span style={{ color: run.status === "FAILED" ? "var(--danger)" : run.status === "SUCCEEDED" ? "var(--success)" : "var(--text-dim)" }}>{run.status.toLowerCase()}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.command ?? "command unavailable"}</div>
                {run.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.summary}</div> : null}
                {run.stdout ? <pre className="mt-2 text-xs whitespace-pre-wrap border p-2 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}>{run.stdout}</pre> : null}
                {run.stderr ? <pre className="mt-2 text-xs whitespace-pre-wrap border p-2 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--danger)" }}>{run.stderr}</pre> : null}
              </div>
            ))}
            <PaginationControls {...runsPagination} />
          </div>
        </section>
      </section>
    </div>
  );
}