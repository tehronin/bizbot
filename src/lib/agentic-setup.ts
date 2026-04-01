import { db } from "@/lib/db";
import { readEnv, writeEnv } from "@/lib/env";
import { saveEncryptedSecrets } from "@/lib/runtime-secrets";

export type AgenticSetupChatProvider = "ollama" | "google" | "openai" | "anthropic" | "minimax";
export type AgenticSetupEmbeddingProvider = "google" | "openai" | "ollama";
export type AgenticSetupCrmMode = "internal" | "hubspot";
export type AgenticSetupStep = "welcome" | "llm" | "platforms" | "review";
export type AgenticSetupSessionStatus = "not_started" | "in_progress" | "paused" | "completed";

const SESSION_KEY = "agentic_setup_session";

export interface AgenticSetupSession {
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

export interface AgenticSetupCheck {
  id: string;
  label: string;
  ready: boolean;
  required: boolean;
  detail: string;
}

export interface AgenticSetupState {
  tone: "missing" | "partial" | "ready";
  label: string;
  detail: string;
  nextRequiredLabel: string | null;
  isFirstRun: boolean;
  completionPercent: number;
  requiredTotal: number;
  requiredReady: number;
  checks: AgenticSetupCheck[];
}

export interface AgenticSetupStoredValues {
  publicEnv: Record<string, string>;
  secretPresence: Record<string, boolean>;
}

export interface AgenticSetupPayload {
  session: AgenticSetupSession;
  state: AgenticSetupState;
  stored: AgenticSetupStoredValues;
}

export const AGENTIC_SETUP_PUBLIC_ENV_KEYS = [
  "ACTIVE_LLM_PROVIDER",
  "GOOGLE_MODEL",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
  "MINIMAX_MODEL",
  "OLLAMA_MODEL",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "BIZBOT_WORKSPACE_PATH",
  "GOOGLE_BUSINESS_ACCOUNT_NAME",
  "GOOGLE_BUSINESS_LOCATION_NAME",
  "GOOGLE_BUSINESS_INFO_LOCATION_NAME",
  "TWITTER_USER_ID",
  "FACEBOOK_PAGE_ID",
  "META_PAGE_ID",
  "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "META_INSTAGRAM_ACCOUNT_ID",
  "CRM_PROVIDER",
  "HUBSPOT_PORTAL_ID",
] as const;

export const AGENTIC_SETUP_SECRET_ENV_KEYS = [
  "GOOGLE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MINIMAX_API_KEY",
  "GOOGLE_BUSINESS_CLIENT_ID",
  "GOOGLE_BUSINESS_CLIENT_SECRET",
  "GOOGLE_BUSINESS_REFRESH_TOKEN",
  "META_ACCESS_TOKEN",
  "META_WEBHOOK_VERIFY_TOKEN",
  "TWITTER_APP_KEY",
  "TWITTER_APP_SECRET",
  "TWITTER_CLIENT_ID",
  "TWITTER_CLIENT_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_TOKEN_SECRET",
  "HUBSPOT_PRIVATE_APP_TOKEN",
] as const;

const DEFAULT_SESSION: AgenticSetupSession = {
  version: 1,
  status: "not_started",
  step: "welcome",
  selectedChatProvider: "google",
  selectedEmbeddingProvider: "google",
  confirmedLocalChatProvider: false,
  confirmedLocalEmbeddingProvider: false,
  useCases: {
    knowledge: false,
    social: false,
    localBusiness: false,
    crm: false,
  },
  channels: {
    meta: false,
    twitter: false,
  },
  crmMode: "internal",
  skipped: [],
  updatedAt: null,
};

function isNonEmpty(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function getMergedEnv(): Record<string, string> {
  const fileEnv = readEnv();
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { ...processEnv, ...fileEnv };
}

function mergeSession(
  current: AgenticSetupSession,
  patch?: Partial<AgenticSetupSession>,
): AgenticSetupSession {
  if (!patch) {
    return current;
  }

  return {
    ...current,
    ...patch,
    useCases: {
      ...current.useCases,
      ...(patch.useCases ?? {}),
    },
    channels: {
      ...current.channels,
      ...(patch.channels ?? {}),
    },
    skipped: patch.skipped ? Array.from(new Set(patch.skipped)) : current.skipped,
  };
}

async function getStoredSession(): Promise<AgenticSetupSession> {
  const record = await db.setting.findUnique({ where: { key: SESSION_KEY } });
  if (!record?.value) {
    return { ...DEFAULT_SESSION };
  }

  try {
    const parsed = JSON.parse(record.value) as Partial<AgenticSetupSession>;
    return mergeSession(DEFAULT_SESSION, parsed);
  } catch {
    return { ...DEFAULT_SESSION };
  }
}

async function saveSession(session: AgenticSetupSession): Promise<void> {
  await db.setting.upsert({
    where: { key: SESSION_KEY },
    update: { value: JSON.stringify(session) },
    create: { key: SESSION_KEY, value: JSON.stringify(session) },
  });
}

function getStoredValues(env: Record<string, string>): AgenticSetupStoredValues {
  return {
    publicEnv: Object.fromEntries(
      AGENTIC_SETUP_PUBLIC_ENV_KEYS.map((key) => [key, env[key] ?? ""]),
    ),
    secretPresence: Object.fromEntries(
      AGENTIC_SETUP_SECRET_ENV_KEYS.map((key) => [key, isNonEmpty(env[key])]),
    ),
  };
}

function hasChatProviderConfigured(session: AgenticSetupSession, env: Record<string, string>): boolean {
  switch (session.selectedChatProvider) {
    case "google":
      return isNonEmpty(env.GOOGLE_AI_API_KEY);
    case "openai":
      return isNonEmpty(env.OPENAI_API_KEY);
    case "anthropic":
      return isNonEmpty(env.ANTHROPIC_API_KEY);
    case "minimax":
      return isNonEmpty(env.MINIMAX_API_KEY);
    case "ollama":
      return session.confirmedLocalChatProvider;
    default:
      return false;
  }
}

function hasEmbeddingProviderConfigured(session: AgenticSetupSession, env: Record<string, string>): boolean {
  switch (session.selectedEmbeddingProvider) {
    case "google":
      return isNonEmpty(env.GOOGLE_AI_API_KEY);
    case "openai":
      return isNonEmpty(env.OPENAI_API_KEY);
    case "ollama":
      return session.confirmedLocalEmbeddingProvider;
    default:
      return false;
  }
}

function hasMetaConfigured(env: Record<string, string>): boolean {
  return (
    isNonEmpty(env.META_ACCESS_TOKEN)
    && isNonEmpty(env.META_WEBHOOK_VERIFY_TOKEN)
    && (isNonEmpty(env.META_PAGE_ID) || isNonEmpty(env.FACEBOOK_PAGE_ID))
    && (isNonEmpty(env.META_INSTAGRAM_ACCOUNT_ID) || isNonEmpty(env.INSTAGRAM_BUSINESS_ACCOUNT_ID))
  );
}

function hasTwitterConfigured(env: Record<string, string>): boolean {
  return (
    isNonEmpty(env.TWITTER_USER_ID)
    && isNonEmpty(env.TWITTER_ACCESS_TOKEN)
    && isNonEmpty(env.TWITTER_ACCESS_TOKEN_SECRET)
    && (isNonEmpty(env.TWITTER_APP_KEY) || isNonEmpty(env.TWITTER_CLIENT_ID))
    && (isNonEmpty(env.TWITTER_APP_SECRET) || isNonEmpty(env.TWITTER_CLIENT_SECRET))
  );
}

function hasLocalBusinessConfigured(env: Record<string, string>): boolean {
  return (
    isNonEmpty(env.GOOGLE_BUSINESS_CLIENT_ID)
    && isNonEmpty(env.GOOGLE_BUSINESS_CLIENT_SECRET)
    && isNonEmpty(env.GOOGLE_BUSINESS_REFRESH_TOKEN)
    && isNonEmpty(env.GOOGLE_BUSINESS_ACCOUNT_NAME)
    && isNonEmpty(env.GOOGLE_BUSINESS_LOCATION_NAME)
  );
}

function hasCrmConfigured(session: AgenticSetupSession, env: Record<string, string>): boolean {
  if (session.crmMode === "internal") {
    return true;
  }

  return isNonEmpty(env.HUBSPOT_PRIVATE_APP_TOKEN);
}

export function computeAgenticSetupState(
  session: AgenticSetupSession,
  env: Record<string, string>,
): AgenticSetupState {
  const checks: AgenticSetupCheck[] = [
    {
      id: "chat",
      label: "Chat provider",
      ready: hasChatProviderConfigured(session, env),
      required: true,
      detail:
        session.selectedChatProvider === "ollama"
          ? "Requires explicit confirmation that the local Ollama endpoint is your setup path."
          : `Requires ${session.selectedChatProvider} credentials.`,
    },
    {
      id: "knowledge",
      label: "Embeddings",
      ready: !session.useCases.knowledge || hasEmbeddingProviderConfigured(session, env),
      required: session.useCases.knowledge,
      detail: session.useCases.knowledge
        ? "Needed only if you want knowledge or retrieval features during setup."
        : "Optional and currently bypassed.",
    },
    {
      id: "meta",
      label: "Meta channel",
      ready: !session.channels.meta || hasMetaConfigured(env),
      required: session.channels.meta,
      detail: session.channels.meta
        ? "Needs page IDs, access token, and webhook verification token."
        : "Optional and currently bypassed.",
    },
    {
      id: "twitter",
      label: "Twitter channel",
      ready: !session.channels.twitter || hasTwitterConfigured(env),
      required: session.channels.twitter,
      detail: session.channels.twitter
        ? "Needs app credentials, user ID, and access tokens."
        : "Optional and currently bypassed.",
    },
    {
      id: "local_business",
      label: "Google Business",
      ready: !session.useCases.localBusiness || hasLocalBusinessConfigured(env),
      required: session.useCases.localBusiness,
      detail: session.useCases.localBusiness
        ? "Needs OAuth client values, refresh token, and resource names."
        : "Optional and currently bypassed.",
    },
    {
      id: "crm",
      label: "CRM",
      ready: !session.useCases.crm || hasCrmConfigured(session, env),
      required: session.useCases.crm,
      detail: session.useCases.crm
        ? session.crmMode === "hubspot"
          ? "Needs a HubSpot private app token."
          : "Internal CRM mode requires no external token."
        : "Optional and currently bypassed.",
    },
  ];

  const requiredChecks = checks.filter((check) => check.required);
  const requiredReady = requiredChecks.filter((check) => check.ready).length;
  const requiredTotal = requiredChecks.length;
  const readinessPercent = requiredTotal === 0 ? 100 : Math.round((requiredReady / requiredTotal) * 100);
  const hasStoredPublicSetup = AGENTIC_SETUP_PUBLIC_ENV_KEYS.some((key) => isNonEmpty(env[key]));
  const hasStoredSecrets = AGENTIC_SETUP_SECRET_ENV_KEYS.some((key) => isNonEmpty(env[key]));
  const isFirstRun = !hasStoredPublicSetup && !hasStoredSecrets && session.status === "not_started";
  const hasGuideSelections =
    Object.values(session.useCases).some(Boolean)
    || Object.values(session.channels).some(Boolean)
    || session.crmMode !== "internal"
    || session.step !== "welcome";
  const hasAnyProgress =
    session.status !== "not_started"
    || checks.some((check) => check.ready)
    || Object.keys(env).some((key) => AGENTIC_SETUP_PUBLIC_ENV_KEYS.includes(key as never) && isNonEmpty(env[key]));
  const completionPercent =
    session.status === "completed"
      ? 100
      : session.status === "not_started" && !hasGuideSelections
        ? Math.min(readinessPercent, 50)
        : Math.min(95, Math.max(readinessPercent, hasGuideSelections ? 40 : 25));

  if (isFirstRun) {
    return {
      tone: "missing",
      label: "Start setup",
      detail: "Start the setup guide for your chat provider and any optional integrations you want now.",
      nextRequiredLabel: "Chat provider",
      isFirstRun: true,
      completionPercent: 0,
      requiredTotal,
      requiredReady,
      checks,
    };
  }

  if (requiredReady === requiredTotal && session.status === "completed") {
    return {
      tone: "ready",
      label: "Setup complete",
      detail: "The selected setup path is configured and the guide has been completed.",
      nextRequiredLabel: null,
      isFirstRun,
      completionPercent,
      requiredTotal,
      requiredReady,
      checks,
    };
  }

  if (hasAnyProgress) {
    const nextMissing = requiredChecks.find((check) => !check.ready);
    return {
      tone: "partial",
      label:
        session.status === "paused"
          ? "Resume guide"
          : nextMissing
            ? "Continue setup"
            : "Review guide",
      detail: nextMissing
        ? `${nextMissing.label} still needs setup.`
        : session.status === "not_started"
          ? "Core configuration is detected, but the guided setup has not been reviewed and confirmed yet."
          : "Configuration is in progress and still needs guide confirmation.",
      nextRequiredLabel: nextMissing?.label ?? null,
      isFirstRun,
      completionPercent,
      requiredTotal,
      requiredReady,
      checks,
    };
  }

  return {
    tone: "missing",
    label: "Start setup",
    detail: "Start the setup guide for your chat provider and any optional integrations you want now.",
    nextRequiredLabel: "Chat provider",
    isFirstRun,
    completionPercent: 0,
    requiredTotal,
    requiredReady,
    checks,
  };
}

function applyEnvUpdatesToProcessEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

export async function getAgenticSetupPayload(): Promise<AgenticSetupPayload> {
  const [session, env] = await Promise.all([
    getStoredSession(),
    Promise.resolve(getMergedEnv()),
  ]);

  return {
    session,
    state: computeAgenticSetupState(session, env),
    stored: getStoredValues(env),
  };
}

export async function updateAgenticSetup(input: {
  session?: Partial<AgenticSetupSession>;
  env?: Record<string, string>;
  action?: "pause" | "resume" | "complete" | "reset";
}): Promise<AgenticSetupPayload> {
  const currentSession = await getStoredSession();

  const nextSession =
    input.action === "reset"
      ? { ...DEFAULT_SESSION }
      : mergeSession(currentSession, input.session);

  const envUpdates = Object.fromEntries(
    Object.entries(input.env ?? {}).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  );

  if (Object.keys(envUpdates).length > 0) {
    writeEnv(envUpdates);
    applyEnvUpdatesToProcessEnv(envUpdates);
    await saveEncryptedSecrets(envUpdates);
  }

  const env = getMergedEnv();
  const state = computeAgenticSetupState(nextSession, env);

  if (input.action === "pause") {
    nextSession.status = "paused";
  } else if (input.action === "resume") {
    nextSession.status = state.tone === "ready" ? "completed" : "in_progress";
  } else if (input.action === "complete") {
    nextSession.status = state.tone === "ready" ? "completed" : "in_progress";
  } else if (state.tone === "ready") {
    nextSession.status = "completed";
  } else if (nextSession.status === "not_started") {
    nextSession.status = "in_progress";
  }

  nextSession.updatedAt = new Date().toISOString();

  await saveSession(nextSession);

  return {
    session: nextSession,
    state: computeAgenticSetupState(nextSession, env),
    stored: getStoredValues(env),
  };
}