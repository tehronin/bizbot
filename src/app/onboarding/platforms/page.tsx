"use client";

import Link from "next/link";
import { useState } from "react";

export default function OnboardingPlatformsPage() {
  const [twitterUserId, setTwitterUserId] = useState("");
  const [twitterAccessToken, setTwitterAccessToken] = useState("");
  const [twitterAccessTokenSecret, setTwitterAccessTokenSecret] = useState("");
  const [facebookPageId, setFacebookPageId] = useState("");
  const [metaPageId, setMetaPageId] = useState("");
  const [instagramBusinessAccountId, setInstagramBusinessAccountId] = useState("");
  const [metaInstagramAccountId, setMetaInstagramAccountId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaWebhookVerifyToken, setMetaWebhookVerifyToken] = useState("");
  const [processWebhooksImmediately, setProcessWebhooksImmediately] = useState(true);
  const [workspacePath, setWorkspacePath] = useState("./workspace");

  async function save(): Promise<void> {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env: {
          TWITTER_USER_ID: twitterUserId,
          TWITTER_ACCESS_TOKEN: twitterAccessToken,
          TWITTER_ACCESS_TOKEN_SECRET: twitterAccessTokenSecret,
          FACEBOOK_PAGE_ID: facebookPageId,
          META_PAGE_ID: metaPageId || facebookPageId,
          INSTAGRAM_BUSINESS_ACCOUNT_ID: instagramBusinessAccountId,
          META_INSTAGRAM_ACCOUNT_ID: metaInstagramAccountId || instagramBusinessAccountId,
          META_ACCESS_TOKEN: metaAccessToken,
          META_WEBHOOK_VERIFY_TOKEN: metaWebhookVerifyToken,
          BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY: processWebhooksImmediately ? "true" : "false",
          BIZBOT_WORKSPACE_PATH: workspacePath,
        },
      }),
    });
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "platforms" }),
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-3xl border p-8 space-y-6" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>step 2: platforms + webhook flow</div>
          <div className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
            Save the IDs and tokens needed for inbox sync, DM replies, and Meta webhook verification. This is also where the local workspace path should be locked in.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <input value={facebookPageId} onChange={(event) => setFacebookPageId(event.target.value)} placeholder="FACEBOOK_PAGE_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={metaPageId} onChange={(event) => setMetaPageId(event.target.value)} placeholder="META_PAGE_ID (optional if same as Facebook page ID)" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={instagramBusinessAccountId} onChange={(event) => setInstagramBusinessAccountId(event.target.value)} placeholder="INSTAGRAM_BUSINESS_ACCOUNT_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={metaInstagramAccountId} onChange={(event) => setMetaInstagramAccountId(event.target.value)} placeholder="META_INSTAGRAM_ACCOUNT_ID (optional if same as business account ID)" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={metaAccessToken} onChange={(event) => setMetaAccessToken(event.target.value)} placeholder="META_ACCESS_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={metaWebhookVerifyToken} onChange={(event) => setMetaWebhookVerifyToken(event.target.value)} placeholder="META_WEBHOOK_VERIFY_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div className="space-y-3">
            <input value={twitterUserId} onChange={(event) => setTwitterUserId(event.target.value)} placeholder="TWITTER_USER_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={twitterAccessToken} onChange={(event) => setTwitterAccessToken(event.target.value)} placeholder="TWITTER_ACCESS_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={twitterAccessTokenSecret} onChange={(event) => setTwitterAccessTokenSecret(event.target.value)} placeholder="TWITTER_ACCESS_TOKEN_SECRET" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="BIZBOT_WORKSPACE_PATH" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>Process webhook inbox immediately</span>
              <input type="checkbox" checked={processWebhooksImmediately} onChange={(event) => setProcessWebhooksImmediately(event.target.checked)} />
            </label>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              If you turn immediate processing off, webhook events still land in the inbox but are handled by the heartbeat worker on its normal cadence instead of immediately.
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/policies" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
