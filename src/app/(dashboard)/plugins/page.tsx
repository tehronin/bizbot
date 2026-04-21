"use client";

import { useEffect, useState } from "react";

interface PluginCatalogEntry {
  id: string;
  kind: "builtin" | "external";
  displayName: string;
  description: string;
  enabled: boolean;
  connected: boolean;
  installed: boolean;
  removable: boolean;
  removalLabel: string;
  managementSummary: string;
  toolNames: string[];
  tags: string[];
  version?: string;
  url?: string;
  envKey?: string;
  hasAuthToken?: boolean;
  promptCount?: number;
  resourceCount?: number;
  destructiveToolCount?: number;
  openWorldToolCount?: number;
  latencyClass?: "unknown" | "fast" | "moderate" | "slow";
  auditState?: "unaudited" | "audited" | "drifted";
  lastSeenAt?: string | null;
}

interface PluginCatalogSection {
  installed: PluginCatalogEntry[];
  available: PluginCatalogEntry[];
}

interface PluginCatalogResponse {
  generatedAt: string;
  summary: {
    builtinEnabled: number;
    builtinDisabled: number;
    externalEnabled: number;
    externalDisabled: number;
    connectedExternal: number;
  };
  builtin: PluginCatalogSection;
  external: PluginCatalogSection;
  discovery: {
    bundles: Array<{
      bundleId: string;
      title: string;
      description: string;
      toolCount: number;
      resourceCount: number;
      promptCount: number;
    }>;
    skillResources: Array<{
      name: string;
      title: string;
      uri: string;
      description: string;
    }>;
    importedCatalog: {
      promptCount: number;
      resourceCount: number;
      driftState: "unaudited" | "audited" | "drifted";
      driftedServerCount: number;
    };
    taskRecipes: Array<{
      recipeId: string;
      title: string;
      description: string;
      bundleCount: number;
    }>;
    devLoop: {
      preferredAppCommand: string;
      preferredMcpCommand: string;
      reviewResourceUri: string;
      optimizationPromptName: string;
      traceResourceUri: string;
    };
  };
  error?: string;
}

type MutationState = Record<string, boolean>;

interface ExternalPluginFormState {
  pluginId: string | null;
  name: string;
  url: string;
  enabled: boolean;
  authToken: string;
  clearAuthToken: boolean;
}

const EMPTY_EXTERNAL_FORM: ExternalPluginFormState = {
  pluginId: null,
  name: "",
  url: "",
  enabled: true,
  authToken: "",
  clearAuthToken: false,
};

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border p-4 border-border-sub bg-raised">
      <div className="text-xs uppercase tracking-[0.22em] mb-2 text-muted">{label}</div>
      <div className="text-lg text-primary">{value}</div>
      <div className="text-xs mt-2 leading-6 text-dim">{detail}</div>
    </div>
  );
}

function DiscoveryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 border text-xs border-border-sub bg-surface text-dim">
      <span className="text-muted">{label}: </span>
      <span className="text-primary">{value}</span>
    </div>
  );
}

