# Plugin Development

This repository now has a formal BizBot plugin contract for agent and MCP-facing tools.

## Goals

- Make plugin authoring explicit instead of relying on central runtime edits
- Keep tool schemas stable and testable
- Support future open-source plugin contributors with scaffolding and fixtures

## Plugin Contract

Use `createBizBotPlugin` from `src/lib/agent/plugins/contracts.ts`.

A plugin includes:

- metadata
- a list of registered tools

Builtin plugins are normalized through `wrapBuiltinPlugin`, and the runtime registry lives in `src/lib/agent/plugins/registry.ts`.

## Creating a Plugin

Run:

```bash
npm run plugin:new -- my-plugin
```

This scaffolds:

- `src/lib/agent/plugins/MyPluginPlugin.ts`
- `tests/plugins/my-plugin.test.ts`

After scaffolding, wire the plugin into the builtin registry if it is meant to ship with BizBot.

## Testing Strategy

BizBot plugin development uses three layers of tests:

1. Contract tests for plugin metadata and tool exposure
2. Registry tests for duplicate ids and duplicate tool names
3. Fixture-based integration tests for provider-style plugins

MCP-facing behavior is also covered by transport and contract tests for:

- tools/list and tools/call
- resources/list and resources/read
- prompts/list and prompts/get
- auth failures and malformed transport payloads
- imported external MCP tool registration through the plugin registry
- imported external MCP resource and prompt catalog discovery through `src/lib/mcp/client.ts`
- Streamable HTTP and legacy SSE fallback for imported MCP servers

Run:

```bash
npm run test
npm run test:mcp
```

## Fixture-Based Provider Tests

Use the fixture helpers under `tests/fixtures` to model provider behavior without real external services.

The goal is to test:

- argument validation
- tool execution shape
- provider call sequencing
- deterministic outputs

Avoid live HubSpot, Google Business, Meta, or Twitter calls in plugin tests.

## MCP Transport Hygiene

Stdio MCP transport must remain clean JSON-RPC.

- Do not print debug logs to stdout.
- Avoid query-level Prisma logging in stdio mode.
- Route operational logs to non-protocol sinks when testing MCP transports.

`scripts/mcp-stdio.mjs` now configures stdio-specific environment flags so query logs do not pollute the MCP stream.

The MCP HTTP test suite also snapshots the exported prompt and resource catalogs so OSS-facing wording drift is caught early.

The prompt catalog now includes `inspect-agent-run`, which requires `runId` and is intended as the template for prompts that should fail fast on missing arguments.

For imported MCP tools, mirror the pattern in `tests/mcp/client.integration.test.ts`:

- stand up a minimal fixture server
- test both Streamable HTTP and SSE fallback where relevant
- verify imported tools merge into the registry as `external-mcp`
- verify imported resource and prompt catalogs can be listed and fetched through the client wrapper
- assert remote `isError` payloads and non-JSON text payloads are unwrapped correctly

## External Transport Compatibility

BizBot currently imports external MCP servers over these transports:

| Transport | Support | Notes |
| --------- | ------- | ----- |
| Streamable HTTP | Yes | Primary import path used by `src/lib/mcp/client.ts` |
| Legacy SSE | Yes | Automatic fallback when Streamable HTTP connect/setup fails |
| Stdio | No | BizBot exposes stdio itself, but does not embed arbitrary external stdio servers into the app runtime |

Current external import behavior:

- tools are surfaced into the BizBot runtime today
- resource and prompt catalogs are cached and tested for future surfacing
- fallback remains one-way: Streamable HTTP first, then SSE

## Design Guidance

- Prefer narrow, composable tools over giant multi-purpose tools.
- Keep parameter schemas strict.
- Use stable prefixes.
- Expose resources when data is inspectable, not action-oriented.
- Treat plugin docs and tests as part of the public API.
