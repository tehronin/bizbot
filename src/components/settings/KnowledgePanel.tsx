"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

interface KnowledgeDashboardFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
  status: "indexed" | "pending" | "skipped";
  indexedChunks: number;
  skipReason: string | null;
}

interface KnowledgeDashboardSummary {
  enabled: boolean;
  folder: string;
  absolutePath: string;
  exists: boolean;
  lastIndexedAt: string | null;
  indexedFileCount: number;
  indexedChunkCount: number;
  pendingFileCount: number;
  skippedFileCount: number;
  totalFileCount: number;
}

interface KnowledgeDashboardResponse {
  summary: KnowledgeDashboardSummary;
  files: KnowledgeDashboardFile[];
}

interface KnowledgeUploadResult {
  saved: Array<{ path: string; overwritten: boolean }>;
  rejected: Array<{ name: string; reason: string }>;
  sync: {
    indexed: boolean;
    chunkCount?: number;
    changedFiles?: number;
    removedFiles?: number;
    rebuilt?: boolean;
    error?: string;
  };
}

interface KnowledgePreviewChunk {
  index: number;
  snippet: string;
  source: "indexed" | "derived";
}

interface KnowledgeFilePreview {
  path: string;
  indexed: boolean;
  status: KnowledgeDashboardFile["status"] | "missing";
  chunkCount: number;
  snippetCount: number;
  updatedAt: string | null;
  chunks: KnowledgePreviewChunk[];
}

type PanelState = "idle" | "loading" | "saving" | "error";

const ACCEPTED_FILE_TYPES = ".md,.txt,.json,.yaml,.yml,.csv,.html";

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function getStatusTone(status: KnowledgeDashboardFile["status"]): string {
  switch (status) {
    case "indexed":
      return "var(--success)";
    case "pending":
      return "var(--accent)";
    case "skipped":
      return "var(--danger)";
  }
}

function getSnippetMatchRanges(snippet: string, query: string): Array<{ start: number; end: number }> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const lowerSnippet = snippet.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  let matchIndex = lowerSnippet.indexOf(lowerQuery, cursor);

  while (matchIndex !== -1) {
    const end = matchIndex + normalizedQuery.length;
    ranges.push({ start: matchIndex, end });
    cursor = end;
    matchIndex = lowerSnippet.indexOf(lowerQuery, cursor);
  }

  return ranges;
}

function highlightSnippet(snippet: string, query: string, activeMatchIndex: number): ReactNode {
  const ranges = getSnippetMatchRanges(snippet, query);
  if (ranges.length === 0) {
    return snippet;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex];
    const matchIndex = range.start;
    if (matchIndex > cursor) {
      parts.push(<Fragment key={`text:${cursor}`}>{snippet.slice(cursor, matchIndex)}</Fragment>);
    }

    const end = range.end;
    const isActive = rangeIndex === activeMatchIndex;
    parts.push(
      <mark
        key={`mark:${matchIndex}`}
        data-active-match={isActive ? "true" : "false"}
        style={{
          background: isActive ? "rgba(56, 189, 248, 0.45)" : "rgba(56, 189, 248, 0.20)",
          color: "inherit",
          padding: 0,
        }}
      >
        {snippet.slice(matchIndex, end)}
      </mark>,
    );
    cursor = end;
  }

  if (cursor < snippet.length) {
    parts.push(<Fragment key={`text:${cursor}`}>{snippet.slice(cursor)}</Fragment>);
  }

  return parts;
}