function PluginCard({
  entry,
  busy,
  onToggle,
  onRemove,
  onEdit,
}: {
  entry: PluginCatalogEntry;
  busy: boolean;
  onToggle: (entry: PluginCatalogEntry, enabled: boolean) => Promise<void>;
  onRemove: (entry: PluginCatalogEntry) => Promise<void>;
  onEdit?: (entry: PluginCatalogEntry) => void;
}) {
  return (
    <article className={`border p-4 space-y-4 ${entry.enabled ? "border-accent bg-accent-glow" : "border-border-sub bg-raised"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-muted">{entry.kind}</div>
            <div className={`text-xs uppercase tracking-[0.18em] px-2 py-1 border ${entry.connected ? "border-success text-success" : "border-border-sub text-dim"}`}>
              {entry.connected ? "connected" : entry.enabled ? "enabled" : "disabled"}
            </div>
          </div>
          <div>
            <h2 className="text-sm uppercase tracking-[0.16em] text-primary">{entry.displayName}</h2>
            <div className="text-xs mt-2 leading-6 text-dim">{entry.description}</div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted">
          <span>{entry.enabled ? "on" : "off"}</span>
          <input
            type="checkbox"
            checked={entry.enabled}
            disabled={busy}
            onChange={(event) => void onToggle(entry, event.target.checked)}
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <div className="text-xs leading-6 text-dim">{entry.managementSummary}</div>
          {entry.url ? <div className="text-xs leading-6 break-all text-dim">{entry.url}</div> : null}
          {entry.envKey ? <div className="text-xs leading-6 text-dim">Controlled by {entry.envKey}</div> : null}
          {entry.version ? <div className="text-xs leading-6 text-dim">Version {entry.version}</div> : null}
          {entry.tags.length > 0 ? <div className="text-xs leading-6 text-dim">Tags: {entry.tags.join(", ")}</div> : null}
          {entry.kind === "external" ? (
            <div className="flex flex-wrap gap-2">
              <DiscoveryChip label="prompts" value={String(entry.promptCount ?? 0)} />
              <DiscoveryChip label="resources" value={String(entry.resourceCount ?? 0)} />
              <DiscoveryChip label="destructive" value={String(entry.destructiveToolCount ?? 0)} />
              <DiscoveryChip label="open-world" value={String(entry.openWorldToolCount ?? 0)} />
              <DiscoveryChip label="latency" value={entry.latencyClass ?? "unknown"} />
              <DiscoveryChip label="audit" value={entry.auditState ?? "unaudited"} />
            </div>
          ) : null}
          {entry.kind === "external" && entry.lastSeenAt ? <div className="text-xs leading-6 text-dim">Last seen {new Date(entry.lastSeenAt).toLocaleString()}</div> : null}
        </div>

        <div className="flex items-start justify-end gap-2">
          {entry.kind === "external" && onEdit ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onEdit(entry)}
              className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent"
              style={{ opacity: busy ? 0.65 : 1 }}
            >
              edit
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || !entry.removable}
            onClick={() => void onRemove(entry)}
            className={`px-3 py-2 border text-xs uppercase tracking-[0.18em] ${entry.removable ? "border-danger text-danger" : "border-border-sub text-dim"}`}
            style={{ opacity: busy ? 0.65 : 1 }}
          >
            {entry.removable ? entry.removalLabel : "source-managed"}
          </button>
        </div>
      </div>

      <div className="border p-3 border-border-sub bg-surface">
        <div className="text-xs uppercase tracking-[0.18em] mb-2 text-muted">tools</div>
        {entry.toolNames.length === 0 ? (
          <div className="text-xs leading-6 text-dim">
            {entry.kind === "external" && entry.enabled
              ? "No tools discovered yet. Check the MCP connection status."
              : "No tools are exposed while this plugin is disabled."}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {entry.toolNames.map((toolName) => (
              <span key={toolName} className="px-2 py-1 text-xs border border-border-sub text-dim">
                {toolName}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function PluginSection({
  title,
  description,
  entries,
  busyMap,
  onToggle,
  onRemove,
  onEdit,
}: {
  title: string;
  description: string;
  entries: PluginCatalogEntry[];
  busyMap: MutationState;
  onToggle: (entry: PluginCatalogEntry, enabled: boolean) => Promise<void>;
  onRemove: (entry: PluginCatalogEntry) => Promise<void>;
  onEdit?: (entry: PluginCatalogEntry) => void;
}) {
  return (
    <section className="border p-4 space-y-4 border-border bg-surface">
      <div>
        <div className="text-xs uppercase tracking-[0.24em] mb-2 text-muted">{title}</div>
        <div className="text-sm text-dim">{description}</div>
      </div>

      {entries.length === 0 ? (
        <div className="text-sm text-dim">No plugins in this section.</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {entries.map((entry) => (
            <PluginCard
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              busy={busyMap[`${entry.kind}:${entry.id}`] ?? false}
              onToggle={onToggle}
              onRemove={onRemove}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function PluginsPage() {
  const [data, setData] = useState<PluginCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyMap, setBusyMap] = useState<MutationState>({});
  const [formState, setFormState] = useState<ExternalPluginFormState>(EMPTY_EXTERNAL_FORM);
  const [formBusy, setFormBusy] = useState(false);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/plugins");
      const payload = (await response.json()) as PluginCatalogResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load plugin catalog.");
      }
      setData(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load plugin catalog.");
    }
  }

  function startCreateExternal(): void {
    setFormState(EMPTY_EXTERNAL_FORM);
    setError(null);
  }

  function startEditExternal(entry: PluginCatalogEntry): void {
    setFormState({
      pluginId: entry.id,
      name: entry.id,
      url: entry.url ?? "",
      enabled: entry.enabled,
      authToken: "",
      clearAuthToken: false,
    });
    setError(null);
  }

  async function saveExternalPlugin(): Promise<void> {
    setFormBusy(true);
    setError(null);

    try {
      const method = formState.pluginId ? "PUT" : "POST";
      const response = await fetch("/api/plugins", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "external",
          ...(formState.pluginId ? { pluginId: formState.pluginId } : {}),
          config: {
            name: formState.name,
            url: formState.url,
            enabled: formState.enabled,
            authToken: formState.authToken,
            clearAuthToken: formState.clearAuthToken,
          },
        }),
      });
      const payload = (await response.json()) as PluginCatalogResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save external plugin.");
      }

      setData(payload);
      setFormState(EMPTY_EXTERNAL_FORM);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save external plugin.");
    } finally {
      setFormBusy(false);
    }
  }

  async function toggleEntry(entry: PluginCatalogEntry, enabled: boolean): Promise<void> {
    const key = `${entry.kind}:${entry.id}`;
    setBusyMap((current) => ({ ...current, [key]: true }));
    setError(null);

    try {
      const response = await fetch("/api/plugins", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: entry.id, kind: entry.kind, enabled }),
      });
      const payload = (await response.json()) as PluginCatalogResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update plugin state.");
      }
      setData(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update plugin state.");
    } finally {
      setBusyMap((current) => ({ ...current, [key]: false }));
    }
  }

  async function removeEntry(entry: PluginCatalogEntry): Promise<void> {
    if (!entry.removable) {
      return;
    }

    const key = `${entry.kind}:${entry.id}`;
    setBusyMap((current) => ({ ...current, [key]: true }));
    setError(null);

    try {
      const response = await fetch("/api/plugins", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: entry.id, kind: entry.kind }),
      });
      const payload = (await response.json()) as PluginCatalogResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to remove plugin.");
      }
      setData(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to remove plugin.");
    } finally {
      setBusyMap((current) => ({ ...current, [key]: false }));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="space-y-5">
      <section className="border p-4 space-y-4 border-border bg-surface">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-2 text-muted">plugins</div>
            <div className="text-sm text-dim">
              Builtin plugins can be enabled or disabled. External MCP integrations can also be disconnected without deleting retained knowledge or graph data.
            </div>
          </div>
          <button onClick={() => void refresh()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent">
            refresh
          </button>
        </div>

        {error ? <div className="text-sm text-danger">{error}</div> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="builtin enabled" value={String(data?.summary.builtinEnabled ?? 0)} detail="Source-managed plugins currently visible to the agent." />
          <SummaryCard label="builtin available" value={String(data?.summary.builtinDisabled ?? 0)} detail="Builtin plugins present in the repo but currently disabled." />
          <SummaryCard label="external enabled" value={String(data?.summary.externalEnabled ?? 0)} detail="Configured MCP integrations currently allowed to contribute tools." />
          <SummaryCard label="external available" value={String(data?.summary.externalDisabled ?? 0)} detail="Configured MCP integrations that are currently disabled." />
          <SummaryCard label="connected" value={String(data?.summary.connectedExternal ?? 0)} detail="External integrations with an active MCP connection right now." />
        </div>

        <div className="text-xs leading-6 text-dim">
          Last refresh: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "not loaded"}
        </div>
      </section>

      <section className="border p-4 space-y-4 border-border bg-surface">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] mb-2 text-muted">mcp discovery</div>
          <div className="text-sm text-dim">
            Discovery bundles, skill resources, and VS Code dev-loop guidance are surfaced here so MCP authoring and debugging paths are visible inside the app.
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <DiscoveryChip label="imported prompts" value={String(data?.discovery.importedCatalog.promptCount ?? 0)} />
          <DiscoveryChip label="imported resources" value={String(data?.discovery.importedCatalog.resourceCount ?? 0)} />
          <DiscoveryChip label="imported drift" value={data?.discovery.importedCatalog.driftState ?? "unaudited"} />
          <DiscoveryChip label="drifted servers" value={String(data?.discovery.importedCatalog.driftedServerCount ?? 0)} />
          <DiscoveryChip label="task recipes" value={String(data?.discovery.taskRecipes.length ?? 0)} />
          <DiscoveryChip label="app loop" value={data?.discovery.devLoop.preferredAppCommand ?? "npm run dev:vscode"} />
          <DiscoveryChip label="mcp loop" value={data?.discovery.devLoop.preferredMcpCommand ?? "npm run mcp:stdio"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="border p-4 space-y-3 border-border-sub bg-raised">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">recommended bundles</div>
            {(data?.discovery.bundles ?? []).map((bundle) => (
              <div key={bundle.bundleId} className="border p-3 space-y-2 border-border-sub bg-surface">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-primary">{bundle.title}</div>
                  <div className="text-xs mt-2 leading-6 text-dim">{bundle.description}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <DiscoveryChip label="bundle" value={bundle.bundleId} />
                  <DiscoveryChip label="tools" value={String(bundle.toolCount)} />
                  <DiscoveryChip label="resources" value={String(bundle.resourceCount)} />
                  <DiscoveryChip label="prompts" value={String(bundle.promptCount)} />
                </div>
              </div>
            ))}
          </div>

          <div className="border p-4 space-y-3 border-border-sub bg-raised">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">skill resources</div>
            {(data?.discovery.skillResources ?? []).map((resource) => (
              <div key={resource.uri} className="border p-3 space-y-2 border-border-sub bg-surface">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-primary">{resource.title}</div>
                  <div className="text-xs mt-2 leading-6 text-dim">{resource.description}</div>
                </div>
                <div className="text-xs leading-6 break-all text-dim">{resource.uri}</div>
              </div>
            ))}
          </div>

          <div className="border p-4 space-y-3 border-border-sub bg-raised">
            <div className="text-xs uppercase tracking-[0.18em] text-muted">task recipes</div>
            {(data?.discovery.taskRecipes ?? []).map((recipe) => (
              <div key={recipe.recipeId} className="border p-3 space-y-2 border-border-sub bg-surface">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-primary">{recipe.title}</div>
                  <div className="text-xs mt-2 leading-6 text-dim">{recipe.description}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <DiscoveryChip label="recipe" value={recipe.recipeId} />
                  <DiscoveryChip label="bundles" value={String(recipe.bundleCount)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border p-4 border-border-sub bg-raised">
          <div className="text-xs uppercase tracking-[0.18em] mb-2 text-muted">vs code dev loop</div>
          <div className="text-sm leading-6 text-dim">
            Review {data?.discovery.devLoop.reviewResourceUri ?? "bizbot://debug/vscode-mcp-devloop"} for the checked-in MCP connection, inspect {data?.discovery.devLoop.traceResourceUri ?? "bizbot://debug/mcp-trace"} when discovery and execution disagree, and use {data?.discovery.devLoop.optimizationPromptName ?? "optimize-vscode-mcp-devloop"} when you want a guided pass on the VS Code to BizBot loop.
          </div>
        </div>
      </section>

      <PluginSection
        title="builtin installed"
        description="Enabled builtin plugins contribute tools immediately. Disabling one removes its tools from the live agent catalog."
        entries={data?.builtin.installed ?? []}
        busyMap={busyMap}
        onToggle={toggleEntry}
        onRemove={removeEntry}
      />

      <PluginSection
        title="builtin available"
        description="These builtin plugins ship with the repo but are currently disabled. Enable them here instead of editing the registry manually."
        entries={data?.builtin.available ?? []}
        busyMap={busyMap}
        onToggle={toggleEntry}
        onRemove={removeEntry}
      />

      <section className="border p-4 space-y-4 border-border bg-surface">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-2 text-muted">
              {formState.pluginId ? "edit external integration" : "add external integration"}
            </div>
            <div className="text-sm text-dim">
              Use a stable integration name because it becomes the MCP tool prefix. Example: github produces tools like mcp_github_list_prs.
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={startCreateExternal} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-border-sub text-dim">
              reset
            </button>
            <button onClick={() => void saveExternalPlugin()} disabled={formBusy} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent"
            style={{ opacity: formBusy ? 0.65 : 1 }}>
              {formState.pluginId ? "save changes" : "create integration"}
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1 text-muted">integration name</label>
            <input
              value={formState.name}
              onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
              className="w-full bg-transparent border px-3 py-2 text-sm border-border"
              placeholder="github"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1 text-muted">server URL</label>
            <input
              value={formState.url}
              onChange={(event) => setFormState((current) => ({ ...current, url: event.target.value }))}
              className="w-full bg-transparent border px-3 py-2 text-sm border-border"
              placeholder="http://localhost:4100/mcp"
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-end">
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1 text-muted">auth token</label>
            <input
              type="password"
              value={formState.authToken}
              onChange={(event) => setFormState((current) => ({ ...current, authToken: event.target.value, clearAuthToken: false }))}
              className="w-full bg-transparent border px-3 py-2 text-sm border-border"
              placeholder={formState.pluginId ? "Leave blank to keep existing token" : "Optional bearer token"}
            />
          </div>
          <label className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted">
            <input
              type="checkbox"
              checked={formState.enabled}
              onChange={(event) => setFormState((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>enabled</span>
          </label>
          <label className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted">
            <input
              type="checkbox"
              checked={formState.clearAuthToken}
              disabled={!formState.pluginId}
              onChange={(event) => setFormState((current) => ({ ...current, clearAuthToken: event.target.checked, authToken: event.target.checked ? "" : current.authToken }))}
            />
            <span>clear token</span>
          </label>
        </div>

        {formState.pluginId ? (
          <div className="text-xs leading-6 text-dim">
            Editing {formState.pluginId}. If this integration already has a stored token, leaving the token field blank keeps it unchanged.
          </div>
        ) : null}
      </section>

      <PluginSection
        title="external installed"
        description="Configured MCP integrations that are currently enabled. Remove disconnects the config entry without deleting retained data."
        entries={data?.external.installed ?? []}
        busyMap={busyMap}
        onToggle={toggleEntry}
        onRemove={removeEntry}
        onEdit={startEditExternal}
      />

      <PluginSection
        title="external available"
        description="Configured MCP integrations that are currently disabled. Re-enable them here, or disconnect them entirely."
        entries={data?.external.available ?? []}
        busyMap={busyMap}
        onToggle={toggleEntry}
        onRemove={removeEntry}
        onEdit={startEditExternal}
      />

      <section className="border p-4 border-border bg-surface">
        <div className="text-xs uppercase tracking-[0.24em] mb-2 text-muted">integration source</div>
        <div className="text-sm text-dim">
          The plugins page is now the primary control surface for external MCP integrations. The raw MCP JSON in settings remains as an advanced fallback only.
        </div>
      </section>
    </div>
  );
}