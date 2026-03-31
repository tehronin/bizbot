import type { ToolParametersSchema } from "@/lib/agent/tools";
import type { BizBotPlugin } from "@/lib/agent/plugins/contracts";
import {
  analyzeToolNaming,
  summarizeToolSchema,
  toInspectablePlugin,
  type InspectablePluginShape,
  type InspectableToolShape,
  type InspectionIssue,
} from "@/lib/agent/plugins/inspection";

export interface LintResult {
  errors: InspectionIssue[];
  warnings: InspectionIssue[];
  suggestions: InspectionIssue[];
}

function sortIssues(issues: InspectionIssue[]): LintResult {
  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
    suggestions: issues.filter((issue) => issue.severity === "suggestion"),
  };
}

export function lintSchema(parameters?: ToolParametersSchema): InspectionIssue[] {
  const issues: InspectionIssue[] = [];
  if (!parameters) {
    issues.push({ severity: "warning", code: "schema-missing", message: "No parameter schema was available for linting." });
    return issues;
  }

  if (parameters.type !== "object") {
    issues.push({ severity: "error", code: "schema-root-type", message: "Tool parameter schemas must use an object root." });
  }

  const summary = summarizeToolSchema(parameters);
  if (!summary) {
    issues.push({ severity: "warning", code: "schema-summary-missing", message: "Could not summarize the tool schema." });
    return issues;
  }

  if (summary.propertyCount === 0) {
    issues.push({ severity: "suggestion", code: "schema-empty", message: "Empty schemas are valid, but confirm this tool truly needs no arguments." });
  }
  if (summary.propertyCount > 0 && summary.requiredCount === 0) {
    issues.push({ severity: "suggestion", code: "schema-no-required-fields", message: "Schema has properties but no required fields; confirm defaults and validation are intentional." });
  }
  if (summary.propertyCount > 0 && summary.additionalProperties) {
    issues.push({ severity: "warning", code: "schema-open-shape", message: "Schema allows additionalProperties. Consider closing the shape for a more predictable MCP contract." });
  }
  return issues;
}

export function lintToolName(name: string, expectedPrefix?: string): InspectionIssue[] {
  const analysis = analyzeToolNaming(name, expectedPrefix);
  return analysis.issues;
}

export function lintToolDefinition(tool: InspectableToolShape, expectedPrefix?: string): LintResult {
  const issues: InspectionIssue[] = [];

  if (!tool.name?.trim()) {
    issues.push({ severity: "error", code: "tool-name-missing", message: "Tool is missing a name." });
  }
  issues.push(...lintToolName(tool.name, expectedPrefix));

  if (!tool.description?.trim()) {
    issues.push({ severity: "error", code: "tool-description-missing", message: `Tool ${tool.name} is missing a description.` });
  } else if (tool.description.trim().length < 24) {
    issues.push({ severity: "warning", code: "tool-description-weak", message: `Tool ${tool.name} description is short. Add task, scope, and side-effect guidance.` });
  }

  issues.push(...lintSchema(tool.parameters));
  return sortIssues(issues);
}

export function lintPlugin(plugin: BizBotPlugin | InspectablePluginShape): LintResult {
  const normalized = "metadata" in plugin && "sourceType" in plugin ? plugin : toInspectablePlugin(plugin as BizBotPlugin);
  const issues: InspectionIssue[] = [];

  if (!normalized.metadata.id?.trim()) {
    issues.push({ severity: "error", code: "plugin-id-missing", message: "Plugin metadata.id is required." });
  }
  if (!normalized.metadata.displayName?.trim()) {
    issues.push({ severity: "warning", code: "plugin-display-name-missing", message: "Plugin metadata.displayName is missing." });
  }
  if (!normalized.metadata.description?.trim()) {
    issues.push({ severity: "error", code: "plugin-description-missing", message: "Plugin metadata.description is required." });
  } else if (normalized.metadata.description.trim().length < 32) {
    issues.push({ severity: "suggestion", code: "plugin-description-short", message: "Plugin description is short. Explain what lane or workflow it serves." });
  }
  if (!normalized.tools.length) {
    issues.push({ severity: "error", code: "plugin-tools-empty", message: "Plugin must expose at least one tool." });
  }

  const expectedPrefix = normalized.metadata.id?.replace(/-/g, "_");
  for (const tool of normalized.tools) {
    const toolLint = lintToolDefinition(tool, expectedPrefix);
    issues.push(...toolLint.errors, ...toolLint.warnings, ...toolLint.suggestions);
  }

  return sortIssues(issues);
}