# Sidecar Developer Guide

## Overview

BizBot Sidecar is a persistent right-edge split view, not a popup. It supports two separate concepts:

- Display state: collapsed or expanded in the client shell.
- Panel lifecycle state: whether an active panel exists for the current conversation on the server.

The chevron rail only collapses or expands the split view. It does not clear the active panel. Explicit close clears both client and server state.

## Core Flow

1. A tool returns a Sidecar result directly or embeds one under `_sidecar`.
2. The agent executor persists the conversation Sidecar stack and emits a `sidecar` stream event.
3. `useChat` forwards that stream event to the browser event bus.
4. `SidecarHost` opens the split view automatically and renders the top panel in the stack.
5. Interactive selection panels emit browser interaction events.
6. `useChat` posts those interactions to `/api/sidecar/interactions` and reports pending and error state through `bizbot:sidecar:interaction-state`.
7. The returned panel updates the split view and can replace or extend the stack.

## Manual Controls

- The right-edge chevron rail is always visible in the dashboard.
- Clicking the chevron expands or collapses the split view.
- The user can drag the divider to resize the split view width.
- Width is persisted locally across collapse, expand, and refresh.
- The explicit `close` button clears the active server-side panel via `/api/sidecar/state`.
- The `back` button pops the current panel and returns to the previous panel in the server-synced stack.
- Earlier stack chips are clickable and truncate the stack to the selected panel through `/api/sidecar/state`.

## Bootstrap And Restore

`ChatConversationBootstrap` includes both `activeSidecarPanel` and `activeSidecarStack` for the current conversation. `useChat` restores the whole stack on bootstrap so refresh and conversation switches can rehydrate Sidecar without losing navigation context.

## Panel Contract

`SidecarPanel` supports:

- `panelId`
- `title`
- `content`
- optional `persistence`: `ephemeral`, `sticky`, or `workflow`

Persistence semantics:

- `ephemeral`: transient overlay content. Opening a new ephemeral panel replaces any earlier ephemeral overlay, and ephemeral panels are not restored on bootstrap.
- `sticky`: durable reference context. Sticky panels stay eligible for bootstrap restore and can remain underneath workflow or ephemeral layers.
- `workflow`: active task context. Workflow panels participate in stack navigation and are restored on bootstrap.

Current renderers:

- `markdown`
- `code`
- `json`
- `image`
- `selection`
- `table`
- `key_value`
- `progress`
- `diff`

Stack semantics:

- `open` pushes a new panel onto the conversation stack.
- `update` replaces the top panel unless a full stack snapshot is provided.
- `close` clears the full conversation stack.
- `back` is implemented through `/api/sidecar/state` and pops the active panel on the server.
- `activate` is implemented through `/api/sidecar/state` and truncates the stack to a selected earlier panel.

Revision semantics:

- `activeSidecarStack` now includes `stackRevision` alongside `panels` and `activePanelId`.
- Every server-side stack mutation increments the conversation-local `stackRevision`.
- UI-initiated navigation requests send `expectedStackRevision` to `/api/sidecar/state`.
- If the request revision is stale, the route responds with `409` and the latest stack snapshot instead of applying the stale navigation intent.
- The client reconciles to that latest snapshot and surfaces a user-visible message rather than silently overwriting newer Sidecar state.

## Stack Policy Matrix

The current Sidecar stack policy is easier to reason about as a matrix than as prose. The table below describes the intended behavior for the current revisioned stack contract.

| Source | Intent | Active persistence | Incoming persistence | Expected stack effect | Restore behavior |
| --- | --- | --- | --- | --- | --- |
| Agent or tool | `open` | any | `ephemeral` | strip earlier ephemeral overlays, keep sticky and workflow context, append new ephemeral panel on top | not restored on bootstrap |
| Agent or tool | `open` | any | `workflow` | strip earlier ephemeral overlays, keep sticky and workflow context, append workflow panel on top | restored on bootstrap |
| Agent or tool | `open` | any | `sticky` | strip earlier ephemeral overlays, keep prior sticky and workflow context, append sticky panel on top | restored on bootstrap |
| Agent or tool | `update` | top panel | n/a | replace the matching panel when `panelId` already exists, otherwise replace the active panel | restored according to the panel's persistence |
| Agent or tool | `close` | `ephemeral` | n/a | dismiss only the active ephemeral overlay | remaining sticky or workflow stack restores normally |
| Agent or tool | `close` | `workflow` | n/a | dismiss the active workflow branch until the nearest underlying sticky panel or empty stack | remaining sticky context restores |
| Agent or tool | `close` | `sticky` | n/a | dismiss only the active sticky panel | any remaining stack restores normally |
| User | `back` | any multi-panel stack | n/a | pop only the active panel through `/api/sidecar/state` | resulting stack restores according to remaining panel persistence |
| User | `activate` | any multi-panel stack | n/a | truncate the stack to the selected earlier panel through `/api/sidecar/state` | resulting stack restores according to remaining panel persistence |
| User | explicit `close` button | any | n/a | clear the full conversation stack through `/api/sidecar/state` | nothing restores until a new panel opens |
| User | chevron collapse | any | n/a | no stack mutation; display state only | full restorable stack remains available |
| Bootstrap | restore | stack contains `ephemeral` | n/a | omit ephemeral panels from the restored stack snapshot | ephemerals never restore |
| Bootstrap | restore | stack contains `sticky` and `workflow` | n/a | restore sticky and workflow panels in preserved order | both restore |
| User navigation | stale `expectedStackRevision` | any | n/a | reject mutation with `409` and latest stack snapshot | latest server stack remains authoritative |

