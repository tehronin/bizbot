"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AgenticSetupChatProvider = "ollama" | "google" | "openai" | "anthropic" | "minimax";
type AgenticSetupEmbeddingProvider = "google" | "openai" | "ollama";
type AgenticSetupCrmMode = "internal" | "hubspot";
type AgenticSetupStep = "welcome" | "llm" | "platforms" | "review";
type AgenticSetupSessionStatus = "not_started" | "in_progress" | "paused" | "completed";

interface AgenticSetupSession {
  version: 1;
  status: AgenticSetupSessionStatus;
  step: AgenticSetupStep;
  selectedChatProvider: AgenticSetupChatProvider;
  selectedEmbeddingProvider: AgenticSetupEmbeddingProvider;
  confirmedLocalChatProvider: boolean;
  confirmedLocalEmbeddingProvider: boolean;
  useCases: {
    knowledge: boolean;
    social: boolean;
    localBusiness: boolean;
    crm: boolean;
  };
  channels: {
    meta: boolean;
    twitter: boolean;
  };
  crmMode: AgenticSetupCrmMode;
  skipped: string[];
  updatedAt: string | null;
}

interface AgenticSetupCheck {
  id: string;
  label: string;
  ready: boolean;
  required: boolean;
  detail: string;
}

interface AgenticSetupResponse {
  session: AgenticSetupSession;
  state: {
    tone: "missing" | "partial" | "ready";
    label: string;
    detail: string;
    nextRequiredLabel: string | null;
    isFirstRun: boolean;
    completionPercent: number;
    requiredTotal: number;
    requiredReady: number;
    checks: AgenticSetupCheck[];
  };
  stored: {
    publicEnv: Record<string, string>;
    secretPresence: Record<string, boolean>;
  };
}

interface AgenticSetupSessionPatch {
  step?: AgenticSetupStep;
  status?: AgenticSetupSessionStatus;
  selectedChatProvider?: AgenticSetupChatProvider;
  selectedEmbeddingProvider?: AgenticSetupEmbeddingProvider;
  confirmedLocalChatProvider?: boolean;
  confirmedLocalEmbeddingProvider?: boolean;
  useCases?: Partial<AgenticSetupSession["useCases"]>;
  channels?: Partial<AgenticSetupSession["channels"]>;
  crmMode?: AgenticSetupCrmMode;
  skipped?: string[];
  updatedAt?: string | null;
}

interface AgenticSetupDrawerProps {
  open: boolean;
  closeHref: string;
}

interface SetupFormState {
  workspacePath: string;
  googleApiKey: string;
  openAiApiKey: string;
  anthropicApiKey: string;
  miniMaxApiKey: string;
  googleBusinessClientId: string;
  googleBusinessClientSecret: string;
  googleBusinessRefreshToken: string;
  googleBusinessAccountName: string;
  googleBusinessLocationName: string;
  googleBusinessInfoLocationName: string;
  facebookPageId: string;
  metaPageId: string;
  instagramBusinessAccountId: string;
  metaInstagramAccountId: string;
  metaAccessToken: string;
  metaWebhookVerifyToken: string;
  twitterUserId: string;
  twitterAppKey: string;
  twitterAppSecret: string;
  twitterAccessToken: string;
  twitterAccessTokenSecret: string;
  hubspotPortalId: string;
  hubspotPrivateAppToken: string;
}

const QUICK_START_GOOGLE_FLAG = "quick_start_google";
const ADVANCED_PROVIDER_FLAG = "advanced_provider_choice";

const STEP_ORDER: AgenticSetupStep[] = ["welcome", "llm", "platforms", "review"];

const STEP_TITLES: Record<AgenticSetupStep, string> = {
  welcome: "Choose your setup path",
  llm: "Connect chat and knowledge",
  platforms: "Add optional integrations",
  review: "Review and confirm",
};

const EMPTY_FORM: SetupFormState = {
  workspacePath: "./workspace",
  googleApiKey: "",
  openAiApiKey: "",
  anthropicApiKey: "",
  miniMaxApiKey: "",
  googleBusinessClientId: "",
  googleBusinessClientSecret: "",
  googleBusinessRefreshToken: "",
  googleBusinessAccountName: "",
  googleBusinessLocationName: "",
  googleBusinessInfoLocationName: "",
  facebookPageId: "",
  metaPageId: "",
  instagramBusinessAccountId: "",
  metaInstagramAccountId: "",
  metaAccessToken: "",
  metaWebhookVerifyToken: "",
  twitterUserId: "",
  twitterAppKey: "",
  twitterAppSecret: "",
  twitterAccessToken: "",
  twitterAccessTokenSecret: "",
  hubspotPortalId: "",
  hubspotPrivateAppToken: "",
};

