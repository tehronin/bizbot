"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useState } from "react";
import { usePosts } from "@/hooks/usePosts";

export default function PostsPage() {
  const { posts, loading, reload } = usePosts();
  const [content, setContent] = useState("");
  const [platformId, setPlatformId] = useState("");
  const postsPagination = usePagination(posts, 15);

  async function createDraft(): Promise<void> {
    await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, platformId }),
    });
    setContent("");
    reload();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>new draft</div>
        <div className="space-y-3">
          <input value={platformId} onChange={(event) => setPlatformId(event.target.value)} placeholder="Platform ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Post copy" className="w-full min-h-40 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <button onClick={() => void createDraft()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            Save Draft
          </button>
        </div>
      </section>
      <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>post queue</div>
          <button onClick={reload} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>refresh</button>
        </div>
        <div className="space-y-3">
          {loading && <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>}
          {!loading && postsPagination.pageItems.map((post) => (
            <article key={post.id} className="border p-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] mb-2" style={{ color: "var(--text-muted)" }}>
                <span>{post.status}</span>
                <span>{post.platformId}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{post.content}</div>
            </article>
          ))}
          {!loading ? <PaginationControls {...postsPagination} /> : null}
        </div>
      </section>
    </div>
  );
}
