import {
  ONTOLOGY_PROMPT_MAX_CHARS,
  ONTOLOGY_PROMPT_MAX_FACT_LINES,
  ONTOLOGY_PROMPT_MAX_LINES,
  ONTOLOGY_RUNTIME_RELATION_PRIORITY,
  ONTOLOGY_SCOPE_PRECEDENCE,
} from "@/lib/ontology/constants";
import { listActiveUserOntologyRelations } from "@/lib/ontology/service";
import type { BuildOntologyPromptResult } from "@/lib/ontology/types";
import { truncateOntologyText } from "@/lib/ontology/validation";

function sortRelations(left: { type: string; scope: string }, right: { type: string; scope: string }) {
  const leftPriority = ONTOLOGY_RUNTIME_RELATION_PRIORITY[left.type] ?? 999;
  const rightPriority = ONTOLOGY_RUNTIME_RELATION_PRIORITY[right.type] ?? 999;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.scope.localeCompare(right.scope);
}

function getScopePriority(scope: string): number {
  const index = ONTOLOGY_SCOPE_PRECEDENCE.indexOf(scope as (typeof ONTOLOGY_SCOPE_PRECEDENCE)[number]);
  return index === -1 ? 999 : index;
}

function collapseByScopePrecedence<T extends { scope: string; type: string; objectEntity: { canonicalKey: string } }>(relations: T[]): T[] {
  const bySignature = new Map<string, T>();

  for (const relation of relations) {
    const signature = `${relation.type}:${relation.objectEntity.canonicalKey}`;
    const current = bySignature.get(signature);
    if (!current || getScopePriority(relation.scope) < getScopePriority(current.scope)) {
      bySignature.set(signature, relation);
    }
  }

  return [...bySignature.values()];
}

function buildRelationLine(relation: {
  type: string;
  objectEntity: { displayName: string; canonicalKey: string };
}): string {
  switch (relation.type) {
    case "has_identity":
      return `identity: ${relation.objectEntity.displayName}`;
    case "has_preference":
      return `preference: ${relation.objectEntity.displayName}`;
    case "has_constraint":
      return `constraint: ${relation.objectEntity.displayName}`;
    case "uses_workflow":
      return `workflow: ${relation.objectEntity.displayName}`;
    case "configured_with":
      return `setting: ${relation.objectEntity.displayName}`;
    case "pursues_goal":
      return `goal: ${relation.objectEntity.displayName}`;
    default:
      return `relation: ${relation.type} -> ${relation.objectEntity.displayName}`;
  }
}

export async function buildOntologyPromptBlock(userId: string): Promise<BuildOntologyPromptResult> {
  const relations = await listActiveUserOntologyRelations(userId);
  if (relations.length === 0) {
    return { block: "", lines: [], omitted: true, reason: "no_relevant_ontology" };
  }

  const userEntity = relations[0]?.subjectEntity;
  const selectedLines = collapseByScopePrecedence(relations)
    .slice()
    .sort(sortRelations)
    .map((relation) => buildRelationLine(relation))
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, ONTOLOGY_PROMPT_MAX_FACT_LINES);

  const lines = [
    "[Ontology Context]",
    `- user: ${truncateOntologyText(userEntity.displayName, 120)}`,
    ...selectedLines.map((line) => `- ${truncateOntologyText(line, 140)}`),
    "[/Ontology Context]",
  ];

  if (lines.length > ONTOLOGY_PROMPT_MAX_LINES) {
    return { block: "", lines: [], omitted: true, reason: "line_budget_exceeded" };
  }

  const block = lines.join("\n");
  if (block.length > ONTOLOGY_PROMPT_MAX_CHARS) {
    return { block: "", lines: [], omitted: true, reason: "char_budget_exceeded" };
  }

  return {
    block,
    lines,
    omitted: false,
  };
}