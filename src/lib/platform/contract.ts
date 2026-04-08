import { BUILTIN_PLUGIN_TOGGLES } from "@/lib/agent/plugins/settings";
import { listAgentProfileDescriptors } from "@/lib/agent/profiles";
import { MCP_AGENT_PROFILE, MCP_BLOCKED_TOOLS } from "@/lib/mcp/tool-presentation";

export const BIZBOT_PLATFORM_CONTRACT_VERSION = "v1" as const;

export type BizBotContractCompatibilityClassification = "breaking" | "non_breaking" | "internal_only";

export interface BizBotContractDriftSectionState {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface BizBotPlatformContractSnapshotState {
  version: string;
  compatibilityPolicyVersion: string;
  mcpLane: string;
  blockedTools: string[];
  promptsAreServerOwned: boolean;
  resourcesAreServerOwned: boolean;
  importedCatalogs: {
    prompts: boolean;
    resources: boolean;
  };
  toolOwnershipRequired: boolean;
  laneBoundedExposure: boolean;
}

export interface BizBotContractDriftShape {
  previousHash: string | null;
  currentHash: string;
  changed: boolean;
  tools: BizBotContractDriftSectionState;
  prompts: BizBotContractDriftSectionState;
  resources: BizBotContractDriftSectionState;
  profileChanged: boolean;
  contractChanged: boolean;
}

export interface BizBotPlatformContractImpactState {
  classification: BizBotContractCompatibilityClassification;
  requiresVersionBump: boolean;
  reasons: string[];
  changedSurfaces: string[];
  reviewFiles: string[];
}

export interface BizBotPlatformContractState {
  version: string;
  docs: {
    spec: string;
    changelog: string;
  };
  laneProfileContract: {
    mcpLane: string;
    profiles: Array<{
      id: string;
      label: string;
      delegationTargets: string[];
      allowedPrefixes: string[];
      allowedTools: string[];
      deniedTools: string[];
    }>;
  };
  pluginMetadataContract: {
    requiredFields: string[];
    optionalFields: string[];
    builtinToggleIds: string[];
  };
  mcpExposureContract: BizBotPlatformContractSnapshotState;
  toolSchemaContract: {
    rootType: "object";
    namingDerivedFromPluginId: boolean;
    descriptionRequired: boolean;
    additionalPropertiesPolicy: "prefer_false";
  };
  allowedSideEffectClasses: Array<{
    id: string;
    description: string;
  }>;
  provenanceRequirements: string[];
  compatibilityPolicy: {
    breaking: string[];
    nonBreaking: string[];
    internalOnly: string[];
  };
}

const CONTRACT_REVIEW_FILES = [
  "docs/platform-contract-v1.md",
  "docs/platform-contract-changelog.json",
  "tests/mcp/contracts.test.ts",
  "tests/mcp/http-route.test.ts",
  "tests/builder/mcp-snapshots.test.ts",
] as const;

function listChangedSurfaces(drift: BizBotContractDriftShape): string[] {
  const surfaces: string[] = [];
  if (drift.contractChanged) {
    surfaces.push("platform-contract");
  }
  if (drift.profileChanged) {
    surfaces.push("lane-profile");
  }
  if (drift.tools.added.length || drift.tools.removed.length || drift.tools.changed.length) {
    surfaces.push("tools");
  }
  if (drift.prompts.added.length || drift.prompts.removed.length || drift.prompts.changed.length) {
    surfaces.push("prompts");
  }
  if (drift.resources.added.length || drift.resources.removed.length || drift.resources.changed.length) {
    surfaces.push("resources");
  }
  return surfaces;
}

export function buildBizBotPlatformContractSnapshot(): BizBotPlatformContractSnapshotState {
  return {
    version: BIZBOT_PLATFORM_CONTRACT_VERSION,
    compatibilityPolicyVersion: BIZBOT_PLATFORM_CONTRACT_VERSION,
    mcpLane: MCP_AGENT_PROFILE,
    blockedTools: Array.from(MCP_BLOCKED_TOOLS).sort(),
    promptsAreServerOwned: true,
    resourcesAreServerOwned: true,
    importedCatalogs: {
      prompts: true,
      resources: true,
    },
    toolOwnershipRequired: true,
    laneBoundedExposure: true,
  };
}

export function getBizBotPlatformContract(): BizBotPlatformContractState {
  return {
    version: BIZBOT_PLATFORM_CONTRACT_VERSION,
    docs: {
      spec: "docs/platform-contract-v1.md",
      changelog: "docs/platform-contract-changelog.json",
    },
    laneProfileContract: {
      mcpLane: MCP_AGENT_PROFILE,
      profiles: listAgentProfileDescriptors().map((profile) => ({
        id: profile.id,
        label: profile.label,
        delegationTargets: [...profile.delegationTargets],
        allowedPrefixes: [...profile.toolPolicy.allowedPrefixes],
        allowedTools: [...(profile.toolPolicy.allowedTools ?? [])],
        deniedTools: [...(profile.toolPolicy.deniedTools ?? [])],
      })),
    },
    pluginMetadataContract: {
      requiredFields: ["id", "displayName", "description"],
      optionalFields: ["tags"],
      builtinToggleIds: BUILTIN_PLUGIN_TOGGLES.map((plugin) => plugin.id),
    },
    mcpExposureContract: buildBizBotPlatformContractSnapshot(),
    toolSchemaContract: {
      rootType: "object",
      namingDerivedFromPluginId: true,
      descriptionRequired: true,
      additionalPropertiesPolicy: "prefer_false",
    },
    allowedSideEffectClasses: [
      { id: "read_only", description: "Pure inspection with no persisted or external side effects." },
      { id: "local_state", description: "Writes only to BizBot-local persistence or workspace state." },
      { id: "queued_action", description: "Creates deferred work that must remain auditable and retryable." },
      { id: "approval_controlled_external", description: "Touches external systems only through an approval-bounded or explicitly scoped path." },
    ],
    provenanceRequirements: [
      "Every exposed MCP tool must retain ownerId and ownerKind metadata.",
      "Builder MCP snapshots must persist the platform contract version alongside tool, prompt, and resource descriptors.",
      "Runtime-to-snapshot mappings must record tool name, run identity, task identity, and active architecture hints.",
      "Docs and changelog references must point to the current platform contract version.",
    ],
    compatibilityPolicy: {
      breaking: [
        "Removing tools, prompts, or resources from the MCP surface.",
        "Changing existing tool, prompt, or resource descriptors in a way that can alter required schema, semantics, or side effects.",
        "Narrowing lane access or changing bounded MCP exposure assumptions.",
        "Changing the platform contract version or compatibility policy rules.",
      ],
      nonBreaking: [
        "Adding new tools, prompts, or resources without changing existing descriptors.",
        "Adding metadata or optional affordances while preserving existing contract behavior.",
        "Expanding catalog visibility without narrowing lane access.",
      ],
      internalOnly: [
        "Implementation-only changes that do not affect tool, prompt, resource, lane, or provenance contracts.",
      ],
    },
  };
}

export function classifyBizBotContractDrift(drift: BizBotContractDriftShape): BizBotPlatformContractImpactState {
  if (!drift.changed) {
    return {
      classification: "internal_only",
      requiresVersionBump: false,
      reasons: ["No MCP-facing contract drift was detected."],
      changedSurfaces: [],
      reviewFiles: [...CONTRACT_REVIEW_FILES],
    };
  }

  const changedSurfaces = listChangedSurfaces(drift);
  const reasons: string[] = [];
  let classification: BizBotContractCompatibilityClassification = "internal_only";

  if (drift.contractChanged) {
    classification = "breaking";
    reasons.push("Platform contract metadata or bounded exposure assumptions changed.");
  }
  if (drift.profileChanged) {
    classification = "breaking";
    reasons.push("Lane/profile exposure changed for the MCP surface.");
  }
  if (drift.tools.removed.length || drift.prompts.removed.length || drift.resources.removed.length) {
    classification = "breaking";
    reasons.push("Previously exposed MCP tools, prompts, or resources were removed.");
  }
  if (drift.tools.changed.length || drift.prompts.changed.length || drift.resources.changed.length) {
    classification = "breaking";
    reasons.push("Existing MCP descriptors changed and are treated conservatively as breaking until reviewed.");
  }

  if (classification !== "breaking") {
    const additiveOnly = drift.tools.added.length || drift.prompts.added.length || drift.resources.added.length;
    if (additiveOnly) {
      classification = "non_breaking";
      reasons.push("Only additive MCP surface growth was detected.");
    }
  }

  if (classification === "internal_only" && reasons.length === 0) {
    reasons.push("Detected drift does not change the public MCP contract shape.");
  }

  return {
    classification,
    requiresVersionBump: classification === "breaking",
    reasons,
    changedSurfaces,
    reviewFiles: [...CONTRACT_REVIEW_FILES],
  };
}