export function KnowledgePanel({ refreshNonce = 0 }: { refreshNonce?: number }) {
  const [dashboard, setDashboard] = useState<KnowledgeDashboardResponse | null>(null);
  const [panelState, setPanelState] = useState<PanelState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadResult, setUploadResult] = useState<KnowledgeUploadResult | null>(null);
  const [preview, setPreview] = useState<KnowledgeFilePreview | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewMatchSelection, setPreviewMatchSelection] = useState<Record<string, number>>({});

  async function refreshDashboard(): Promise<void> {
    setPanelState((current) => (current === "saving" ? current : "loading"));
    setError(null);

    try {
      const response = await fetch("/api/knowledge");
      const payload = (await response.json()) as KnowledgeDashboardResponse | { error?: string };
      if (!response.ok || "error" in payload) {
        throw new Error((payload as { error?: string }).error ?? "Failed to load knowledge dashboard.");
      }
      setDashboard(payload as KnowledgeDashboardResponse);
      setPanelState("idle");
    } catch (nextError) {
      setPanelState("error");
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  useEffect(() => {
    void refreshDashboard();
  }, [refreshNonce]);

  async function runAction(action: "reindex_all" | "reindex_file" | "delete_file", path?: string): Promise<void> {
    setPanelState("saving");
    setBusyPath(path ?? null);
    setError(null);
    setUploadResult(null);

    try {
      const response = await fetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, path }),
      });
      const payload = (await response.json()) as { dashboard?: KnowledgeDashboardResponse; error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Knowledge action failed.");
      }
      if (payload.dashboard) {
        setDashboard(payload.dashboard);
      }
      if (preview && action === "delete_file" && preview.path === path) {
        setPreview(null);
        setPreviewPath(null);
        setPreviewMatchSelection({});
      }
      if (preview && action === "reindex_file" && preview.path === path) {
        void loadPreview(path ?? "");
      }
      setPanelState("idle");
    } catch (nextError) {
      setPanelState("error");
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyPath(null);
    }
  }

  async function uploadSelectedFiles(): Promise<void> {
    if (selectedFiles.length === 0) {
      return;
    }

    setPanelState("saving");
    setError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/knowledge", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { uploaded?: KnowledgeUploadResult; dashboard?: KnowledgeDashboardResponse; error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Knowledge upload failed.");
      }
      if (payload.dashboard) {
        setDashboard(payload.dashboard);
      }
      setUploadResult(payload.uploaded ?? null);
      setSelectedFiles([]);
      setPanelState("idle");
    } catch (nextError) {
      setPanelState("error");
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function loadPreview(path: string): Promise<void> {
    setPreviewPath(path);
    setError(null);

    try {
      const response = await fetch(`/api/knowledge?path=${encodeURIComponent(path)}`);
      const payload = (await response.json()) as { preview?: KnowledgeFilePreview; error?: string };
      if (!response.ok || payload.error || !payload.preview) {
        throw new Error(payload.error ?? "Failed to load file preview.");
      }
      setPreview(payload.preview);
      setPreviewQuery("");
      setPreviewMatchSelection({});
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setPreview(null);
    }
  }

  function togglePreview(path: string): void {
    if (preview?.path === path) {
      setPreview(null);
      setPreviewPath(null);
      setPreviewQuery("");
      setPreviewMatchSelection({});
      return;
    }

    void loadPreview(path);
  }

  const summaryCards = useMemo(() => {
    const summary = dashboard?.summary;
    if (!summary) {
      return [];
    }

    return [
      { label: "indexed files", value: String(summary.indexedFileCount) },
      { label: "pending files", value: String(summary.pendingFileCount) },
      { label: "skipped files", value: String(summary.skippedFileCount) },
      { label: "indexed chunks", value: String(summary.indexedChunkCount) },
      { label: "last indexed", value: formatTimestamp(summary.lastIndexedAt) },
      { label: "folder exists", value: summary.exists ? "yes" : "no" },
    ];
  }, [dashboard]);

  const filteredPreviewChunks = useMemo(() => {
    if (!preview) {
      return [];
    }

    const normalizedQuery = previewQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return preview.chunks;
    }

    return preview.chunks.filter((chunk) => chunk.snippet.toLowerCase().includes(normalizedQuery));
  }, [preview, previewQuery]);

  function getChunkSelectionKey(chunk: KnowledgePreviewChunk): string {
    return `${chunk.index}:${chunk.source}`;
  }

  function getActiveMatchIndex(chunk: KnowledgePreviewChunk): number {
    const key = getChunkSelectionKey(chunk);
    const ranges = getSnippetMatchRanges(chunk.snippet, previewQuery);
    if (ranges.length === 0) {
      return 0;
    }

    const current = previewMatchSelection[key] ?? 0;
    if (current < 0) {
      return 0;
    }
    if (current >= ranges.length) {
      return ranges.length - 1;
    }
    return current;
  }

  function moveChunkMatch(chunk: KnowledgePreviewChunk, direction: -1 | 1): void {
    const key = getChunkSelectionKey(chunk);
    const ranges = getSnippetMatchRanges(chunk.snippet, previewQuery);
    if (ranges.length <= 1) {
      return;
    }

    setPreviewMatchSelection((current) => {
      const active = current[key] ?? 0;
      const next = (active + direction + ranges.length) % ranges.length;
      return { ...current, [key]: next };
    });
  }

  return (
    <section className="border p-4 space-y-4 min-w-0 border-border bg-surface">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.24em] text-muted">knowledge ingest</div>
          <div className="text-sm mt-2 text-primary">
            Manage the local knowledge folder, upload supported text docs, and force reindexing when operators need retrieval to catch up.
          </div>
          <div className="text-xs mt-2 leading-6 text-dim">
            Supported types: {ACCEPTED_FILE_TYPES.replaceAll(",", ", ")}.
          </div>
          {dashboard?.summary ? (
            <div className="text-xs mt-2 leading-6 break-all text-dim">
              Root: {dashboard.summary.absolutePath}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3 flex-wrap shrink-0">
          <div className={`text-xs uppercase tracking-[0.18em] ${panelState === "error" ? "text-danger" : panelState === "saving" ? "text-accent" : "text-dim"}`}>
            {panelState}
          </div>
          <button onClick={() => void refreshDashboard()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-border text-primary">
            refresh
          </button>
          <button onClick={() => void runAction("reindex_all")} disabled={panelState === "saving"} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50 border-accent text-accent">
            reindex all
          </button>
        </div>
      </div>

      {error ? <div className="text-xs leading-6 text-danger">{error}</div> : null}

      {dashboard?.summary && !dashboard.summary.enabled ? (
        <div className="border px-3 py-2 text-xs leading-6 border-border-sub bg-raised text-dim">
          Knowledge retrieval is currently disabled. Files can still be staged here, but they will not be retrieved until the knowledge folder toggle is enabled in Settings.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="border p-3 border-border-sub bg-raised">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{card.label}</div>
            <div className="text-sm mt-2 text-primary">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="border p-4 space-y-3 border-border-sub bg-raised">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">upload documents</div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <input
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
              className="w-full bg-transparent border px-3 py-2 text-sm border-border"
            />
            <div className="text-xs mt-2 leading-6 text-dim">
              Uploads overwrite existing files with the same name in the knowledge folder.
            </div>
          </div>
          <button onClick={() => void uploadSelectedFiles()} disabled={panelState === "saving" || selectedFiles.length === 0} className="px-4 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50 border-accent text-accent">
            upload
          </button>
        </div>

        {uploadResult ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border p-3 space-y-2 border-border bg-surface">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted">upload outcome</div>
              <div className="text-sm text-primary">
                Saved {uploadResult.saved.length} file{uploadResult.saved.length === 1 ? "" : "s"}
                {uploadResult.rejected.length > 0 ? `, rejected ${uploadResult.rejected.length}` : ""}.
              </div>
              {uploadResult.saved.length > 0 ? (
                <div className="text-xs leading-6 text-dim">
                  {uploadResult.saved.map((item) => `${item.path}${item.overwritten ? " (overwritten)" : ""}`).join(" | ")}
                </div>
              ) : null}
            </div>

            <div className="border p-3 space-y-2 border-border bg-surface">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted">rejections</div>
              {uploadResult.rejected.length > 0 ? (
                <div className="space-y-1 text-xs leading-6 text-danger">
                  {uploadResult.rejected.map((item) => (
                    <div key={`${item.name}:${item.reason}`}>{item.name}: {item.reason}</div>
                  ))}
                </div>
              ) : (
                <div className="text-xs leading-6 text-dim">No files were rejected.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border border-border-sub bg-raised">
        <div className="grid grid-cols-[minmax(0,2fr)_auto_auto_auto] gap-3 border-b px-3 py-2 text-[11px] uppercase tracking-[0.18em] border-border-sub text-muted">
          <div>file</div>
          <div>status</div>
          <div>size</div>
          <div>actions</div>
        </div>

        <div className="max-h-[420px] overflow-auto divide-y border-border-sub">
          {dashboard?.files.length ? dashboard.files.map((file) => {
            const isBusy = panelState === "saving" && busyPath === file.path;
            return (
              <div key={file.path} className="grid grid-cols-[minmax(0,2fr)_auto_auto_auto] gap-3 px-3 py-3 items-start border-border-sub">
                <div className="min-w-0">
                  <div className="text-sm truncate text-primary">{file.path}</div>
                  <div className="text-xs mt-1 leading-6 text-dim">
                    Updated {formatTimestamp(file.modifiedAt)}
                    {file.indexedChunks > 0 ? ` • ${file.indexedChunks} chunks` : ""}
                    {file.skipReason ? ` • ${file.skipReason}` : ""}
                  </div>
                </div>

                <div className="text-xs uppercase tracking-[0.16em] px-2 py-1 border" style={{ borderColor: getStatusTone(file.status), color: getStatusTone(file.status) }}>
                  {file.status}
                </div>

                <div className="text-xs leading-6 text-dim">{formatBytes(file.size)}</div>

                <div className="flex flex-wrap gap-2 justify-end">
                  <button onClick={() => togglePreview(file.path)} disabled={panelState === "saving"} className="px-2 py-1 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50 border-border text-primary">
                    {preview?.path === file.path ? "hide preview" : previewPath === file.path && !preview ? "loading" : "preview"}
                  </button>
                  <button onClick={() => void runAction("reindex_file", file.path)} disabled={panelState === "saving" || file.status === "skipped"} className="px-2 py-1 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50 border-border text-primary">
                    {isBusy ? "working" : "reindex"}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete ${file.path} from the knowledge folder?`)) {
                        void runAction("delete_file", file.path);
                      }
                    }}
                    disabled={panelState === "saving"}
                    className="px-2 py-1 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50 border-danger text-danger"
                  >
                    delete
                  </button>
                </div>

                {preview?.path === file.path ? (
                  <div className="col-span-4 border mt-3 p-3 space-y-3 border-border-sub bg-surface">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">chunk preview</div>
                        <div className="text-xs mt-1 leading-6 text-dim">
                          Status {preview.status} • {preview.chunkCount} chunk{preview.chunkCount === 1 ? "" : "s"} • updated {formatTimestamp(preview.updatedAt)}
                        </div>
                      </div>
                      <div className="text-xs leading-6 text-dim">
                        {preview.indexed ? "Showing indexed chunks from retrieval storage." : "Showing derived chunks from the current file contents."}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div>
                        <label className="block text-[11px] uppercase tracking-[0.16em] mb-1 text-muted">search preview</label>
                        <input
                          value={previewQuery}
                          onChange={(event) => {
                            setPreviewQuery(event.target.value);
                            setPreviewMatchSelection({});
                          }}
                          placeholder="Filter chunks by text"
                          className="w-full bg-transparent border px-3 py-2 text-sm border-border"
                        />
                      </div>
                      <div className="text-xs leading-6 text-dim">
                        Showing {filteredPreviewChunks.length} of {preview.chunks.length} preview chunk{preview.chunks.length === 1 ? "" : "s"}
                      </div>
                    </div>

                    {filteredPreviewChunks.length > 0 ? (
                      <div className="space-y-2">
                        {filteredPreviewChunks.map((chunk) => (
                          <div key={`${chunk.index}:${chunk.source}`} className="border p-3 border-border-sub">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
                                chunk {chunk.index} • {chunk.source}
                              </div>
                              {previewQuery.trim() ? (() => {
                                const matchRanges = getSnippetMatchRanges(chunk.snippet, previewQuery);
                                const activeMatchIndex = getActiveMatchIndex(chunk);
                                if (matchRanges.length === 0) {
                                  return <div className="text-[11px] uppercase tracking-[0.16em] text-dim">0 matches</div>;
                                }

                                return (
                                  <div className="flex items-center gap-2">
                                    <div className="text-[11px] uppercase tracking-[0.16em] text-dim">
                                      {activeMatchIndex + 1} / {matchRanges.length} matches
                                    </div>
                                    {matchRanges.length > 1 ? (
                                      <>
                                        <button
                                          onClick={() => moveChunkMatch(chunk, -1)}
                                          className="px-2 py-1 border text-[11px] uppercase tracking-[0.16em] border-border text-primary"
                                          aria-label={`Previous match in chunk ${chunk.index}`}
                                        >
                                          prev
                                        </button>
                                        <button
                                          onClick={() => moveChunkMatch(chunk, 1)}
                                          className="px-2 py-1 border text-[11px] uppercase tracking-[0.16em] border-border text-primary"
                                          aria-label={`Next match in chunk ${chunk.index}`}
                                        >
                                          next
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                );
                              })() : null}
                            </div>
                            <div className="text-sm mt-2 leading-6 text-primary">
                              {highlightSnippet(chunk.snippet, previewQuery, getActiveMatchIndex(chunk))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : preview.chunks.length > 0 ? (
                      <div className="text-xs leading-6 text-dim">
                        No preview chunks match the current filter.
                      </div>
                    ) : (
                      <div className={`text-xs leading-6 ${preview.status === "skipped" ? "text-danger" : "text-dim"}`}>
                        {file.skipReason ?? "No chunk preview is available for this file yet."}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <div className="px-3 py-6 text-sm text-dim">
              {panelState === "loading" ? "Loading knowledge files..." : "No files found in the knowledge folder yet."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}