# Contributing

BizBot is moving toward an open plugin-oriented architecture. Start with [docs/plugin-development.md](docs/plugin-development.md) before adding new MCP tools or agent plugins.

## Expectations

- Keep plugin boundaries explicit.
- Prefer fixture-based tests over live provider calls.
- Do not write logs to stdio MCP protocol streams.
- Treat tool schemas as public contracts once exposed.
- Keep MCP prompt and resource wording stable unless a documented contract change is intentional.

## Core Commands

- `npm run build`
- `npm run test`
- `npm run test:app`
- `npm run test:mcp`
- `npm run lint:docs`
- `npm run plugin:new -- <plugin-name>`

## Pull Requests

- Include tests for every new plugin tool.
- Add or update plugin docs when public behavior changes.
- Update MCP contract tests when changing exported tools, resources, prompts, or transport semantics.
- Keep the dedicated `mcp-suite` CI job green when touching MCP transports, prompts, resources, or external client import code.
- Preserve backwards compatibility for public MCP tool names unless a breaking change is intentional and documented.
