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
