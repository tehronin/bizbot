"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useState } from "react";

interface OperationRun {
  runId: string;
  profileLabel: string;
  provider: string;
  model: string;
  status: string;
  updatedAt: string;
  toolCallCount: number;
  roundsCompleted: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedPromptTokens: number;
  };
  reply?: string;
  error?: string;
}

interface OperationJob {
  id: string;
  name: string;
  status: string;
  attemptsMade: number;
  failedReason: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface OperationsResponse {
  generatedAt: string;
  worker: {
    workerRunning: boolean;
    workerLastSeenAt: string | null;
    queueName: string;
    counts: Record<string, number>;
    schedulerRegistered: boolean;
  };
  jobs: OperationJob[];
  mcpWorker: {
    queueNames: string[];
    workerRunning: boolean;
    workerLastSeenAt: string | null;
    counts: Record<string, Record<string, number>>;
  };
  mcpJobs: Array<OperationJob & { queueName: string }>;
  runs: OperationRun[];
  mcp: {
    connectedClients: Array<{
      name: string;
      url: string;
      connected: boolean;
      toolCount: number;
    }>;
  };
  contract: {
    version: string;
    latestBuilderProject: { id: string; name: string } | null;
    builderSurface: {
      state: string;
      currentHash: string | null;
      driftDetected: boolean;
      classification: string;
      requiresVersionBump: boolean;
    } | null;
  };
  failures: {
    failedInboxCount: number;
    failedPostCount: number;
    pendingApprovalCount: number;
    streamAbortCount: number;
    streamLastAbortedAt: string | null;
    lastHeartbeatStartedAt: string | null;
    lastHeartbeatFinishedAt: string | null;
    lastHeartbeatSummary: string | null;
  };
}

const EMPTY_COUNTS: Record<string, number> = {
  waiting: 0,
  active: 0,
  delayed: 0,
  completed: 0,
  failed: 0,
};

export default function OperationsPage() {
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/operations");
      const payload = (await response.json()) as OperationsResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load operations status.");
      }
      setData(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load operations status.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const counts = data?.worker.counts ?? EMPTY_COUNTS;
  const runsPagination = usePagination(data?.runs ?? [], 15);
  const jobsPagination = usePagination(data?.jobs ?? [], 15);
  const mcpJobsPagination = usePagination(data?.mcpJobs ?? [], 15);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="space-y-5">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] font-medium mb-1" style={{ color: "var(--text-muted)" }}>operations</div>
              <div className="text-sm" style={{ color: "var(--text-dim)" }}>
                Worker state, queue health, MCP connectivity, and recent agent runs.
              </div>
            </div>
            <button onClick={() => void refresh()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              refresh
            </button>
          </div>
          {error ? <div className="text-sm" style={{ color: "var(--danger)" }}>{error}</div> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "worker", value: data?.worker.workerRunning ? "running" : "stopped" },
              { label: "queue", value: data?.worker.queueName ?? "bizbot-agent-heartbeat" },
              { label: "mcp worker", value: data?.mcpWorker.workerRunning ? "running" : "stopped" },
              { label: "contract", value: data?.contract.version ?? "v1" },
              { label: "pending approvals", value: String(data?.failures.pendingApprovalCount ?? 0) },
              { label: "failed inbox", value: String(data?.failures.failedInboxCount ?? 0) },
              { label: "failed posts", value: String(data?.failures.failedPostCount ?? 0) },
              { label: "stream aborts", value: String(data?.failures.streamAbortCount ?? 0) },
            ].map((card) => (
              <div key={card.label} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>queue counts</div>
          <div className="grid gap-3 sm:grid-cols-5 text-sm">
            {Object.entries(counts).map(([key, value]) => (
              <div key={key} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>{key}</div>
                <div>{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            Worker last seen: {data?.worker.workerLastSeenAt ? new Date(data.worker.workerLastSeenAt).toLocaleString() : "never"}
          </div>
          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            Scheduler registered: {data?.worker.schedulerRegistered ? "yes" : "no"}
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>platform contract</div>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>version</div>
              <div>{data?.contract.version ?? "v1"}</div>
            </div>
            <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>builder surface</div>
              <div>{data?.contract.builderSurface?.state ?? "untracked"}</div>
            </div>
            <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>compatibility</div>
              <div>{data?.contract.builderSurface?.classification ?? "internal_only"}</div>
            </div>
            <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>version bump</div>
              <div>{data?.contract.builderSurface?.requiresVersionBump ? "required" : "not required"}</div>
            </div>
          </div>
          <div className="mt-4 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            Latest Builder project: {data?.contract.latestBuilderProject?.name ?? "none"}
          </div>
          {data?.contract.builderSurface?.currentHash ? (
            <div className="text-xs leading-6 break-all" style={{ color: "var(--text-dim)" }}>{data.contract.builderSurface.currentHash}</div>
          ) : null}
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>mcp queues</div>
          <div className="space-y-3 text-sm">
            {Object.entries(data?.mcpWorker.counts ?? {}).length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No MCP queue activity recorded yet.</div>
            ) : Object.entries(data?.mcpWorker.counts ?? {}).map(([queueName, counts]) => (
              <div key={queueName} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>{queueName}</div>
                <div className="grid gap-3 sm:grid-cols-5 text-xs" style={{ color: "var(--text-dim)" }}>
                  {Object.entries(counts).map(([key, value]) => (
                    <div key={`${queueName}-${key}`}>{key}: {value}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            MCP worker last seen: {data?.mcpWorker.workerLastSeenAt ? new Date(data.mcpWorker.workerLastSeenAt).toLocaleString() : "never"}
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>MCP clients</div>
          <div className="space-y-3 text-sm">
            {(data?.mcp.connectedClients ?? []).length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No imported MCP clients are currently connected.</div>
            ) : (
              data?.mcp.connectedClients.map((client) => (
                <div key={client.name} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between gap-4">
                    <span>{client.name}</span>
                    <span style={{ color: client.connected ? "var(--success)" : "var(--danger)" }}>{client.connected ? "connected" : "disconnected"}</span>
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{client.url}</div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{client.toolCount} tools imported</div>
                </div>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="space-y-5">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>recent runs</div>
          <div className="space-y-3 text-sm">
            {runsPagination.pageItems.map((run) => (
              <div key={run.runId} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span>{run.profileLabel}</span>
                  <span style={{ color: run.status === "completed" ? "var(--success)" : run.status === "failed" ? "var(--danger)" : "var(--text-primary)" }}>{run.status}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  {run.toolCallCount} tool calls across {run.roundsCompleted} rounds
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  {run.provider} · {run.model}
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  {run.usage.totalTokens} total tokens · {run.usage.promptTokens} prompt · {run.usage.completionTokens} completion
                  {run.usage.cachedPromptTokens > 0 ? ` · ${run.usage.cachedPromptTokens} cached` : ""}
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.runId}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{new Date(run.updatedAt).toLocaleString()}</div>
                {run.error ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{run.error}</div> : null}
                {run.reply ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.reply}</div> : null}
              </div>
            ))}
            <PaginationControls {...runsPagination} />
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>recent jobs</div>
          <div className="space-y-3 text-sm">
            {jobsPagination.pageItems.map((job) => (
              <div key={job.id} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span>{job.name}</span>
                  <span style={{ color: job.status === "failed" ? "var(--danger)" : job.status === "completed" ? "var(--success)" : "var(--text-primary)" }}>{job.status}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Attempts: {job.attemptsMade}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Created: {new Date(job.createdAt).toLocaleString()}</div>
                {job.finishedAt ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Finished: {new Date(job.finishedAt).toLocaleString()}</div> : null}
                {job.failedReason ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{job.failedReason}</div> : null}
              </div>
            ))}
            <PaginationControls {...jobsPagination} />
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>recent mcp jobs</div>
          <div className="space-y-3 text-sm">
            {mcpJobsPagination.pageItems.map((job) => (
              <div key={`${job.queueName}-${job.id}`} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span>{job.name}</span>
                  <span style={{ color: job.status === "failed" ? "var(--danger)" : job.status === "completed" ? "var(--success)" : "var(--text-primary)" }}>{job.status}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{job.queueName}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Attempts: {job.attemptsMade}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Created: {new Date(job.createdAt).toLocaleString()}</div>
                {job.finishedAt ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Finished: {new Date(job.finishedAt).toLocaleString()}</div> : null}
                {job.failedReason ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{job.failedReason}</div> : null}
              </div>
            ))}
            <PaginationControls {...mcpJobsPagination} />
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>heartbeat trace</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>last started</span><span>{data?.failures.lastHeartbeatStartedAt ? new Date(data.failures.lastHeartbeatStartedAt).toLocaleString() : "never"}</span></div>
            <div className="flex justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>last finished</span><span>{data?.failures.lastHeartbeatFinishedAt ? new Date(data.failures.lastHeartbeatFinishedAt).toLocaleString() : "never"}</span></div>
            <div className="flex justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>last stream abort</span><span>{data?.failures.streamLastAbortedAt ? new Date(data.failures.streamLastAbortedAt).toLocaleString() : "never"}</span></div>
            {data?.failures.lastHeartbeatSummary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{data.failures.lastHeartbeatSummary}</div> : null}
          </div>
        </section>
      </section>
    </div>
  );
}