# BizBot

BizBot is a local-first desktop social media agent built for supervised, policy-aware content operations.

The core idea is simple:

- run the UI locally as a desktop app
- connect to one or more LLM providers
- draft, refine, schedule, approve, and publish social content
- keep memory in both semantic search and graph form
- enforce brand voice and posting guardrails before anything goes live

This repository is designed around a Docker-backed runtime on a properly provisioned machine. On this work PC, the codebase has been taken as far as possible in build and implementation terms without standing up Docker, Postgres, pgvector, or Memgraph locally.

## Current Status

Current code status:

- TypeScript build passes
- Next.js production build passes
- Tauri project scaffold is in place
- Core API surface is implemented
- Dashboard and onboarding UI are implemented
- Agent tool registry and function-calling flow are implemented
- Prisma schema, Docker Compose, and runtime configuration are present

Current runtime status:

- full end-to-end execution still requires Docker and service setup on another machine
- social provider credentials still need to be added in a real `.env`
- database migrations / startup need to be run on the target machine

## Product Goals

BizBot is intended to act as a controlled local operator for social publishing and research workflows.

Primary goals:

- local desktop interface instead of a browser-only SaaS product
- multi-provider LLM support
- persistent memory across conversations and content decisions
- approval workflows before posting
- social platform abstraction instead of platform-specific UI everywhere
- brand and safety guardrails before publication
- support for future autonomous browsing and research flows

## Key Features

### Agent Layer

- typed function-based tool calling
- unified tool registry for content, memory, graph, files, browser, approvals, and scheduling
- multi-step tool-use loop via the API agent route
- explicit effort to avoid ambiguous tool contracts and loose runtime shapes

### Multi-Provider LLM Support

- OpenAI
- Anthropic
- Ollama
- Google via OpenAI-compatible endpoint strategy
- MiniMax via OpenAI-compatible endpoint strategy

### Social Operations

- draft content for platform-specific constraints
- post content to supported platforms
- reply to posts
- fetch mentions
- fetch analytics

Currently modeled platforms:

- Twitter/X
- Facebook
- Instagram

### Approval Workflow

- submit posts for review
- fetch pending approvals
- approve or reject queued content
- preserve a path for future auto-approval rules

### Memory and Knowledge

- long-term semantic memory in PostgreSQL with pgvector
- graph-based context in Memgraph
- conversation storage for session continuity
- hybrid context-building for agent prompts

### Browser Capability

- Playwright-powered browsing engine
- screenshot capture
- text extraction
- link extraction
- cookie/session persistence
- allowlist-based browser safety controls

### Desktop UX

- Tauri v2 desktop shell
- Next.js App Router UI
- onboarding flow
- dashboard pages for chat, posts, approvals, analytics, and settings
- stealth visual style with Inter and JetBrains Mono, square edges, and no pure black surfaces

## Tech Stack

### Frontend / Desktop

- Next.js 16.2.1
- React 19
- TypeScript
- Tailwind CSS 4
- Tauri v2

### Backend / Runtime

- Next.js App Router route handlers
- Prisma 6.16.2
- PostgreSQL
- pgvector
- Memgraph via `neo4j-driver`
- Playwright

### AI / Integrations

- OpenAI SDK
- Anthropic SDK
- Twitter API v2
- Meta Graph API via Axios

## Architecture Overview

The project is split into four main layers.

### 1. Desktop and UI Layer

- Tauri wraps the app as a desktop client
- Next.js renders the interface and handles app routes
- dashboard pages provide supervised operator workflows

### 2. Agent Layer

- the agent route receives user requests
- prompt context is assembled from conversation history, semantic memory, and graph context
- the kernel calls an LLM provider
- if tool calls are returned, BizBot executes typed functions and feeds results back into the loop

### 3. Data Layer

- Prisma models operational entities like posts, approvals, settings, conversations, and analytics
- pgvector stores embeddings for semantic recall
- Memgraph stores entities, topics, and relationships for graph recall

### 4. Safety / Policy Layer

- content policy checks run before publishing
- brand voice evaluation is supported
- browser actions use allowlist enforcement
- approval routing exists for human review before live actions

## Implemented Pages

### Dashboard Pages

- `/chat`
- `/posts`
- `/approvals`
- `/analytics`
- `/settings`

### Onboarding Pages

- `/onboarding`
- `/onboarding/llm`
- `/onboarding/platforms`
- `/onboarding/policies`
- `/onboarding/complete`

## Implemented API Routes