Concurrency notes:

- The authoritative stack lives on the server per conversation.
- The authoritative ordering key is `stackRevision`, not the order in which browser events arrive.
- Agent-driven Sidecar opens are allowed to race user navigation, but stale user navigation must not overwrite a newer server stack.
- The client may optimistically issue a navigation request, but reconciliation must always accept the latest server snapshot after conflict.
- Tool producers should assume that a user may have already navigated away from the panel that originated a request.

## Authoring Guidance

- Use Sidecar when a structured transient surface reduces transcript noise.
- Prefer `selection` for bounded user choices that should round-trip through server handlers.
- Use `markdown` for narrative summaries, not for faking tables or application controls.
- Use `table` for compact comparative data that users need to scan quickly.
- Use `key_value` for metadata inspection and structured summaries.
- Use `progress` for stepwise workflows, long-running activity, or approval pipelines.
- Use `diff` when showing before/after changes or patch previews.
- Use `json` only for raw structured inspection, not as a substitute for a richer renderer when one exists.
- Treat chevron collapse as display-only. Do not assume a collapsed panel has been closed.
- Use explicit close only when the workflow should truly dismiss the active panel.
- Push a new panel onto the stack when the user is drilling into a sub-view that should support an obvious return path.

### Persistence Guidance For Producers

- Use `ephemeral` for transient outputs that should not survive refresh, such as one-off verdicts, previews, or temporary overlays.
- Use `sticky` for durable reference context the user may want to keep around while exploring adjacent panels, such as profile briefs, source overviews, or reusable selectors.
- Use `workflow` for active multi-step tasks and review surfaces that should restore on bootstrap and participate in stack navigation.
- Prefer changing persistence only when the panel's role changes. Do not mark a transient result as `sticky` just to keep it visible after refresh.
- If a selection panel leads into a transient answer, the selector is usually `workflow` and the resulting answer is usually `ephemeral`.
- Keep persistence choices consistent within a plugin family so users can predict what survives refresh and what dismisses as they navigate.

## Interaction Guidance

- Register interaction handlers through the sidecar router.
- Keep action ids stable.
- Return a full next panel from handlers instead of mutating client state implicitly.
- Expect the host to show pending and inline error feedback for selection actions.
- When an interaction represents a drill-down, return a new panel so the stack gives the user back-navigation for free.

## SidecarContext Design

The current runtime does not yet implement a first-class `SidecarContext`, but nested panels now create enough structural pressure that the design should be explicit before plugin-specific ad hoc state passing spreads.

### Why A Context Object Exists

Once panels can open child panels or react to interactions across multiple stack levels, three requirements show up quickly:

- parent to child data passing without encoding parent state inside child panel ids or markdown
- child to parent updates without letting children replace arbitrary parent payloads
- stack-level shared state that survives panel replacement and truncation more cleanly than hidden renderer content

`stackRevision` solves stale navigation. It does not solve cross-panel authority. `SidecarContext` is the missing authority model.

### Proposed Contract

The smallest useful design is:

```ts
interface SidecarContext {
  contextId: string;
  conversationId: string;
  stackRevision: number;
  rootPanelId: string;
  activePanelId: string | null;
  values: Record<string, JsonValue>;
  capabilities?: string[];
}

interface SidecarPanelContextBinding {
  contextId: string;
  parentPanelId?: string;
  readKeys?: string[];
  writeKeys?: string[];
  returnChannel?: string;
}
```

And `SidecarPanel` would eventually grow an optional field such as:

```ts
context?: SidecarPanelContextBinding;
```

This keeps context state separate from renderer payloads while still letting each panel declare what it can read and what it is allowed to write.

### Authority Model

- The server owns `SidecarContext`, not the client.
- Context is scoped to a conversation and anchored to a stack lineage, not to a single renderer payload.
- A child panel may read inherited keys but should only write keys explicitly allowlisted in its binding.
- A child panel should never replace its parent panel payload directly. It should submit a bounded context patch or a named return action.
- Parent panels remain responsible for re-rendering themselves from authoritative context values.

### Parent To Child Flow

Recommended pattern:

1. Parent panel opens a child panel.
2. The child panel receives a `contextId`, `parentPanelId`, and a bounded set of `readKeys`.
3. The child reads only the context values it needs, such as `selectedMarketId`, `planFilters`, or `companyProfileId`.
4. The child renders from those values plus its own local content payload.

