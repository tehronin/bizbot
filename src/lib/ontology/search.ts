import { db } from "@/lib/db";
import { ONTOLOGY_SCOPE_PRECEDENCE } from "@/lib/ontology/constants";
import type { OntologyCandidateSummary, OntologyResolution, OntologyScope } from "@/lib/ontology/types";
import { normalizeAliasValue, normalizeOntologyToken } from "@/lib/ontology/validation";
import { toOntologyCandidateSummary } from "@/lib/ontology/service";

function filterScopedCandidates<T extends { scope: string; userId: string | null }>(
  candidates: T[],
  userId?: string,
): Record<OntologyScope, T[]> {
  return {
    user: candidates.filter((candidate) => candidate.scope === "user" && Boolean(userId) && candidate.userId === userId),
    runtime: candidates.filter((candidate) => candidate.scope === "runtime" && candidate.userId === null),
    global: candidates.filter((candidate) => candidate.scope === "global" && candidate.userId === null),
  };
}

function resolveByPrecedence<T extends { scope: string; userId: string | null }>(
  candidates: T[],
  userId?: string,
): { scope: OntologyScope | null; candidates: T[] } {
  const byScope = filterScopedCandidates(candidates, userId);

  for (const scope of ONTOLOGY_SCOPE_PRECEDENCE) {
    if (byScope[scope].length > 0) {
      return {
        scope,
        candidates: byScope[scope],
      };
    }
  }

  return {
    scope: null,
    candidates: [],
  };
}

export async function resolveOntologyAlias(params: {
  alias: string;
  userId?: string;
  type?: string;
}): Promise<OntologyResolution> {
  const normalizedValue = normalizeAliasValue(params.alias);
  if (!normalizedValue) {
    return { status: "not_found", normalizedValue, candidates: [] };
  }

  const aliases = await db.ontologyAlias.findMany({
    where: {
      normalizedValue,
      entity: {
        status: "active",
        ...(params.type ? { type: params.type } : {}),
      },
    },
    include: {
      entity: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const winners = resolveByPrecedence(aliases.map((alias) => alias.entity), params.userId);
  if (!winners.scope) {
    return { status: "not_found", normalizedValue, candidates: [] };
  }

  const candidates = winners.candidates.map((candidate) => toOntologyCandidateSummary(candidate));
  if (candidates.length === 1) {
    return {
      status: "resolved",
      normalizedValue,
      scope: winners.scope,
      entity: candidates[0],
    };
  }

  return {
    status: "ambiguous",
    normalizedValue,
    scope: winners.scope,
    candidates,
  };
}

export async function lookupOntologyCanonicalKey(params: {
  canonicalKey: string;
  userId?: string;
  type?: string;
}): Promise<OntologyResolution> {
  const canonicalKey = normalizeOntologyToken(params.canonicalKey);
  const entities = await db.ontologyEntity.findMany({
    where: {
      canonicalKey,
      status: "active",
      ...(params.type ? { type: params.type } : {}),
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const winners = resolveByPrecedence(entities, params.userId);
  if (!winners.scope) {
    return { status: "not_found", normalizedValue: canonicalKey, candidates: [] };
  }

  const candidates = winners.candidates.map((candidate) => toOntologyCandidateSummary(candidate));
  if (candidates.length === 1) {
    return {
      status: "resolved",
      normalizedValue: canonicalKey,
      scope: winners.scope,
      entity: candidates[0],
    };
  }

  return {
    status: "ambiguous",
    normalizedValue: canonicalKey,
    scope: winners.scope,
    candidates,
  };
}

export async function searchOntologyEntities(params: {
  query: string;
  userId?: string;
  scope?: OntologyScope;
  limit?: number;
}) {
  const normalizedAlias = normalizeAliasValue(params.query);
  const canonicalToken = normalizeOntologyToken(params.query);
  const limit = Math.max(1, Math.min(params.limit ?? 20, 50));

  const entities = await db.ontologyEntity.findMany({
    where: {
      status: "active",
      ...(params.scope ? { scope: params.scope } : {}),
      OR: [
        { canonicalKey: canonicalToken },
        { canonicalKey: { contains: canonicalToken } },
        { displayName: { contains: params.query, mode: "insensitive" } },
        {
          aliases: {
            some: {
              normalizedValue: normalizedAlias,
            },
          },
        },
      ],
    },
    take: limit,
    orderBy: [{ createdAt: "asc" }],
  });

  const winners = resolveByPrecedence(entities, params.userId);
  const visible = params.scope ? entities : winners.candidates.length > 0 ? winners.candidates : entities;

  return {
    query: params.query,
    normalizedAlias,
    canonicalToken,
    effectiveScope: params.scope ?? winners.scope,
    matches: visible.map((entity) => toOntologyCandidateSummary(entity)),
  };
}

export function summarizeResolutionCandidates(candidates: OntologyCandidateSummary[]) {
  return candidates.map((candidate) => ({
    entityId: candidate.entityId,
    scope: candidate.scope,
    type: candidate.type,
    canonicalKey: candidate.canonicalKey,
    displayName: candidate.displayName,
  }));
}