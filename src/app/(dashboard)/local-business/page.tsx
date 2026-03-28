"use client";

import { useEffect, useState } from "react";

interface GoogleReview {
  id: string;
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  reviewReply: string | null;
  needsResponse: boolean;
  updateTime: string;
}

interface GooglePost {
  id: string;
  summary: string;
  topicType: string;
  status: string;
  searchUrl: string | null;
  createdAt: string;
}

interface GoogleLocation {
  id: string;
  title: string;
  locationName: string;
  lastSyncAt: string | null;
  regularHours: unknown;
  reviews: GoogleReview[];
  posts: GooglePost[];
}

export default function LocalBusinessPage() {
  const [location, setLocation] = useState<GoogleLocation | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [postSummary, setPostSummary] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [hoursJson, setHoursJson] = useState('[{"openDay":"MONDAY","openTime":"09:00","closeDay":"MONDAY","closeTime":"17:00"}]');

  async function load(sync = false): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/local-business${sync ? "?sync=true" : ""}`);
      const data = (await response.json()) as { configured?: boolean; location?: GoogleLocation | null; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load Google Business data.");
      }

      setConfigured(data.configured === true);
      setLocation(data.location ?? null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function reply(reviewId: string): Promise<void> {
    setError(null);
    const response = await fetch(`/api/local-business/reviews/${reviewId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: replyDrafts[reviewId] ?? "" }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to reply to review.");
    }
    await load(false);
  }

  async function createPost(): Promise<void> {
    setError(null);
    const response = await fetch("/api/local-business/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: postSummary,
        actionType: postUrl ? "LEARN_MORE" : undefined,
        callToActionUrl: postUrl || undefined,
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to create Google Business post.");
    }
    setPostSummary("");
    setPostUrl("");
    await load(true);
  }

  async function updateHours(): Promise<void> {
    setError(null);
    const parsed = JSON.parse(hoursJson) as unknown;
    const response = await fetch("/api/local-business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periods: parsed }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to update hours.");
    }
    await load(false);
  }

  useEffect(() => {
    void load(false);
  }, []);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>google business profile</div>
            <div className="text-sm mt-2" style={{ color: "var(--text-dim)" }}>Reviews, local posts, and hours updates for the location where local search discovery actually happens.</div>
          </div>
          <button onClick={() => void load(true)} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>sync</button>
        </div>
        {loading ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div> : null}
        {error ? <div className="text-sm" style={{ color: "var(--danger, #d16b6b)" }}>{error}</div> : null}
        {!configured ? (
          <div className="text-sm leading-7" style={{ color: "var(--text-dim)" }}>
            Configure `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, `GOOGLE_BUSINESS_REFRESH_TOKEN`, `GOOGLE_BUSINESS_ACCOUNT_NAME`, and `GOOGLE_BUSINESS_LOCATION_NAME` in settings or `.env`.
          </div>
        ) : null}
        {location ? (
          <>
            <div className="border p-3 text-sm space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
              <div>{location.title}</div>
              <div style={{ color: "var(--text-dim)" }}>{location.locationName}</div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                last sync {location.lastSyncAt ? new Date(location.lastSyncAt).toLocaleString() : "never"}
              </div>
            </div>
            <div className="space-y-3">
              {location.reviews.map((review) => (
                <article key={review.id} className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                    <span>{review.reviewerName ?? "anonymous"}</span>
                    <span>{review.starRating} stars</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{review.comment ?? "No review text"}</div>
                  {review.reviewReply ? (
                    <div className="border p-3 text-sm whitespace-pre-wrap" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      {review.reviewReply}
                    </div>
                  ) : null}
                  <textarea
                    value={replyDrafts[review.id] ?? ""}
                    onChange={(event) => setReplyDrafts((current) => ({ ...current, [review.id]: event.target.value }))}
                    placeholder={review.needsResponse ? "Draft a review reply" : "Update reply"}
                    className="w-full min-h-24 bg-transparent border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  />
                  <button onClick={() => void reply(review.id)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                    {review.reviewReply ? "update reply" : "reply"}
                  </button>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="space-y-6">
        <section className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>new local post</div>
          <textarea value={postSummary} onChange={(event) => setPostSummary(event.target.value)} placeholder="Update, offer, event, or announcement" className="w-full min-h-32 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="Call to action URL" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <button onClick={() => void createPost()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>publish post</button>
          <div className="space-y-3">
            {location?.posts.map((post) => (
              <article key={post.id} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>
                  <span>{post.topicType}</span>
                  <span>{post.status}</span>
                </div>
                <div className="text-sm whitespace-pre-wrap">{post.summary}</div>
                {post.searchUrl ? <a href={post.searchUrl} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--accent)" }}>view on Google</a> : null}
              </article>
            ))}
          </div>
        </section>

        <section className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>business hours</div>
          <textarea value={hoursJson} onChange={(event) => setHoursJson(event.target.value)} className="w-full min-h-32 bg-transparent border px-3 py-2 text-sm font-mono" style={{ borderColor: "var(--border)" }} />
          <button onClick={() => void updateHours()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>update hours</button>
        </section>
      </section>
    </div>
  );
}