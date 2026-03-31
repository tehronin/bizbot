import { db } from "@/lib/db";
import { getAgentWorkerStatus } from "@/lib/agent/heartbeat-queue";
import {
  getActiveProvider,
  getConfiguredProviders,
  getGenerationConfig,
  getModelForProvider,
  testProvider,
  type LLMProvider,
} from "@/lib/agent/kernel";
import {
  getAgentCapabilities,
  getAgentRuntimeConfig,
  getAutonomyDescription,
} from "@/lib/agent/runtime";
import { getKnowledgeStatus } from "@/lib/agent/knowledge-status";
import {
  getEmbeddingConfig,
  testEmbeddingProvider,
} from "@/lib/embeddings/embed";
import { getActiveCrmProvider, getCrmProviderStatuses } from "@/lib/crm";
import { getMcpClientStatus } from "@/lib/mcp/client";

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
  }>;
}

interface ProviderStatus {
  provider: LLMProvider;
  model: string;
  configured: boolean;
  available: boolean;
  active: boolean;
  reason: string;
}

const CHAT_MODEL_OPTIONS: Record<LLMProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4.1-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest"],
  ollama: ["gemma3", "gemma3:4b", "gemma3:12b", "llama3.2"],
  google: ["gemini-3-flash-preview", "gemini-2.5-flash"],
  minimax: ["abab6.5s-chat"],
};

const EMBEDDING_MODEL_OPTIONS = {
  google: ["gemini-embedding-001", "gemini-embedding-2-preview"],
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  ollama: ["mxbai-embed-large", "nomic-embed-text", "all-minilm"],
};

function getOllamaBaseUrl(): string {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  return baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
}

async function getOllamaModelOptions(): Promise<string[]> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`);
    if (!response.ok) {
      return CHAT_MODEL_OPTIONS.ollama;
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const dynamicModels = (data.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);

    return Array.from(new Set([...CHAT_MODEL_OPTIONS.ollama, ...dynamicModels])).sort();
  } catch {
    return CHAT_MODEL_OPTIONS.ollama;
  }
}

async function getProviderStatuses(
  activeProvider: LLMProvider,
  configuredProviders: Record<LLMProvider, boolean>,
): Promise<ProviderStatus[]> {
  const providers = Object.keys(configuredProviders) as LLMProvider[];
  const availability = await Promise.all(
    providers.map(async (provider) => {
      const configured = configuredProviders[provider];

      if (provider !== "ollama" && !configured) {
        return {
          provider,
          model: getModelForProvider(provider),
          configured,
          available: false,
          active: provider === activeProvider,
          reason: "Missing credentials",
        } satisfies ProviderStatus;
      }

      const available = await testProvider(provider);

      return {
        provider,
        model: getModelForProvider(provider),
        configured,
        available,
        active: provider === activeProvider,
        reason: available
          ? "Ready"
          : provider === "ollama"
            ? "Ollama is not responding"
            : "Configured but failing health check",
      } satisfies ProviderStatus;
    }),
  );

  return availability;
}

export async function GET() {
  const activeProvider = getActiveProvider();
  const configuredProviders = getConfiguredProviders();
  const generation = getGenerationConfig();
  const embedding = getEmbeddingConfig();
  const autonomy = getAgentRuntimeConfig();
  const capabilities = getAgentCapabilities(autonomy);
  const knowledge = getKnowledgeStatus();
  const heartbeatSettings = await db.setting.findMany({
    where: {
      key: {
        in: [
          "agent_heartbeat_service_started_at",
          "agent_last_heartbeat_started_at",
          "agent_last_heartbeat_finished_at",
          "agent_last_heartbeat_summary",
          "agent_stream_abort_count",
          "agent_stream_last_aborted_at",
        ],
      },
    },
  });

  const heartbeatMap = Object.fromEntries(heartbeatSettings.map((row) => [row.key, row.value]));

  const [chatOk, embeddingStatus, ollamaModels, workerStatus, crmProviders, providerStatuses] = await Promise.all([
    testProvider(activeProvider),
    testEmbeddingProvider(),
    getOllamaModelOptions(),
    getAgentWorkerStatus(),
    getCrmProviderStatuses(),
    getProviderStatuses(activeProvider, configuredProviders),
  ]);

  return Response.json({
    activeProvider,
    activeModel: getModelForProvider(activeProvider),
    configuredProviders,
    generation,
    embedding,
    autonomy: {
      ...autonomy,
      description: getAutonomyDescription(autonomy),
    },
    capabilities,
    knowledge,
    heartbeat: {
      serviceRunning: workerStatus.workerRunning,
      serviceHeartbeatSeconds: workerStatus.schedulerEveryMs ? Math.trunc(workerStatus.schedulerEveryMs / 1000) : null,
      serviceStartedAt: workerStatus.workerStartedAt,
      queueName: workerStatus.queueName,
      schedulerRegistered: workerStatus.schedulerRegistered,
      queueCounts: workerStatus.counts,
      workerLastSeenAt: workerStatus.workerLastSeenAt,
      lastStartedAt: heartbeatMap.agent_last_heartbeat_started_at ?? null,
      lastFinishedAt: heartbeatMap.agent_last_heartbeat_finished_at ?? null,
      summary: heartbeatMap.agent_last_heartbeat_summary ?? null,
      streamAbortCount: heartbeatMap.agent_stream_abort_count ?? "0",
      streamLastAbortedAt: heartbeatMap.agent_stream_last_aborted_at ?? null,
    },
    checks: {
      chat: {
        ok: chatOk,
        provider: activeProvider,
      },
      embedding: embeddingStatus,
    },
    providerStatuses,
    options: {
      chatProviders: Object.keys(configuredProviders),
      chatModels: {
        ...CHAT_MODEL_OPTIONS,
        ollama: ollamaModels,
      },
      embeddingProviders: Object.keys(EMBEDDING_MODEL_OPTIONS),
      embeddingModels: EMBEDDING_MODEL_OPTIONS,
    },
    mcp: {
      serverEndpoint: "/api/mcp",
      authRequired: !!process.env.MCP_AUTH_TOKEN,
      connectedClients: getMcpClientStatus(),
    },
    crm: {
      activeProvider: getActiveCrmProvider(),
      providers: crmProviders,
    },
    infrastructure: {
      redisConfigured: Boolean(process.env.REDIS_URL),
      memgraphConfigured: Boolean(process.env.MEMGRAPH_URI),
      memgraphUri: process.env.MEMGRAPH_URI ?? null,
      memgraphUser: process.env.MEMGRAPH_USER ?? null,
      devWebConflictStrategy: process.env.BIZBOT_DEV_WEB_CONFLICT ?? "reuse",
    },
  });
}