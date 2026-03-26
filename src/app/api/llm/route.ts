import { db } from "@/lib/db";
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
import { getHeartbeatServiceState } from "@/lib/agent/heartbeat";
import { getKnowledgeStatus } from "@/lib/agent/knowledge";
import {
  getEmbeddingConfig,
  testEmbeddingProvider,
} from "@/lib/embeddings/embed";

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
  }>;
}

const CHAT_MODEL_OPTIONS: Record<LLMProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4.1-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest"],
  ollama: ["gemma3", "gemma3:4b", "gemma3:12b", "llama3.2"],
  google: ["gemini-2.0-flash", "gemini-2.5-flash"],
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

export async function GET() {
  const activeProvider = getActiveProvider();
  const configuredProviders = getConfiguredProviders();
  const generation = getGenerationConfig();
  const embedding = getEmbeddingConfig();
  const autonomy = getAgentRuntimeConfig();
  const capabilities = getAgentCapabilities(autonomy);
  const heartbeatService = getHeartbeatServiceState();
  const knowledge = getKnowledgeStatus();
  const heartbeatSettings = await db.setting.findMany({
    where: {
      key: {
        in: [
          "agent_heartbeat_service_started_at",
          "agent_last_heartbeat_started_at",
          "agent_last_heartbeat_finished_at",
          "agent_last_heartbeat_summary",
        ],
      },
    },
  });

  const heartbeatMap = Object.fromEntries(heartbeatSettings.map((row) => [row.key, row.value]));

  const [chatOk, embeddingStatus, ollamaModels] = await Promise.all([
    testProvider(activeProvider),
    testEmbeddingProvider(),
    getOllamaModelOptions(),
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
      serviceRunning: heartbeatService.running,
      serviceHeartbeatSeconds: heartbeatService.heartbeatSeconds,
      serviceStartedAt: heartbeatMap.agent_heartbeat_service_started_at ?? null,
      lastStartedAt: heartbeatMap.agent_last_heartbeat_started_at ?? null,
      lastFinishedAt: heartbeatMap.agent_last_heartbeat_finished_at ?? null,
      summary: heartbeatMap.agent_last_heartbeat_summary ?? null,
    },
    checks: {
      chat: {
        ok: chatOk,
        provider: activeProvider,
      },
      embedding: embeddingStatus,
    },
    options: {
      chatProviders: Object.keys(configuredProviders),
      chatModels: {
        ...CHAT_MODEL_OPTIONS,
        ollama: ollamaModels,
      },
      embeddingProviders: Object.keys(EMBEDDING_MODEL_OPTIONS),
      embeddingModels: EMBEDDING_MODEL_OPTIONS,
    },
  });
}