- `POST /api/agent`
- `GET /api/analytics`
- `GET /api/approvals`
- `PATCH /api/approvals/[id]`
- `GET /api/files`
- `POST /api/files`
- `DELETE /api/files`
- `GET /api/onboarding`
- `POST /api/onboarding`
- `GET /api/posts`
- `POST /api/posts`
- `GET /api/settings`
- `PATCH /api/settings`
- `GET /api/social/[platform]`
- `POST /api/social/[platform]`

## Data Model

Main Prisma models include:

- `User`
- `Platform`
- `Post`
- `PostApproval`
- `Conversation`
- `Message`
- `Memory`
- `Policy`
- `ScheduleRule`
- `AnalyticsSnapshot`
- `Setting`
- `BrowserSession`
- `BrowserAction`

This gives the app a clean operational model for:

- content creation
- review state
- memory and context
- policies
- browser auditability
- analytics snapshots

## Repository Structure

High-level structure:

```text
bizbot/
	src/
		app/                    Next.js pages and API routes
		components/             Layout and UI components
		hooks/                  Frontend hooks for chat, posts, approvals
		lib/
			agent/                Kernel, tools, plugins, memory orchestration
			browser/              Playwright engine, safety, sessions
			embeddings/           Embedding generation and vector search
			files/                Workspace file access helpers
			graph/                Memgraph client and queries
			policies/             Guardrails and brand voice enforcement
			social/               Twitter, Facebook, Instagram adapters
	prisma/
		schema.prisma           Main database schema
		migrations/             SQL for pgvector setup
	src-tauri/                Tauri desktop wrapper
	docker-compose.yml        Postgres + Memgraph services
	.env.example              Example environment configuration
```

## Environment Variables

Use `.env.example` as the starting point.

Important groups:

### Database

- `DATABASE_URL`
- `MEMGRAPH_URI`
- `MEMGRAPH_USER`
- `MEMGRAPH_PASSWORD`

### LLM Providers

- `ACTIVE_LLM_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `GOOGLE_AI_API_KEY`
- `GOOGLE_MODEL`
- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`
- `MINIMAX_MODEL`

### Social Platforms

- `TWITTER_APP_KEY`
- `TWITTER_APP_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`
- `TWITTER_USER_ID`
- `FACEBOOK_PAGE_ID`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `META_ACCESS_TOKEN`

### Local Workspace

- `BIZBOT_WORKSPACE_PATH`

## Local Development Commands

### Install Dependencies

```bash
npm install
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Type Check

```bash
npx tsc --noEmit
```

### Build the Web App

```bash
npm run build
```

### Run Next.js Dev Server

```bash
npm run dev
```

### Run Tauri Desktop App

```bash
npm run tauri:dev
```

## Docker Runtime

This repository is designed around Docker-based infrastructure.

Services defined in [docker-compose.yml](docker-compose.yml):

- PostgreSQL 16 with pgvector
- Memgraph Platform

Expected bring-up flow on a correctly provisioned machine:

```bash
docker compose up -d
npx prisma generate
npx prisma db push
npm run build
npm run tauri:dev
```

## What Was Verified On This Machine

Verified here:

- dependency installation
- Prisma client generation
- TypeScript compilation
- Next.js production build
- implementation of the app structure and routes

Not verified here:

- Docker service startup
- live Postgres connection
- live Memgraph connection
- end-to-end Tauri runtime with backing services
- real credentialed social platform calls

That separation is intentional. This repo is in a state suitable for upload and continuation on a machine with Docker and the proper runtime environment.

## Known Limitations

- the current root of truth for live execution is still the Docker-backed design
- social platform integrations are implemented structurally but still need real credentials and live testing
- browser-assisted social actions remain experimental and policy-sensitive
- the file route produces a Turbopack tracing warning because of filesystem access patterns, but the app still builds successfully

## Security Notes

- `.env` is ignored by git and should not be committed
- browser access is intended to be allowlist-controlled
- posting should go through approval workflows in real use
- this is a local operator tool, not a public multi-tenant service

## Upload / Handoff Workflow

This repo is intended to be uploaded now and continued later on a better-provisioned machine.

Suggested sequence:

1. initialize git in this folder
2. commit the codebase
3. push to the remote repository
4. clone it on the target machine
5. install Docker and required local tooling there
6. continue runtime integration and service validation there

## Next Steps On The Target Machine

Recommended continuation order:

1. bring up Docker services
2. run Prisma schema sync / migration commands
3. seed initial settings and platform rows if needed
4. verify onboarding flow with a live database
5. verify agent tool execution end-to-end
6. verify social providers individually
7. verify Tauri desktop packaging

## License / Ownership

No license file has been added in this repository yet. Add one if you want to make the usage terms explicit before wider sharing.
