# Sidecar v2

Sidecar is a BizBot-owned transient output and interaction surface. Plugins can supply validated content and consume validated user intent, but they do not own DOM, callbacks, or browser execution.

## Core Rules

- Sidecar is core app infrastructure, not a builtin plugin.
- Sidecar remains transient. It is not a source of durable truth.
- Plugins may provide data payloads, but BizBot owns rendering, event dispatch, and routing.
- Sidecar interaction payloads are bounded structured inputs only. No plugin-defined JavaScript, callback names, or arbitrary metadata blobs are allowed.

## Content Model

Current supported Sidecar content types:

- `markdown`
- `code`
- `json`
- `image`
- `selection`

The `selection` type is the new generic interactive primitive. It is intentionally reusable and not tied to Oracle.

Selection payload shape:

```json
{
  "type": "selection",
  "title": "Choose one",
  "description": "Optional explanatory copy.",
  "selectionMode": "single",
  "items": [
    {
      "id": "balanced",
      "title": "Balanced",
      "description": "Neutral and evidence-weighted."
    }
  ],
  "selectedItemIds": ["balanced"],
  "actions": [
    {
      "id": "oracle_personality_toggle",
      "label": "Choose",
      "kind": "toggle"
    },
    {
      "id": "oracle_personality_apply",
      "label": "Save personality",
      "kind": "apply"
    }
  ],
  "interaction": {
    "routeKey": "oracle.personality.select"
  }
}
```

Validation rules stay strict:

- `additionalProperties: false` at the tool schema boundary
- stable alphanumeric ids for panels, items, and actions
- bounded item counts and action counts
- selection state must reference known item ids only
- single-select panels can carry at most one selected item

## Server-Side Panel Registry

BizBot now keeps a transient in-memory registry of active Sidecar panels.

Implementation location:

- `src/lib/sidecar/state.ts`

Registry behavior:

- Panels are scoped by `conversationId`.
- Only one panel is active per conversation.
- `sidecar_open` registers or replaces the active panel for that conversation.
- `sidecar_update` replaces the stored panel payload for that conversation.
- `sidecar_close` clears the active panel for that conversation.
- The registry is process-local and in-memory only.

What this means operationally:

- The registry is safe for transient UI routing, not durable workflow state.
- A full app restart, server reload, or process replacement clears the registry.
- Durable user choices must be persisted somewhere else, such as explicit user memory.
- Plugins must not assume a previously opened panel still exists after refresh or restart.

Why the registry exists:

- It lets the server validate that an interaction belongs to the current active panel.
- It keeps the interaction path structured instead of injecting synthetic chat turns.
- It gives the core app a place to enforce conversation scoping and safe routing.

## Interaction Contract

In-app UI interactions are sent as bounded structured requests to `/api/sidecar/interactions`.

Request shape:

```json
{
  "panelId": "panel-123",
  "actionId": "oracle_personality_apply",
  "selectedItemIds": ["balanced"],
  "conversationId": "conversation-123"
}
```

Rules:

- `panelId` must match an active panel in the registry.
- `conversationId` must match the conversation that owns that panel.
- `actionId` must match one of the panel's declared actions.
- `selectedItemIds` must be a bounded list of known item ids.
- The route handler may update the panel, replace the panel with another payload, or close it.

## Routing Model

BizBot owns the interaction router in `src/lib/sidecar/router.ts`.

The router resolves:

1. active panel
2. conversation scoping
3. selection payload validity
4. registered route handler by `routeKey`

Plugins may register route handlers, but they register against a BizBot-owned contract. They do not attach browser callbacks directly.

## Reuse Guidance

If a future plugin needs interactive Sidecar behavior:

1. Use the generic `selection` content type first.
2. Keep panel ids, item ids, and action ids stable.
3. Register a route handler that consumes structured selection state.
4. Persist durable outcomes outside Sidecar.
5. If Sidecar needs a new primitive, add it as a platform feature first, then consume it from the plugin.

## Transcript Behavior

Sidecar continues to emit a dedicated `sidecar` stream event rather than mutating the main chat transcript shape.

- `tool_result` remains string-based for transcript compatibility.
- Structured panel payloads stay on the dedicated Sidecar event path.
- Structured user interaction results come back through the Sidecar interaction route, not through fake user chat messages.