function emitSetupChanged(): void {
  window.dispatchEvent(new Event("bizbot:agentic-setup-changed"));
}

function getToneStyles(tone: AgenticSetupResponse["state"]["tone"]): { border: string; text: string; bg: string } {
  if (tone === "ready") {
    return { border: "var(--success)", text: "var(--success)", bg: "rgba(58,140,92,0.10)" };
  }
  if (tone === "partial") {
    return { border: "var(--warning)", text: "var(--warning)", bg: "rgba(214,146,58,0.10)" };
  }
  return { border: "var(--danger)", text: "var(--danger)", bg: "rgba(217,79,79,0.10)" };
}

function getProviderSecretKey(provider: AgenticSetupChatProvider): keyof SetupFormState | null {
  switch (provider) {
    case "google":
      return "googleApiKey";
    case "openai":
      return "openAiApiKey";
    case "anthropic":
      return "anthropicApiKey";
    case "minimax":
      return "miniMaxApiKey";
    default:
      return null;
  }
}

function shouldIncludePlatformsStep(session: AgenticSetupSession): boolean {
  return session.useCases.social
    || session.useCases.localBusiness
    || session.useCases.crm
    || session.skipped.includes(QUICK_START_GOOGLE_FLAG);
}

function getNextStep(step: AgenticSetupStep, session: AgenticSetupSession): AgenticSetupStep {
  const orderedSteps = shouldIncludePlatformsStep(session)
    ? STEP_ORDER
    : STEP_ORDER.filter((entry) => entry !== "platforms");
  const index = orderedSteps.indexOf(step);
  return orderedSteps[Math.min(index + 1, orderedSteps.length - 1)] ?? "review";
}

function getPreviousStep(step: AgenticSetupStep, session: AgenticSetupSession): AgenticSetupStep {
  const orderedSteps = shouldIncludePlatformsStep(session)
    ? STEP_ORDER
    : STEP_ORDER.filter((entry) => entry !== "platforms");
  const index = orderedSteps.indexOf(step);
  return orderedSteps[Math.max(index - 1, 0)] ?? "welcome";
}

