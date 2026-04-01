# Ontology Core v1

## Purpose

BizBot now has three distinct knowledge lanes:

- semantic memory for fuzzy recall
- explicit user memory for durable user-approved facts
- ontology for canonical typed entities, relations, aliases, provenance, and scoped resolution

Ontology is a core system layer. It is not a plugin, not a second user-memory CRUD surface, and not a replacement for semantic memory. v1 exists so the runtime, future plugins, memory bridges, and developer inspection surfaces can resolve a small set of stable facts through deterministic typed rules.

## v1 Scope

Ontology v1 is intentionally narrow. Done means:

- canonical persistence exists in Postgres through Prisma models
- core ontology services exist under `src/lib/ontology/`
- explicit relational user memory can be promoted into ontology through deterministic allowlisted rules
- runtime can read a small bounded `[Ontology Context]` block safely and omit it when not useful
- ontology has developer-facing MCP inspection resources and narrow `developer_*` tools
- tests and docs define precedence, ambiguity, lifecycle, and promotion rules

## Non-Goals

Ontology v1 does not include:

- a separate ontology UI
- a general-purpose ontology editor
- broad automatic graphing of the plugin registry, tools, prompts, or resources
- mandatory embedding search
- full Memgraph sync or a projection engine
- automatic runtime writes on every turn
- fuzzy extraction from arbitrary chat or JSON blobs
- business-domain extraction beyond explicit allowlisted memory categories

## Source of Truth and Lane Boundaries

- Postgres is canonical for ontology persistence.
- Explicit user memory remains canonical for approved stable user facts.
- Ontology may derive from explicit user memory, but it must not weaken or replace it.
- Runtime prompt context and developer MCP inspection are separate surfaces.
- MCP ontology resources and `developer_*` ontology tools are inspection-only and must never be injected into runtime prompts automatically.

## Persistence Model

Ontology v1 uses four tables:

- `OntologyEntity`
- `OntologyRelation`
- `OntologyAlias`
- `OntologyEvidence`

The core persistence rules are:

- entities and relations may be user-scoped or shared
- aliases are normalized for deterministic lookup
- evidence records provenance for either an entity or a relation, never both
- system/bootstrap entries are retained and marked inactive or deprecated instead of being hard-deleted automatically

`OntologyEvidence` target invariant:

- each evidence row must set exactly one of `entityId` or `relationId`
- service-layer validation enforces this invariant in v1

## v1 Scopes

Ontology v1 supports exactly these scopes:

- `user`
- `runtime`
- `global`

No workspace scope is introduced in v1.

## Scope Precedence

Runtime resolution precedence is:

1. `user`
2. `runtime`
3. `global`

This precedence applies to:

- alias resolution
- canonical-key lookup fallback ordering
- runtime prompt summarization when multiple candidates could apply

Resolution must fail closed when precedence cannot produce one clear answer.

## Alias Rules

Alias handling is intentionally conservative.

- aliases are normalized before storage and lookup
- the same normalized alias may exist on multiple entities
- higher-precedence scope wins when one candidate exists in the best effective scope
- if multiple active candidates remain in the same winning scope, resolution is ambiguous
- ambiguous resolution must never pick arbitrarily
- ambiguity results must include candidate ids and compact summaries for inspection

## Promotion from Explicit User Memory

Promotion is deterministic and allowlist-based. Ontology never performs fuzzy extraction from user memory facts.

### Eligibility Rules

A `UserMemoryFact` may promote only when all of these are true:

- `isActive === true`
- `category` is allowlisted
- the value is small enough for deterministic handling
- the value shape is structurally usable
- the fact is durable and stable
- the fact is not secret-like, temporary, or speculative

### Allowlisted v1 Categories

- `identity`
- `preference`
- `workflow`
- `constraint`
- `operator_setting`
- `goal` only if that category exists in the fact source in a future compatible change

Current repo state does not define `goal` in explicit user memory categories, so v1 does not rely on it.

### Promotion Mapping Rules

Promotion uses explicit mappers by category:

- `identity` produces a user-linked identity entity when the value is a scalar or a small labeled object
- `preference` produces a canonical preference entity plus a `has_preference` relation from the user entity
- `workflow` produces a canonical workflow entity plus a `uses_workflow` relation from the user entity
- `constraint` produces a canonical constraint entity plus a `has_constraint` relation from the user entity
- `operator_setting` produces a canonical setting entity plus a `configured_with` relation from the user entity

Promotion rules also require:

- provenance must point back to the source `UserMemoryFact`
- promotion must not blindly mirror all fact JSON into ontology attributes
- promotion should store only compact canonical attributes needed for resolution and summarization
- oversized or structurally unclear facts must be skipped with a typed reason

## Runtime Prompt Policy

Runtime may inject a compact `[Ontology Context]` block, but only when useful.

Budget:

- maximum 8 lines
- maximum 800 characters total

Allowed content:

- canonical user/entity references
- concise preference, constraint, workflow, or goal summaries
- short relation hints

Not allowed in prompts:

- raw evidence
- alias lists
- large JSON attributes
- preview catalog data
- developer diagnostics
- plugin inspection output

If the summarizer cannot fit useful ontology context inside budget, it must omit the block entirely.

## Hot-Path Read/Write Policy

- runtime ontology reads are optional and fail-soft
- runtime ontology reads may be synchronous
- runtime ontology writes must not block the hot path
- v1 does not require automatic runtime writes on every turn
- promotion and bootstrap work should remain explicit, isolated, and safe to skip

## Developer MCP vs Runtime Context

Developer-facing ontology MCP surfaces exist for inspection and debugging.

- resources under `bizbot://ontology/*` describe schema, policies, and summaries
- narrow `developer_*` ontology tools inspect schema, search entities, preview context, explain alias resolution, and validate relation shape
- these surfaces are for humans and developer agents
- these surfaces are never direct runtime prompt sources

Runtime prompt summarization must call ontology services directly, not the MCP preview catalog.

## Lifecycle Policy

Ontology lifecycle status is intentionally simple in v1:

- active records may participate in lookup and runtime context
- inactive records remain persisted but are excluded from runtime context by default
- deprecated records remain persisted for history and inspection but are excluded from runtime context by default

For system- or bootstrap-derived ontology records:

- BizBot does not hard-delete them automatically when upstream source concepts disappear
- v1 marks them inactive or deprecated instead
- future cleanup can be handled through explicit maintenance flows, not implicit runtime deletion

## Bootstrap Policy

Bootstrap is optional and tiny in v1.

- static vocabulary is preferred over dynamic registry-wide import
- any bootstrap seeding must be fail-soft and non-blocking
- no more than 25 bootstrap entities total may be created in v1
- broad automatic import of plugin, tool, resource, or prompt catalogs into ontology is deferred

## Future Plugin Guidance

Future plugins should consume ontology services instead of inventing parallel semantic stores.

- use ontology APIs for canonical identity, preference, workflow, and constraint resolution
- do not create plugin-owned ontology tables or hidden semantic stores for the same concepts
- use developer-facing MCP ontology resources and tools for inspection during authoring
- keep runtime prompt composition separate from inspection/catalog surfaces

## Governance

Ontology schema and vocabulary changes are architecture-level changes.

- new scopes should not be added casually
- new entity and relation types should be reviewed for overlap with existing canonical concepts
- schema changes should update docs, tests, and MCP inspection resources together
- plugin authors should extend behavior through ontology services and review, not by creating parallel semantic stores
