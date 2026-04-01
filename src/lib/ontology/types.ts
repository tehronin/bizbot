import type { JsonValue } from "@/lib/agent/tools";
import type {
  ONTOLOGY_ALIAS_KINDS,
  ONTOLOGY_EVIDENCE_SOURCE_KINDS,
  ONTOLOGY_PROMOTION_ALLOWLIST,
  ONTOLOGY_SCOPES,
  ONTOLOGY_SOURCES,
  ONTOLOGY_STATUSES,
} from "@/lib/ontology/constants";

export type OntologyScope = (typeof ONTOLOGY_SCOPES)[number];
export type OntologyStatus = (typeof ONTOLOGY_STATUSES)[number];
export type OntologyAliasKind = (typeof ONTOLOGY_ALIAS_KINDS)[number];
export type OntologySource = (typeof ONTOLOGY_SOURCES)[number];
export type OntologyEvidenceSourceKind = (typeof ONTOLOGY_EVIDENCE_SOURCE_KINDS)[number];
export type OntologyPromotionCategory = (typeof ONTOLOGY_PROMOTION_ALLOWLIST)[number];

export interface OntologyEntityRecord {
  id: string;
  userId: string | null;
  scope: OntologyScope;
  type: string;
  canonicalKey: string;
  displayName: string;
  description: string | null;
  attributes: JsonValue;
  status: OntologyStatus;
  source: OntologySource;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyRelationRecord {
  id: string;
  userId: string | null;
  scope: OntologyScope;
  type: string;
  subjectEntityId: string;
  objectEntityId: string;
  attributes: JsonValue;
  source: OntologySource;
  confidence: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyAliasRecord {
  id: string;
  entityId: string;
  scope: OntologyScope;
  value: string;
  normalizedValue: string;
  kind: OntologyAliasKind;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyEvidenceRecord {
  id: string;
  entityId: string | null;
  relationId: string | null;
  sourceKind: OntologyEvidenceSourceKind;
  sourceRef: string;
  approvalMarker: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyCandidateSummary {
  entityId: string;
  scope: OntologyScope;
  type: string;
  canonicalKey: string;
  displayName: string;
  status: OntologyStatus;
  userId: string | null;
}

export type OntologyResolution =
  | { status: "resolved"; normalizedValue: string; scope: OntologyScope; entity: OntologyCandidateSummary }
  | { status: "ambiguous"; normalizedValue: string; scope: OntologyScope; candidates: OntologyCandidateSummary[] }
  | { status: "not_found"; normalizedValue: string; candidates: OntologyCandidateSummary[] };

export type OntologyPromotionSkipReason =
  | "inactive_fact"
  | "category_not_allowlisted"
  | "secret_like"
  | "value_too_large"
  | "unsupported_shape"
  | "structurally_unclear";

export type OntologyPromotionResult =
  | {
      status: "promoted";
      factId: string;
      category: string;
      entityIds: string[];
      relationIds: string[];
      evidenceIds: string[];
    }
  | {
      status: "skipped";
      factId: string;
      category: string;
      reason: OntologyPromotionSkipReason;
      detail: string;
    };

export interface BuildOntologyPromptResult {
  block: string;
  lines: string[];
  omitted: boolean;
  reason?: string;
}