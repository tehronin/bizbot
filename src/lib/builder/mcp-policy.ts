import path from "path";
import type { BuilderPackageManager, BuilderProject } from "@prisma/client";
import {
  canonicalizeBuilderJsonValue,
  hashCanonicalBuilderJsonValue,
  normalizeBuilderJsonValue,
} from "@/lib/builder/canonical-json";
import { readBuilderFile, writeBuilderFile } from "@/lib/builder/workspace";
import type { BuilderMcpPolicyBaselineState } from "@/lib/builder/types";

export const BUILDER_MCP_POLICY_VERSION = 1;
export const BUILDER_MCP_POLICY_HASH_VERSION = 1;
export const BUILDER_MCP_POLICY_ARTIFACT = ".builder/mcp-policy.json";
export const BUILDER_MCP_POLICY_DECISION_KEYS = ["mcp_control_plane"] as const;
export const BUILDER_MCP_POLICY_ALLOWED_TOOL_CATEGORIES = [
  "builder_dependency",
  "builder_scaffold",
  "builder_script",
  "builder_validation",
] as const;

export interface BuilderMcpPolicyArtifactState {
  version: number;
  template: string;
  packageManager: "npm" | "pnpm";
  expectedMcpContractHash: string;
  policyHashVersion: number;
  allowedToolCategories: string[];
  decisionKeys: string[];
}

export interface BuilderMcpPolicyDriftState {
  artifactPath: string;
  expectedHash: string;
  actualHash: string | null;
  expectedMcpContractHash: string;
  actualMcpContractHash: string | null;
  reason: "missing_artifact" | "invalid_artifact" | "hash_mismatch";
}

function toPolicyPackageManager(packageManager: BuilderPackageManager): "npm" | "pnpm" {
  return packageManager === "PNPM" ? "pnpm" : "npm";
}

export function getBuilderMcpPolicyArtifactPath(projectRelativePath: string): string {
  return path.posix.join(projectRelativePath, BUILDER_MCP_POLICY_ARTIFACT);
}

export function buildBuilderMcpPolicyArtifact(args: {
  template: string;
  packageManager: BuilderPackageManager;
  expectedMcpContractHash: string;
}): BuilderMcpPolicyArtifactState {
  return {
    version: BUILDER_MCP_POLICY_VERSION,
    template: args.template,
    packageManager: toPolicyPackageManager(args.packageManager),
    expectedMcpContractHash: args.expectedMcpContractHash,
    policyHashVersion: BUILDER_MCP_POLICY_HASH_VERSION,
    allowedToolCategories: [...BUILDER_MCP_POLICY_ALLOWED_TOOL_CATEGORIES],
    decisionKeys: [...BUILDER_MCP_POLICY_DECISION_KEYS],
  };
}

export function canonicalizeBuilderMcpPolicyArtifact(policy: BuilderMcpPolicyArtifactState): string {
  return canonicalizeBuilderJsonValue(normalizeBuilderJsonValue(policy));
}

export function hashBuilderMcpPolicyArtifact(policy: BuilderMcpPolicyArtifactState): string {
  return hashCanonicalBuilderJsonValue(policy);
}

export function buildBuilderMcpPolicyBaseline(args: {
  projectRelativePath: string;
  policy: BuilderMcpPolicyArtifactState;
}): BuilderMcpPolicyBaselineState {
  return {
    artifactPath: getBuilderMcpPolicyArtifactPath(args.projectRelativePath),
    version: args.policy.version,
    template: args.policy.template,
    packageManager: args.policy.packageManager,
    expectedHash: hashBuilderMcpPolicyArtifact(args.policy),
    expectedMcpContractHash: args.policy.expectedMcpContractHash,
    policyHashVersion: args.policy.policyHashVersion,
    allowedToolCategories: [...args.policy.allowedToolCategories],
    decisionKeys: [...args.policy.decisionKeys],
  };
}

export function writeBuilderMcpPolicyArtifact(args: Pick<BuilderProject, "relativePath" | "template" | "packageManager"> & {
  expectedMcpContractHash: string;
}): {
  artifactPath: string;
  policy: BuilderMcpPolicyArtifactState;
  baseline: BuilderMcpPolicyBaselineState;
} {
  const policy = buildBuilderMcpPolicyArtifact({
    template: args.template,
    packageManager: args.packageManager,
    expectedMcpContractHash: args.expectedMcpContractHash,
  });
  const baseline = buildBuilderMcpPolicyBaseline({ projectRelativePath: args.relativePath, policy });
  writeBuilderFile(
    baseline.artifactPath,
    `${JSON.stringify(normalizeBuilderJsonValue(policy), null, 2)}\n`,
  );
  return {
    artifactPath: baseline.artifactPath,
    policy,
    baseline,
  };
}

export function readBuilderMcpPolicyArtifact(projectRelativePath: string): BuilderMcpPolicyArtifactState {
  return JSON.parse(readBuilderFile(getBuilderMcpPolicyArtifactPath(projectRelativePath))) as BuilderMcpPolicyArtifactState;
}

export function resolveBuilderMcpPolicyDrift(args: {
  projectRelativePath: string;
  baseline: BuilderMcpPolicyBaselineState;
  actualMcpContractHash?: string | null;
}): BuilderMcpPolicyDriftState | null {
  try {
    const artifact = readBuilderMcpPolicyArtifact(args.projectRelativePath);
    const actualHash = hashBuilderMcpPolicyArtifact(artifact);
    if (actualHash === args.baseline.expectedHash) {
      return null;
    }

    return {
      artifactPath: args.baseline.artifactPath,
      expectedHash: args.baseline.expectedHash,
      actualHash,
      expectedMcpContractHash: args.baseline.expectedMcpContractHash,
      actualMcpContractHash: args.actualMcpContractHash ?? artifact.expectedMcpContractHash ?? null,
      reason: "hash_mismatch",
    };
  } catch (error) {
    const reason = error instanceof SyntaxError ? "invalid_artifact" : "missing_artifact";
    return {
      artifactPath: args.baseline.artifactPath,
      expectedHash: args.baseline.expectedHash,
      actualHash: null,
      expectedMcpContractHash: args.baseline.expectedMcpContractHash,
      actualMcpContractHash: args.actualMcpContractHash ?? null,
      reason,
    };
  }
}