This avoids duplicating the parent's structured state inside the child payload.

### Placeholder Rendering Contract

Sidecar now supports a small context-rendering contract for content that is mostly static but needs authoritative workflow values injected at render time.

- `key_value` entries may declare `contextKey` to render a single entry value from the active context snapshot.
- `markdown`, `code`, and `table` content may embed placeholders in string fields using `{{contextKey}}`.
- Placeholders only resolve when the panel is bound to a matching `contextId` and the requested key is readable through `readKeys` or `selectionKey`.
- Missing, unreadable, or absent values render as empty strings rather than throwing on the client.
- Placeholder rendering is for display-time substitution, not computation. If a panel needs derived counts, summaries, or formatting rules, compute them on the server and store those derived values in context.

Current examples:

- Oracle market summaries render verdict details from `oracle.market.selection` through markdown placeholders such as `{{selectedMarketQuestion}}`.
- Creeper ingestion queued summaries render workflow details from `creeper.plan.review` through markdown placeholders such as `{{ingestionRunId}}` and `{{selectedTableSummary}}`.

Recommended producer rules for placeholders:

- Keep placeholder keys stable and semantic.
- Prefer short derived context values like `selectedTableSummary` over trying to render raw arrays into prose.
- Use placeholders for text-like surfaces only; keep structured interaction state in explicit content fields and context patches.
- Do not use placeholders to smuggle writable state into non-interactive panels.

### Child To Parent Flow

Recommended pattern:

1. Child interaction posts a named action or a context patch through the Sidecar interaction route.
2. The server validates `contextId`, `stackRevision`, and `writeKeys`.
3. The server applies a bounded update to `SidecarContext.values`.
4. The server returns a fresh panel or stack snapshot derived from the updated authoritative context.

This keeps child panels from becoming implicit parent renderers.

### Stack-Level Context

Not every value belongs to a single panel. A context object is the right place for values like:

- selected entity ids
- current workflow mode
- plan filters and sorting
- comparison targets
- temporary draft edits
- interaction-derived derived metadata that multiple panels need

Values that belong purely to one renderer and never need to outlive that panel should stay in panel content, not in `SidecarContext`.

### Revision Interaction

`SidecarContext` should ride on the same revision model as the stack:

- every context mutation should either increment `stackRevision` or carry a separate `contextRevision`
- child writes should include the expected revision they were based on
- stale writes should be rejected with the same conflict pattern used by `/api/sidecar/state`
- the server should return a latest authoritative snapshot after conflict so the client can reconcile instead of guessing

If context and stack start diverging independently, split them into `stackRevision` and `contextRevision`. Until then, using the same revision boundary keeps the concurrency model simpler.

### Recommended Producer Rules

- Use context for structured workflow state, not for presentation text.
- Use panel content for the current visible representation of that state.
- Child panels should declare bounded read and write scope.
- Selection-style child panels are good candidates for patching context rather than returning giant replacement payloads.
- If a child result is purely transient, keep it `ephemeral` even when it depends on shared context.
- If a child edits a durable task state, it should usually live in a `workflow` branch backed by context.

### What To Implement Next

The next concrete implementation slice after the current `stackRevision` work should be:

1. add `SidecarContext` and `SidecarPanelContextBinding` types
2. persist a per-conversation context object in server-side Sidecar state
3. teach the interaction route to accept bounded context patches
4. return updated stack and context snapshots together from server-side Sidecar mutations
5. add focused tests for stale child writes, bounded write-key enforcement, and parent re-render after child patch application

## Triggers And Close Semantics

- Automatic open: any validated sidecar tool result or `_sidecar` payload emitted by the agent.
- Manual open: the chevron rail expands the split view even when no active panel exists.
- Collapse: hides the split view locally but keeps the stack alive.
- Explicit close button: clears the full server-side conversation stack and hides the split view.
- Sidecar `close` actions flowing through the shared reducer dismiss according to the active panel policy: ephemeral closes only the overlay, workflow closes the active workflow branch, and sticky closes the active sticky panel.
- Refresh or conversation switch: bootstrap rehydrates the stack for the active conversation.

## Capabilities

- Persistent right-edge split view with manual resize.
- Automatic agent-driven open when structured context is useful.
- Manual reopen through an always-visible chevron rail.
- Server-synced close and back navigation.
- Clickable stack-chip navigation to earlier panels.
- Persistence-aware close and restore behavior for ephemeral, sticky, and workflow panels.
- Built-in renderers for narrative, code, structured inspection, image preview, bounded selection, tables, key-value summaries, progress, and diffs.
- Selection interactions with pending and inline error state.

## Limitations

- Only one Sidecar shell is visible at a time, even though it can now carry a stack of panels.
- Stack navigation supports back and truncation to earlier panels, but not arbitrary multi-tab or split-panel navigation.
- Sticky and workflow panels both restore on bootstrap; the difference today is about task semantics and close behavior, not separate rendering shells.
- Renderer set is richer now, but still intentionally bounded to validated BizBot-owned primitives.
