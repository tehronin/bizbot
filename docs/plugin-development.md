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

The builtin `memory` plugin exposes two distinct memory surfaces under the shared `memory_` prefix:

- semantic memory tools for recall and search: `memory_remember`, `memory_recall`
- explicit relational user memory tools for stable facts: `memory_get_facts`, `memory_set_fact`, `memory_forget_fact`

Keep these layers separate. Explicit user memory is for durable, user-approved facts and should not be used as hidden profiling or as a substitute for graph or RAG retrieval.

## Creating a Plugin

Run:

```bash
npm run plugin:new -- my-plugin
```

This scaffolds:

- `src/lib/agent/plugins/MyPluginPlugin.ts`
- `tests/plugins/my-plugin.test.ts`

After scaffolding, wire the plugin into the builtin registry if it is meant to ship with BizBot.

The scaffold now includes:

- stronger metadata placeholders
- a starter schema with `additionalProperties: false`
- starter tests for metadata, registry compatibility, schema presence, and happy-path execution
- reminders to run naming and contract-impact checks before shipping

## MCP Authoring Loop

BizBot's MCP surface is a first-class plugin design, validation, preview, and testing loop for advanced users.

Use these developer tools while iterating:

- `developer_plan_plugin`
- `developer_check_tool_naming`
- `developer_inspect_plugin_registry`
- `developer_inspect_plugin`
- `developer_validate_plugin_contract`
- `developer_preview_mcp_exposure`
- `developer_preview_tool_descriptor`
- `developer_preview_prompt`
- `developer_preview_resource`
- `developer_suggest_plugin_tests`
- `developer_check_mcp_contract_impact`

Use these resources when you want structured reports instead of ad hoc code spelunking:

- `bizbot://plugins/registry-report`
- `bizbot://plugins/naming-rules`
- `bizbot://plugins/authoring-checklist`
- `bizbot://plugins/mcp-surface-preview`
- `bizbot://plugins/contracts-status`

This loop is intentionally high-trust and power-user oriented. The goal is more inspectability and faster iteration, not less power.

## Naming Conventions

- Use lowercase snake_case tool names.
- Keep a stable namespace prefix aligned with the plugin id where practical.
- Follow existing BizBot namespaces such as `crm_`, `memory_`, `builder_`, `developer_`, and `local_business_`.
- Prefer explicit verb phrases such as `inspect`, `preview`, `list`, `get`, `create`, `update`, `sync`, `suggest`, or `check`.
- Avoid vague names such as `get_data`, `run_task`, or `do_thing`.
- Keep imported MCP tools clearly distinguishable by preserving the `mcp_<server>_` prefix.

## Preview Workflow

Before relying on a plugin in the runtime:

1. inspect the registry with `developer_inspect_plugin_registry`
2. inspect or validate the specific plugin with `developer_inspect_plugin` and `developer_validate_plugin_contract`
3. preview MCP-facing tools, prompts, and resources
4. check contract impact against current catalogs
5. add or update plugin tests before wiring the plugin into the builtin registry

Prompt and resource catalogs remain server-owned today, so plugin work changes those catalogs only when `src/lib/mcp/server.ts` or the shared preview catalog is updated alongside the plugin.

## Contract Verification Workflow

- Use `developer_check_mcp_contract_impact` to see which tool names a plugin contributes and which MCP tests to review.
- Keep `tests/mcp/contracts.test.ts` authoritative for `tools/list`, `prompts/list`, and `resources/list` snapshots.
- Use `tests/mcp/http-route.test.ts` when you need route-level confidence for prompt/resource reads or tool calls.
- For imported MCP overlap, inspect provenance through the registry report before choosing builtin tool names.

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

## Builder Lane Safety

The builtin `builder` plugin is intentionally stricter than the generic workspace file tools.

- It uses `BIZBOT_BUILDER_WORKSPACE_PATH` for a dedicated external workspace.
- If that workspace overlaps the BizBot repository, builder file and command tools fail closed.
- Command execution is opt-in through `BIZBOT_BUILDER_ALLOWED_COMMANDS` and runs without shell expansion.

This keeps Builder Mode suitable for scaffolding or codegen work without giving the lane permission to mutate the BizBot repo itself.

## Design Guidance

- Prefer narrow, composable tools over giant multi-purpose tools.
- Keep parameter schemas strict.
- Use stable prefixes.
- Expose resources when data is inspectable, not action-oriented.
- Treat plugin docs and tests as part of the public API.
- Prefer warnings and diagnostics over surprise runtime collisions during authoring.