export function AgenticSetupDrawer({ open, closeHref }: AgenticSetupDrawerProps) {
  const [payload, setPayload] = useState<AgenticSetupResponse | null>(null);
  const [form, setForm] = useState<SetupFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLoading(true);
    setError(null);
    fetch("/api/agentic-setup")
      .then((response) => response.json() as Promise<AgenticSetupResponse>)
      .then((data) => {
        setPayload(data);
        setForm({
          ...EMPTY_FORM,
          workspacePath: data.stored.publicEnv.BIZBOT_WORKSPACE_PATH || "./workspace",
          googleBusinessAccountName: data.stored.publicEnv.GOOGLE_BUSINESS_ACCOUNT_NAME || "",
          googleBusinessLocationName: data.stored.publicEnv.GOOGLE_BUSINESS_LOCATION_NAME || "",
          googleBusinessInfoLocationName: data.stored.publicEnv.GOOGLE_BUSINESS_INFO_LOCATION_NAME || "",
          facebookPageId: data.stored.publicEnv.FACEBOOK_PAGE_ID || "",
          metaPageId: data.stored.publicEnv.META_PAGE_ID || "",
          instagramBusinessAccountId: data.stored.publicEnv.INSTAGRAM_BUSINESS_ACCOUNT_ID || "",
          metaInstagramAccountId: data.stored.publicEnv.META_INSTAGRAM_ACCOUNT_ID || "",
          twitterUserId: data.stored.publicEnv.TWITTER_USER_ID || "",
          hubspotPortalId: data.stored.publicEnv.HUBSPOT_PORTAL_ID || "",
        });
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  }, [open]);

  function updateSession(patch: AgenticSetupSessionPatch): void {
    setPayload((current) => current ? { ...current, session: { ...current.session, ...patch, useCases: { ...current.session.useCases, ...(patch.useCases ?? {}) }, channels: { ...current.session.channels, ...(patch.channels ?? {}) } } } : current);
  }

  function updateForm<K extends keyof SetupFormState>(key: K, value: SetupFormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function buildEnvPayload(session: AgenticSetupSession): Record<string, string> {
    const env: Record<string, string> = {
      ACTIVE_LLM_PROVIDER: session.selectedChatProvider,
      EMBEDDING_PROVIDER: session.selectedEmbeddingProvider,
      CRM_PROVIDER: session.crmMode,
      BIZBOT_WORKSPACE_PATH: form.workspacePath,
      GOOGLE_BUSINESS_ACCOUNT_NAME: form.googleBusinessAccountName,
      GOOGLE_BUSINESS_LOCATION_NAME: form.googleBusinessLocationName,
      GOOGLE_BUSINESS_INFO_LOCATION_NAME: form.googleBusinessInfoLocationName,
      FACEBOOK_PAGE_ID: form.facebookPageId,
      META_PAGE_ID: form.metaPageId,
      INSTAGRAM_BUSINESS_ACCOUNT_ID: form.instagramBusinessAccountId,
      META_INSTAGRAM_ACCOUNT_ID: form.metaInstagramAccountId,
      TWITTER_USER_ID: form.twitterUserId,
      HUBSPOT_PORTAL_ID: form.hubspotPortalId,
    };

    if (form.googleApiKey.trim()) env.GOOGLE_AI_API_KEY = form.googleApiKey.trim();
    if (form.openAiApiKey.trim()) env.OPENAI_API_KEY = form.openAiApiKey.trim();
    if (form.anthropicApiKey.trim()) env.ANTHROPIC_API_KEY = form.anthropicApiKey.trim();
    if (form.miniMaxApiKey.trim()) env.MINIMAX_API_KEY = form.miniMaxApiKey.trim();
    if (form.googleBusinessClientId.trim()) env.GOOGLE_BUSINESS_CLIENT_ID = form.googleBusinessClientId.trim();
    if (form.googleBusinessClientSecret.trim()) env.GOOGLE_BUSINESS_CLIENT_SECRET = form.googleBusinessClientSecret.trim();
    if (form.googleBusinessRefreshToken.trim()) env.GOOGLE_BUSINESS_REFRESH_TOKEN = form.googleBusinessRefreshToken.trim();
    if (form.metaAccessToken.trim()) env.META_ACCESS_TOKEN = form.metaAccessToken.trim();
    if (form.metaWebhookVerifyToken.trim()) env.META_WEBHOOK_VERIFY_TOKEN = form.metaWebhookVerifyToken.trim();
    if (form.twitterAppKey.trim()) env.TWITTER_APP_KEY = form.twitterAppKey.trim();
    if (form.twitterAppSecret.trim()) env.TWITTER_APP_SECRET = form.twitterAppSecret.trim();
    if (form.twitterAccessToken.trim()) env.TWITTER_ACCESS_TOKEN = form.twitterAccessToken.trim();
    if (form.twitterAccessTokenSecret.trim()) env.TWITTER_ACCESS_TOKEN_SECRET = form.twitterAccessTokenSecret.trim();
    if (form.hubspotPrivateAppToken.trim()) env.HUBSPOT_PRIVATE_APP_TOKEN = form.hubspotPrivateAppToken.trim();

    return env;
  }

  async function persist(nextSession: AgenticSetupSession, action?: "pause" | "resume" | "complete" | "reset"): Promise<AgenticSetupResponse | null> {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/agentic-setup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: nextSession,
          env: buildEnvPayload(nextSession),
          action,
        }),
      });
      const data = await response.json() as AgenticSetupResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update setup state.");
      }
      setPayload(data);
      setForm((current) => ({
        ...current,
        googleApiKey: "",
        openAiApiKey: "",
        anthropicApiKey: "",
        miniMaxApiKey: "",
        googleBusinessClientId: "",
        googleBusinessClientSecret: "",
        googleBusinessRefreshToken: "",
        metaAccessToken: "",
        metaWebhookVerifyToken: "",
        twitterAppKey: "",
        twitterAppSecret: "",
        twitterAccessToken: "",
        twitterAccessTokenSecret: "",
        hubspotPrivateAppToken: "",
      }));
      emitSetupChanged();
      return data;
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : String(persistError));
      return null;
    } finally {
      setSaving(false);
    }
  }

  function closeDrawer(): void {
    window.location.assign(closeHref);
  }

  if (!open) {
    return null;
  }

  const session = payload?.session;
  const state = payload?.state;
  const stored = payload?.stored;
  const toneStyles = state ? getToneStyles(state.tone) : getToneStyles("missing");
  const visibleSteps = session && shouldIncludePlatformsStep(session)
    ? STEP_ORDER
    : STEP_ORDER.filter((entry) => entry !== "platforms");
  const currentStepNumber = session ? visibleSteps.indexOf(session.step) + 1 : 0;
  const currentStepTotal = visibleSteps.length;
  const isFirstRunSetup = state?.isFirstRun ?? false;
  const isQuickStartFlow = session?.skipped.includes(QUICK_START_GOOGLE_FLAG) ?? false;
  const isAdvancedProviderChoice = session?.skipped.includes(ADVANCED_PROVIDER_FLAG) ?? false;
  const isQuickStartSuccessStep = Boolean(
    session
    && session.step === "llm"
    && isQuickStartFlow
    && stored?.secretPresence.GOOGLE_AI_API_KEY,
  );

  async function activateCoreAgent(): Promise<void> {
    if (!session || !form.googleApiKey.trim()) {
      setError("Add a Google AI API key to activate the core agent.");
      return;
    }

    const nextSession: AgenticSetupSession = {
      ...session,
      step: "llm",
      status: "in_progress",
      selectedChatProvider: "google",
      selectedEmbeddingProvider: "google",
      useCases: {
        ...session.useCases,
        knowledge: false,
      },
      confirmedLocalChatProvider: false,
      confirmedLocalEmbeddingProvider: false,
      skipped: [...session.skipped.filter((entry) => entry !== ADVANCED_PROVIDER_FLAG), QUICK_START_GOOGLE_FLAG],
    };

    await persist(nextSession, "resume");
  }

  async function chooseAnotherProvider(): Promise<void> {
    if (!session) {
      return;
    }

    const nextSession: AgenticSetupSession = {
      ...session,
      step: "llm",
      status: "in_progress",
      skipped: [...session.skipped.filter((entry) => entry !== QUICK_START_GOOGLE_FLAG), ADVANCED_PROVIDER_FLAG],
    };

    await persist(nextSession, "resume");
  }

  async function enableKnowledgeRetrievalNow(): Promise<void> {
    if (!session) {
      return;
    }

    const nextSession: AgenticSetupSession = {
      ...session,
      step: "platforms",
      status: "in_progress",
      selectedEmbeddingProvider: "google",
      useCases: {
        ...session.useCases,
        knowledge: true,
      },
    };

    await persist(nextSession, "resume");
  }

  async function skipKnowledgeForNow(): Promise<void> {
    if (!session) {
      return;
    }

    const nextSession: AgenticSetupSession = {
      ...session,
      step: "platforms",
      status: "in_progress",
      useCases: {
        ...session.useCases,
        knowledge: false,
      },
    };

    await persist(nextSession, "resume");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(6, 6, 10, 0.74)" }}>
      <div className="w-full max-w-2xl h-full border-l overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="sticky top-0 z-10 border-b px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>agentic setup</div>
              <div className="text-sm" style={{ color: "var(--text-dim)" }}>
                Guided, resumable setup for chat, optional integrations, and the env values needed for the features you actually plan to use now.
              </div>
              <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                Stored credentials and completed setup are tracked separately so detected config does not read as finished setup.
              </div>
              {state ? (
                <div className="inline-flex items-center gap-2 border px-3 py-1 text-xs uppercase tracking-[0.18em]" style={{ borderColor: toneStyles.border, color: toneStyles.text, background: toneStyles.bg }}>
                  <span>{state.label}</span>
                  <span>{state.completionPercent}%</span>
                </div>
              ) : null}
            </div>
            <Link href={closeHref} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
              close
            </Link>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {loading ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>Loading setup state...</div> : null}
          {error ? <div className="border px-4 py-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "rgba(217,79,79,0.08)" }}>{error}</div> : null}
          {!loading && session && state ? (
            <>
              <section className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>guide state</div>
                    <div className="text-sm mt-1" style={{ color: "var(--text-primary)" }}>
                      Step {currentStepNumber} of {currentStepTotal}: {STEP_TITLES[session.step]}
                    </div>
                  </div>
                  <div className="text-xs uppercase tracking-[0.18em]" style={{ color: toneStyles.text }}>
                    {session.status.replaceAll("_", " ")}
                  </div>
                </div>
                <div className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                  Pause at any step, ask setup questions in the main chat, then reopen this guide to resume without losing progress or confirmed choices.
                </div>
              </section>

              {session.step === "welcome" ? (
                <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  {isFirstRunSetup ? (
                    <>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>step 1</div>
                        <div className="text-2xl mt-2" style={{ color: "var(--text-primary)" }}>Get BizBot running in two minutes.</div>
                        <div className="text-sm mt-3" style={{ color: "var(--text-dim)" }}>
                          Start with one Google AI API key. This activates core chat immediately and keeps the rest of setup optional.
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Google AI API key</label>
                        <input
                          type="password"
                          value={form.googleApiKey}
                          onChange={(event) => updateForm("googleApiKey", event.target.value)}
                          placeholder="Paste your Google AI API key"
                          className="w-full bg-transparent border px-3 py-2 text-sm"
                          style={{ borderColor: "var(--border)" }}
                        />
                        <div className="text-xs mt-2 leading-6" style={{ color: "var(--text-dim)" }}>
                          This will power core chat now. You can turn on memory and retrieval in the next step using the same key.
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                          onClick={() => void activateCoreAgent()}
                          disabled={saving || !form.googleApiKey.trim()}
                        >
                          {saving ? "saving" : "use google quick start"}
                        </button>
                        <button
                          className="text-xs uppercase tracking-[0.18em]"
                          style={{ color: "var(--text-dim)" }}
                          onClick={() => void chooseAnotherProvider()}
                          disabled={saving}
                        >
                          choose another provider
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>step 1</div>
                        <div className="text-lg mt-2" style={{ color: "var(--text-primary)" }}>{STEP_TITLES.welcome}</div>
                        <div className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>
                          Start with scope. Chat setup is always required. Everything else can be bypassed unless it supports your use case right now.
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Workspace path</label>
                        <input value={form.workspacePath} onChange={(event) => updateForm("workspacePath", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                          This is where BizBot keeps the local working area it uses for knowledge and related app workflows.
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {[
                          { key: "knowledge", label: "Knowledge memory and retrieval", detail: "Use embeddings for richer long-term context, memory, and retrieval." },
                          { key: "social", label: "Social publishing", detail: "Set up Meta and or Twitter credentials for posting and inbox flows." },
                          { key: "localBusiness", label: "Google Business", detail: "Enable reviews, local posts, and hours workflows." },
                          { key: "crm", label: "CRM handoff", detail: "Track leads internally or sync to HubSpot." },
                        ].map((item) => (
                          <label key={item.key} className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                            <input
                              type="checkbox"
                              checked={session.useCases[item.key as keyof AgenticSetupSession["useCases"]]}
                              onChange={(event) => updateSession({ useCases: { [item.key]: event.target.checked } as Partial<AgenticSetupSession["useCases"]> })}
                            />
                            <div>
                              <div className="text-sm" style={{ color: "var(--text-primary)" }}>{item.label}</div>
                              <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{item.detail}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  {!isFirstRunSetup && session.useCases.social ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                        <input type="checkbox" checked={session.channels.meta} onChange={(event) => updateSession({ channels: { meta: event.target.checked } })} />
                        <div>
                          <div className="text-sm" style={{ color: "var(--text-primary)" }}>Meta channel</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Facebook page, Instagram business account, access token, and webhook verify token.</div>
                        </div>
                      </label>
                      <label className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                        <input type="checkbox" checked={session.channels.twitter} onChange={(event) => updateSession({ channels: { twitter: event.target.checked } })} />
                        <div>
                          <div className="text-sm" style={{ color: "var(--text-primary)" }}>Twitter channel</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>App credentials, user ID, and user access tokens.</div>
                        </div>
                      </label>
                    </div>
                  ) : null}
                  {!isFirstRunSetup && session.useCases.crm ? (
                    <div>
                      <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>CRM mode</label>
                      <select className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} value={session.crmMode} onChange={(event) => updateSession({ crmMode: event.target.value as AgenticSetupCrmMode })}>
                        <option value="internal">internal</option>
                        <option value="hubspot">hubspot</option>
                      </select>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {session.step === "llm" && isQuickStartSuccessStep ? (
                <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>step 2</div>
                    <div className="text-2xl mt-2" style={{ color: "var(--text-primary)" }}>Core agent is live.</div>
                    <div className="text-sm mt-3" style={{ color: "var(--text-dim)" }}>
                      Chat is active with Google. You can enable memory and retrieval now with the same key, or skip and add it later.
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="border p-4 space-y-2" style={{ borderColor: "var(--success)", background: "rgba(58,140,92,0.08)" }}>
                      <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--success)" }}>chat status</div>
                      <div className="text-sm" style={{ color: "var(--text-primary)" }}>Google chat is configured and ready.</div>
                    </div>
                    <div className="border p-4 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>recommended next</div>
                      <div className="text-sm" style={{ color: "var(--text-primary)" }}>Enable memory and retrieval with the same key.</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                      style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                      onClick={() => void enableKnowledgeRetrievalNow()}
                      disabled={saving}
                    >
                      {saving ? "saving" : "enable memory and retrieval now"}
                    </button>
                    <button
                      className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                      style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
                      onClick={() => void skipKnowledgeForNow()}
                      disabled={saving}
                    >
                      skip for now
                    </button>
                  </div>
                </section>
              ) : null}

              {session.step === "llm" && !isQuickStartSuccessStep ? (
                <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>step 2</div>
                    <div className="text-lg mt-2" style={{ color: "var(--text-primary)" }}>{STEP_TITLES.llm}</div>
                    <div className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>
                      Pick the chat provider first. If you want knowledge or retrieval, choose the embedding provider separately. You can keep local options if you do not want to add hosted credentials.
                    </div>
                    {isFirstRunSetup && !isAdvancedProviderChoice ? (
                      <div className="text-xs leading-6 mt-2" style={{ color: "var(--accent)" }}>
                        Recommended: keep Google selected for both. One Google AI API key will activate chat and embeddings together.
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Chat provider</label>
                        <select className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} value={session.selectedChatProvider} onChange={(event) => updateSession({ selectedChatProvider: event.target.value as AgenticSetupChatProvider })}>
                          <option value="google">google</option>
                          <option value="openai">openai</option>
                          <option value="anthropic">anthropic</option>
                          <option value="minimax">minimax</option>
                          <option value="ollama">ollama</option>
                        </select>
                      </div>
                      {session.selectedChatProvider === "ollama" ? (
                        <label className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                          <input type="checkbox" checked={session.confirmedLocalChatProvider} onChange={(event) => updateSession({ confirmedLocalChatProvider: event.target.checked })} />
                          <div>
                            <div className="text-sm" style={{ color: "var(--text-primary)" }}>Confirm local Ollama path</div>
                            <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Use this if you intend to run the chat model locally instead of providing a hosted API key.</div>
                          </div>
                        </label>
                      ) : (
                        <div>
                          <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Chat provider credential</label>
                          <input
                            type="password"
                            value={getProviderSecretKey(session.selectedChatProvider) ? form[getProviderSecretKey(session.selectedChatProvider) as keyof SetupFormState] as string : ""}
                            onChange={(event) => {
                              const key = getProviderSecretKey(session.selectedChatProvider);
                              if (key) {
                                updateForm(key, event.target.value);
                              }
                            }}
                            placeholder="Paste the API key here"
                            className="w-full bg-transparent border px-3 py-2 text-sm"
                            style={{ borderColor: "var(--border)" }}
                          />
                          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                            {getProviderSecretKey(session.selectedChatProvider) && stored?.secretPresence[
                              session.selectedChatProvider === "google"
                                ? "GOOGLE_AI_API_KEY"
                                : session.selectedChatProvider === "openai"
                                  ? "OPENAI_API_KEY"
                                  : session.selectedChatProvider === "anthropic"
                                    ? "ANTHROPIC_API_KEY"
                                    : "MINIMAX_API_KEY"
                            ] ? "A credential is already stored. Leave blank to keep it." : "No credential stored yet."}
                          </div>
                            {session.selectedChatProvider === "google" && session.selectedEmbeddingProvider === "google" ? (
                              <div className="text-xs leading-6 mt-2" style={{ color: "var(--text-dim)" }}>
                                This single key will be saved and used for both chat and embeddings when you continue.
                              </div>
                            ) : null}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Embedding provider</label>
                        <select className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} value={session.selectedEmbeddingProvider} onChange={(event) => updateSession({ selectedEmbeddingProvider: event.target.value as AgenticSetupEmbeddingProvider })} disabled={!session.useCases.knowledge}>
                          <option value="google">google</option>
                          <option value="openai">openai</option>
                          <option value="ollama">ollama</option>
                        </select>
                      </div>
                      {!session.useCases.knowledge ? (
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          Embeddings are bypassed because knowledge + retrieval is not selected.
                        </div>
                      ) : session.selectedEmbeddingProvider === "ollama" ? (
                        <label className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                          <input type="checkbox" checked={session.confirmedLocalEmbeddingProvider} onChange={(event) => updateSession({ confirmedLocalEmbeddingProvider: event.target.checked })} />
                          <div>
                            <div className="text-sm" style={{ color: "var(--text-primary)" }}>Confirm local embedding path</div>
                            <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Use this if your embedding model will come from a local Ollama endpoint.</div>
                          </div>
                        </label>
                      ) : (
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          Reuse the matching provider credential above or add it now on the settings page later.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {session.step === "platforms" ? (
                <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>step 3</div>
                    <div className="text-lg mt-2" style={{ color: "var(--text-primary)" }}>
                      {isQuickStartFlow ? "Optional add-ons" : STEP_TITLES.platforms}
                    </div>
                    <div className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>
                      {isQuickStartFlow
                        ? "Your core agent is active. Add only the extra capabilities you want right now."
                        : "Fill only the integrations you selected. Anything not relevant to your workflow can stay bypassed and revisited later."}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="border p-3 flex items-start gap-3" style={{ borderColor: session.useCases.social ? "var(--accent)" : "var(--border)" }}>
                      <input type="checkbox" checked={session.useCases.social} onChange={(event) => updateSession({ useCases: { social: event.target.checked } })} />
                      <div>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>Connect social channels</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Enable Meta or Twitter posting and inbox workflows.</div>
                      </div>
                    </label>
                    <label className="border p-3 flex items-start gap-3" style={{ borderColor: session.useCases.localBusiness ? "var(--accent)" : "var(--border)" }}>
                      <input type="checkbox" checked={session.useCases.localBusiness} onChange={(event) => updateSession({ useCases: { localBusiness: event.target.checked } })} />
                      <div>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>Connect Google Business</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Manage reviews, posts, and location workflows.</div>
                      </div>
                    </label>
                    <label className="border p-3 flex items-start gap-3" style={{ borderColor: session.useCases.crm ? "var(--accent)" : "var(--border)" }}>
                      <input type="checkbox" checked={session.useCases.crm} onChange={(event) => updateSession({ useCases: { crm: event.target.checked } })} />
                      <div>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>Connect CRM</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Track leads internally or sync them to HubSpot.</div>
                      </div>
                    </label>
                    <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
                      <div className="text-sm" style={{ color: "var(--text-primary)" }}>Builder workspace</div>
                      <div className="text-xs" style={{ color: "var(--text-dim)" }}>Set the local workspace path BizBot uses for builder and knowledge workflows.</div>
                      <input value={form.workspacePath} onChange={(event) => updateForm("workspacePath", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    </div>
                  </div>

                  {session.useCases.social ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                        <input type="checkbox" checked={session.channels.meta} onChange={(event) => updateSession({ channels: { meta: event.target.checked } })} />
                        <div>
                          <div className="text-sm" style={{ color: "var(--text-primary)" }}>Meta channel</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>Facebook page, Instagram business account, access token, and webhook verify token.</div>
                        </div>
                      </label>
                      <label className="border p-3 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
                        <input type="checkbox" checked={session.channels.twitter} onChange={(event) => updateSession({ channels: { twitter: event.target.checked } })} />
                        <div>
                          <div className="text-sm" style={{ color: "var(--text-primary)" }}>Twitter channel</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>App credentials, user ID, and user access tokens.</div>
                        </div>
                      </label>
                    </div>
                  ) : null}

                  {session.channels.meta ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input value={form.facebookPageId} onChange={(event) => updateForm("facebookPageId", event.target.value)} placeholder="FACEBOOK_PAGE_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input value={form.metaPageId} onChange={(event) => updateForm("metaPageId", event.target.value)} placeholder="META_PAGE_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input value={form.instagramBusinessAccountId} onChange={(event) => updateForm("instagramBusinessAccountId", event.target.value)} placeholder="INSTAGRAM_BUSINESS_ACCOUNT_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input value={form.metaInstagramAccountId} onChange={(event) => updateForm("metaInstagramAccountId", event.target.value)} placeholder="META_INSTAGRAM_ACCOUNT_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.metaAccessToken} onChange={(event) => updateForm("metaAccessToken", event.target.value)} placeholder="META_ACCESS_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.metaWebhookVerifyToken} onChange={(event) => updateForm("metaWebhookVerifyToken", event.target.value)} placeholder="META_WEBHOOK_VERIFY_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    </div>
                  ) : null}

                  {session.channels.twitter ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input value={form.twitterUserId} onChange={(event) => updateForm("twitterUserId", event.target.value)} placeholder="TWITTER_USER_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.twitterAppKey} onChange={(event) => updateForm("twitterAppKey", event.target.value)} placeholder="TWITTER_APP_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.twitterAppSecret} onChange={(event) => updateForm("twitterAppSecret", event.target.value)} placeholder="TWITTER_APP_SECRET" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.twitterAccessToken} onChange={(event) => updateForm("twitterAccessToken", event.target.value)} placeholder="TWITTER_ACCESS_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.twitterAccessTokenSecret} onChange={(event) => updateForm("twitterAccessTokenSecret", event.target.value)} placeholder="TWITTER_ACCESS_TOKEN_SECRET" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    </div>
                  ) : null}

                  {session.useCases.localBusiness ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input type="password" value={form.googleBusinessClientId} onChange={(event) => updateForm("googleBusinessClientId", event.target.value)} placeholder="GOOGLE_BUSINESS_CLIENT_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.googleBusinessClientSecret} onChange={(event) => updateForm("googleBusinessClientSecret", event.target.value)} placeholder="GOOGLE_BUSINESS_CLIENT_SECRET" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.googleBusinessRefreshToken} onChange={(event) => updateForm("googleBusinessRefreshToken", event.target.value)} placeholder="GOOGLE_BUSINESS_REFRESH_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input value={form.googleBusinessAccountName} onChange={(event) => updateForm("googleBusinessAccountName", event.target.value)} placeholder="GOOGLE_BUSINESS_ACCOUNT_NAME" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input value={form.googleBusinessLocationName} onChange={(event) => updateForm("googleBusinessLocationName", event.target.value)} placeholder="GOOGLE_BUSINESS_LOCATION_NAME" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input value={form.googleBusinessInfoLocationName} onChange={(event) => updateForm("googleBusinessInfoLocationName", event.target.value)} placeholder="GOOGLE_BUSINESS_INFO_LOCATION_NAME" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    </div>
                  ) : null}

                  {session.useCases.crm && session.crmMode === "hubspot" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <input value={form.hubspotPortalId} onChange={(event) => updateForm("hubspotPortalId", event.target.value)} placeholder="HUBSPOT_PORTAL_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                      <input type="password" value={form.hubspotPrivateAppToken} onChange={(event) => updateForm("hubspotPrivateAppToken", event.target.value)} placeholder="HUBSPOT_PRIVATE_APP_TOKEN" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    </div>
                  ) : null}
                </section>
              ) : null}

              {session.step === "review" ? (
                <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>step 4</div>
                    <div className="text-lg mt-2" style={{ color: "var(--text-primary)" }}>{STEP_TITLES.review}</div>
                    <div className="text-sm mt-2" style={{ color: "var(--text-primary)" }}>
                      Review the required checks. Green means the selected path is configured and this guide is complete. Amber means configuration is detected or in progress, but guide confirmation is still missing.
                    </div>
                  </div>
                  <div className="space-y-2">
                    {state.checks.map((check) => (
                      <div key={check.id} className="border px-3 py-3 flex items-start justify-between gap-4" style={{ borderColor: check.ready ? "var(--success)" : check.required ? "var(--warning)" : "var(--border)" }}>
                        <div>
                          <div className="text-sm" style={{ color: "var(--text-primary)" }}>{check.label}</div>
                          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{check.detail}</div>
                        </div>
                        <div className="text-xs uppercase tracking-[0.16em]" style={{ color: check.ready ? "var(--success)" : check.required ? "var(--warning)" : "var(--text-dim)" }}>
                          {check.ready ? "ready" : check.required ? "required" : "skipped"}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>setup handoff</div>
                <div className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                  If you want clarification, pause here, ask the main chat a setup question, then reopen this guide to resume from the same step.
                </div>
              </section>

              <div className="sticky bottom-0 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                <button
                  className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                  onClick={() => {
                    const nextSession = { ...session, step: getPreviousStep(session.step, session) };
                    void persist(nextSession, "resume");
                  }}
                  disabled={saving || session.step === "welcome"}
                >
                  back
                </button>
                <button
                  className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                  style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
                  onClick={() => {
                    void persist(session, "pause").then(() => closeDrawer());
                  }}
                  disabled={saving}
                >
                  pause and ask setup question
                </button>
                {session.step !== "review" ? (
                  <button
                    className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                    onClick={() => {
                      const nextSession = { ...session, step: getNextStep(session.step, session) };
                      void persist(nextSession, "resume");
                    }}
                    disabled={saving || (session.step === "welcome" && isFirstRunSetup)}
                  >
                    {saving ? "saving" : "next"}
                  </button>
                ) : (
                  <button
                    className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                    style={{ borderColor: state.tone === "ready" ? "var(--success)" : "var(--accent)", color: state.tone === "ready" ? "var(--success)" : "var(--accent)" }}
                    onClick={() => {
                      void persist(session, "complete").then((result) => {
                        if (result?.state.tone === "ready") {
                          closeDrawer();
                        }
                      });
                    }}
                    disabled={saving}
                  >
                    {saving ? "saving" : state.tone === "ready" ? "complete guide" : "save progress"}
                  </button>
                )}
                <button
                  className="px-4 py-2 border text-sm uppercase tracking-[0.18em]"
                  style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
                  onClick={() => {
                    void persist({
                      version: 1,
                      status: "not_started",
                      step: "welcome",
                      selectedChatProvider: "google",
                      selectedEmbeddingProvider: "google",
                      confirmedLocalChatProvider: false,
                      confirmedLocalEmbeddingProvider: false,
                      useCases: { knowledge: false, social: false, localBusiness: false, crm: false },
                      channels: { meta: false, twitter: false },
                      crmMode: "internal",
                      skipped: [],
                      updatedAt: null,
                    }, "reset");
                  }}
                  disabled={saving}
                >
                  redo guide
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}