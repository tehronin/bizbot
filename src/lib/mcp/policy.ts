import { AsyncLocalStorage } from "node:async_hooks";

export type McpTransportKind = "http" | "stdio";
export type McpSamplingIntent = "developer_devloop_status";

export interface BizBotMcpServerOptions {
  transportKind?: McpTransportKind;
  enableSampling?: boolean;
}

export interface McpSamplingPolicy {
  intent: McpSamplingIntent;
  transportKind: McpTransportKind;
  advertiseSampling: boolean;
  allowTools: boolean;
  maxDepth: number;
  maxContextChars: number;
  blockNestedSampling: boolean;
}

interface McpSamplingFlowState {
  intent: McpSamplingIntent;
  transportKind: McpTransportKind;
  depth: number;
}

const SAMPLING_TRANSPORTS = new Set<McpTransportKind>(["stdio"]);
const SAMPLING_INTENTS = new Set<McpSamplingIntent>(["developer_devloop_status"]);
const DEFAULT_MCP_SAMPLING_MAX_DEPTH = 1;
const DEFAULT_MCP_SAMPLING_MAX_CONTEXT_CHARS = 12_000;
const samplingFlowStorage = new AsyncLocalStorage<McpSamplingFlowState>();

export function resolveBizBotMcpServerOptions(options?: BizBotMcpServerOptions): Required<BizBotMcpServerOptions> {
  return {
    transportKind: options?.transportKind ?? "http",
    enableSampling: options?.enableSampling ?? false,
  };
}

export function canTransportAdvertiseSampling(transportKind: McpTransportKind, enableSampling: boolean): boolean {
  return enableSampling && SAMPLING_TRANSPORTS.has(transportKind);
}

export function buildBizBotMcpCapabilities(options?: BizBotMcpServerOptions) {
  const resolved = resolveBizBotMcpServerOptions(options);

  return {
    tools: {},
    resources: {},
    prompts: {},
    logging: {},
    ...(canTransportAdvertiseSampling(resolved.transportKind, resolved.enableSampling) ? { sampling: {} } : {}),
  };
}

export function getMcpSamplingPolicy(intent: McpSamplingIntent, transportKind: McpTransportKind, enableSampling = true): McpSamplingPolicy {
  return {
    intent,
    transportKind,
    advertiseSampling: canTransportAdvertiseSampling(transportKind, enableSampling),
    allowTools: false,
    maxDepth: DEFAULT_MCP_SAMPLING_MAX_DEPTH,
    maxContextChars: DEFAULT_MCP_SAMPLING_MAX_CONTEXT_CHARS,
    blockNestedSampling: true,
  };
}

export function isMcpSamplingIntentAllowed(intent: McpSamplingIntent): boolean {
  return SAMPLING_INTENTS.has(intent);
}

export function getActiveMcpSamplingFlow(): { intent: McpSamplingIntent; transportKind: McpTransportKind; depth: number } | null {
  return samplingFlowStorage.getStore() ?? null;
}

export function getMcpSamplingBlockReason(intent: McpSamplingIntent, transportKind: McpTransportKind, enableSampling = true): string | null {
  if (!isMcpSamplingIntentAllowed(intent)) {
    return `Sampling intent '${intent}' is not allowed by BizBot MCP policy.`;
  }

  const policy = getMcpSamplingPolicy(intent, transportKind, enableSampling);
  if (!policy.advertiseSampling) {
    return `Sampling is disabled for the ${transportKind} transport.`;
  }

  const activeFlow = getActiveMcpSamplingFlow();
  if (!activeFlow) {
    return null;
  }

  if (policy.blockNestedSampling) {
    return `Sampling is blocked while already handling '${activeFlow.intent}'.`;
  }

  if (activeFlow.depth >= policy.maxDepth) {
    return `Sampling depth ${activeFlow.depth} exceeds the BizBot MCP limit of ${policy.maxDepth}.`;
  }

  return null;
}

export async function runWithMcpSamplingFlow<T>(intent: McpSamplingIntent, transportKind: McpTransportKind, fn: () => Promise<T>): Promise<T> {
  const activeFlow = getActiveMcpSamplingFlow();
  const nextState: McpSamplingFlowState = {
    intent,
    transportKind,
    depth: (activeFlow?.depth ?? 0) + 1,
  };

  return samplingFlowStorage.run(nextState, fn);
}

export function listMcpSamplingIntents(): McpSamplingIntent[] {
  return Array.from(SAMPLING_INTENTS);
}

export function listSamplingEnabledTransports(): McpTransportKind[] {
  return Array.from(SAMPLING_TRANSPORTS);
}