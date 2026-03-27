# BizBot

BizBot is a local-first desktop social media agent for automated customer engagement, content publishing, and inbox management across Facebook, Instagram, and Twitter/X.

## What It Does

- **Monitors DMs** — polls Facebook Messenger, Instagram DMs, and Twitter DMs on a configurable heartbeat interval
- **Auto-replies** — generates context-aware replies using any configured LLM provider, guided by brand-voice policies and a local knowledge folder
- **Publishes social posts** — drafts, schedules, and publishes content with platform-specific formatting (character limits, media rules)
- **Approval workflow** — posts can be auto-published or routed through a human approval queue depending on autonomy preset
- **Unified inbox** — social mentions and DMs from all platforms land in a single inbox with status tracking (open → processing → drafted → replied → dismissed)
- **Knowledge-backed context** — drop product docs, FAQs, or sales materials into the `knowledge/` folder and the agent uses them when composing replies

## Current Status

**Runtime is fully operational on localhost:**

- `npm run dev` launches the full stack (Next.js + BullMQ worker) via a single unified supervisor
- PostgreSQL, Redis, and Memgraph run via Docker Compose
- Google Gemini is the active LLM provider (chat: `gemini-3-flash-preview`, embeddings: `gemini-embedding-2-preview`)
- Heartbeat worker syncs inbox, publishes scheduled posts, and processes open DMs every 5 minutes
- Health endpoint at `/api/llm` reports full system status
- Next.js 16.2.1 production build passes (standalone output for Tauri packaging)
- Tauri v2 desktop packaging pipeline is wired and staged

**What still needs real credentials / testing:**

- Facebook Graph API: requires `META_ACCESS_TOKEN` + `FACEBOOK_PAGE_ID` (and Meta App Review for production Messenger access)
- Twitter API: requires OAuth tokens
- Instagram API: requires `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- Live DM send/receive validation against real accounts

## Goals

- Local desktop app — not a browser-only SaaS product
- Multi-provider LLM support (swap between OpenAI, Anthropic, Google, Ollama, MiniMax)
- Persistent memory across conversations (semantic vector + graph)
- Approval workflows and brand/safety guardrails before anything goes live
- Platform abstraction — one inbox, one posting pipeline for all networks
- Autonomous browsing and research capability via Playwright

## Key Features

### Social Platform Support

| Platform | Post | Reply | Read Mentions | Read DMs | Send DMs | Analytics |
|----------|------|-------|---------------|----------|----------|-----------|
| Facebook | Yes  | Yes   | Yes           | Yes      | Yes      | Yes       |
| Instagram| Yes  | Yes   | Yes           | Yes      | Yes      | Yes       |
| Twitter/X| Yes  | Yes   | Yes           | Yes      | Yes      | Yes       |

All three platforms are implemented via their official APIs (Meta Graph API v21.0, Twitter API v2). A Playwright-based browser adapter for Facebook also exists for scenarios where API access is limited.

### Agent Tools

The agent exposes typed function-calling tools organized as plugins:

| Plugin | Tools |
|--------|-------|
| Social | `social_post`, `social_reply`, `social_get_mentions`, `social_get_analytics` |
| Content | `content_draft`, `content_refine`, `content_check_policy` |
| Memory | recall, remember, semantic search |
| Files | workspace file read/write |
| Graph | Memgraph entity/relationship queries |
| Schedule | `schedule_post`, `schedule_list`, `schedule_cancel` |
| Approval | `approval_submit`, `approval_get_pending`, `approval_decide` |
| Browser | web navigation, screenshot, text/link extraction |

### Autonomy Presets

| Preset | Create Posts | Reply to DMs | Publish Without Approval |
|--------|-------------|--------------|--------------------------|
| `manual_only` | No | No | No |
| `reply_only` | No | Yes | Yes (replies only) |
| `approval_all_posts` | Yes | Yes | No — queued for review |
| `wide_open` | Yes | Yes | Yes |

Current default: `approval_all_posts`

### LLM Providers

| Provider | Chat | Embeddings | Status |
|----------|------|------------|--------|
| Google Gemini | `gemini-3-flash-preview`, `gemini-2.5-flash` | `gemini-embedding-001`, `gemini-embedding-2-preview` | Active default |
| OpenAI | `gpt-4o`, `gpt-4.1-mini` | `text-embedding-3-small`, `text-embedding-3-large` | Supported |
| Anthropic | `claude-3-5-sonnet`, `claude-3-7-sonnet` | — | Supported |
| Ollama | `gemma3`, `llama3.2` | `mxbai-embed-large`, `nomic-embed-text` | Supported |
| MiniMax | `abab6.5s-chat` | — | Supported |

### Memory and Knowledge

- **Semantic memory** — pgvector embeddings in PostgreSQL for long-term recall
- **Graph memory** — Memgraph stores entities, topics, and relationships
- **Conversation history** — stored per-session for continuity
- **Knowledge folder** — drop `.txt`, `.md`, or other docs into `workspace/knowledge/`; they get chunked, embedded, and used as context in replies and drafts

### Heartbeat Worker

A BullMQ-based background worker runs on a configurable interval (default: 5 minutes):

1. Indexes knowledge folder into pgvector embeddings
2. Syncs mentions from all social platforms into the inbox
3. Syncs DMs from all platforms into the inbox
4. Publishes approved/scheduled posts that are due
5. Auto-processes open inbox items (generates and sends replies)

### Browser Capability

- Playwright-powered navigation, screenshot, and text extraction
- Cookie/session persistence per domain
- Allowlist-based safety controls
- Experimental Facebook browser adapter (login + post)

### Desktop App

- Tauri v2 desktop shell with process supervision
- Packaged build bundles Next.js standalone server + worker into app resources
- Tauri runtime manages Node child processes (server + worker) with coordinated shutdown
- App home directory (`BIZBOT_HOME_DIR`) resolves paths for packaged vs dev modes

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri v2 |
| Frontend | Next.js 16.2.1, React 19, Tailwind CSS 4, TypeScript |
| API | Next.js App Router route handlers |
| Worker | BullMQ on Redis |
| ORM | Prisma 6.16.2 |
| Database | PostgreSQL 16 + pgvector |
| Graph | Memgraph via `neo4j-driver` |
| Cache/Queue | Redis 7 |
| AI SDKs | OpenAI, Anthropic, Axios (Meta/MiniMax) |
| Social | Twitter API v2, Meta Graph API v21.0 |
| Browser | Playwright |
| Bundling | esbuild (worker), Next.js standalone (server) |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Tauri v2 Desktop Shell (or browser at localhost:3000)│
├──────────────────────────────────────────────────────┤
│  Next.js App Router                                   │
│  ├─ Dashboard: /chat /inbox /posts /approvals         │
│  │             /analytics /settings                   │
│  ├─ Onboarding: /onboarding/llm /platforms /policies  │
│  └─ API Routes: /api/agent /api/llm /api/inbox ...    │
├──────────────────────────────────────────────────────┤
│  Agent Kernel                                         │
│  ├─ Multi-step tool-calling loop                      │
│  ├─ Plugin registry (social, content, memory, etc.)   │
│  └─ Context assembly (conversation + vector + graph)  │
├──────────────────────────────────────────────────────┤
│  BullMQ Heartbeat Worker                              │
│  ├─ Inbox sync (mentions + DMs)                       │
│  ├─ Post publisher                                    │
│  ├─ Knowledge indexer                                 │
│  └─ Auto-reply processor                              │
├──────────────────────────────────────────────────────┤
│  Data Layer                                           │
│  ├─ PostgreSQL + pgvector (models, embeddings)        │
│  ├─ Memgraph (graph memory)                           │
│  └─ Redis (BullMQ job queue)                          │
└──────────────────────────────────────────────────────┘
```

## Pages

**Dashboard:** `/chat`, `/inbox`, `/posts`, `/approvals`, `/analytics`, `/settings`

**Onboarding:** `/onboarding`, `/onboarding/llm`, `/onboarding/platforms`, `/onboarding/policies`, `/onboarding/complete`

## API Routes

- `POST /api/agent`
- `GET /api/agent/heartbeat`
- `POST /api/agent/heartbeat`
- `GET /api/agent/heartbeat/service`
- `POST /api/agent/heartbeat/service`
- `GET /api/analytics`
- `GET /api/approvals`
- `PATCH /api/approvals/[id]`
- `GET /api/files`
- `POST /api/files`
- `DELETE /api/files`
- `GET /api/inbox`
- `POST /api/inbox`
- `PATCH /api/inbox/[id]`
- `GET /api/llm`
- `GET /api/onboarding`
- `POST /api/onboarding`
- `GET /api/posts`
- `POST /api/posts`
- `GET /api/settings`
- `PATCH /api/settings`
- `GET /api/social/[platform]`
- `POST /api/social/[platform]`

## Data Model

16 Prisma models: `User`, `Platform`, `Post`, `PostApproval`, `Conversation`, `Message`, `Memory`, `Policy`, `ScheduleRule`, `AnalyticsSnapshot`, `Setting`, `InboxMessage`, `BrowserSession`, `BrowserAction`

## Repository Structure

```
bizbot/
  src/
    app/                      Next.js pages and API routes
    components/               Layout and UI components
    hooks/                    Frontend hooks
    lib/
      agent/                  Kernel, tools, plugins, heartbeat, knowledge
      browser/                Playwright engine, safety, sessions
      embeddings/             Embedding generation and vector search
      files/                  Workspace file helpers
      graph/                  Memgraph client
      policies/               Guardrails and brand voice
      social/                 Twitter, Facebook, Instagram adapters
        browser/              Playwright-based social adapters
  prisma/
    schema.prisma             Database schema
    migrations/               SQL migrations (pgvector setup)
  scripts/
    run-stack.mjs             Unified process supervisor (dev + start)
    server-bootstrap.cjs      CJS bootstrap for packaged runtime
    prepare-tauri-resources.mjs  Bundles standalone server + worker for Tauri
  src-tauri/                  Tauri v2 desktop wrapper (Rust)
  docker-compose.yml          Redis + PostgreSQL + Memgraph
  .env.example                Environment variable template
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- (Optional) Rust toolchain for Tauri desktop builds

### 1. Start Infrastructure

```bash
docker compose up -d
```

This starts Redis, PostgreSQL (with pgvector), and Memgraph.

### 2. Install Dependencies and Set Up Database

```bash
npm install
cp .env.example .env     # then edit .env with your credentials
npx prisma generate
npx prisma db push
```

### 3. Run the App

```bash
npm run dev
```

This single command starts both the Next.js dev server and the BullMQ worker via the unified supervisor. Open `http://localhost:3000`.

### 4. (Optional) Tauri Desktop Build

```bash
npm run tauri:prepare-resources
npm run tauri:build
```

## Environment Variables

Copy `.env.example` and fill in values for your setup. Key groups:

### Database & Services

| Variable | Default |
|----------|---------|
| `DATABASE_URL` | `postgresql://bizbot:bizbot_local@localhost:5432/bizbot` |
| `MEMGRAPH_URI` | `bolt://localhost:7687` |

Redis uses the default `localhost:6379` (no env var needed for defaults).

### LLM Configuration

| Variable | Purpose |
|----------|---------|
| `ACTIVE_LLM_PROVIDER` | `google`, `openai`, `anthropic`, `ollama`, or `minimax` |
| `GOOGLE_AI_API_KEY` | Google Gemini API key |
| `GOOGLE_MODEL` | Default: `gemini-3-flash-preview` |
| `EMBEDDING_PROVIDER` | Provider for embeddings (default: `google`) |
| `EMBEDDING_MODEL` | Default: `gemini-embedding-001` |
| `EMBEDDING_DIMENSIONS` | Must match pgvector column width (default: `1536`) |

### Agent Behavior

| Variable | Purpose |
|----------|---------|
| `BIZBOT_AUTONOMY_PRESET` | `manual_only`, `reply_only`, `approval_all_posts`, `wide_open` |
| `BIZBOT_AGENT_HEARTBEAT_SECONDS` | Worker poll interval (default: `300`) |
| `BIZBOT_KNOWLEDGE_ENABLED` | Enable knowledge folder indexing (default: `true`) |
| `BIZBOT_KNOWLEDGE_PATH` | Subfolder under workspace (default: `knowledge`) |

### Social Platforms

| Variable | Platform |
|----------|----------|
| `META_ACCESS_TOKEN` | Facebook + Instagram (Graph API) |
| `FACEBOOK_PAGE_ID` | Facebook Page ID |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram Business Account ID |
| `TWITTER_APP_KEY`, `TWITTER_APP_SECRET` | Twitter API credentials |
| `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | Twitter user tokens |
| `TWITTER_USER_ID` | Twitter user ID for mention timeline |

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start full stack (web + worker) in dev mode |
| `npm run dev:web` | Start only the Next.js dev server |
| `npm run worker` | Start only the BullMQ worker |
| `npm run build` | Production build (Next.js standalone) |
| `npm run start` | Start full stack in production mode |
| `npm run tauri:prepare-resources` | Bundle server + worker into Tauri resources |
| `npm run tauri:dev` | Run Tauri desktop in dev mode |
| `npm run tauri:build` | Build packaged Tauri desktop app |

## Known Limitations

- Social platform integrations are implemented but require real API credentials and live testing
- Facebook Messenger DM access requires Meta App Review for production use
- Browser-based social adapters are experimental (Facebook post only, no Instagram browser adapter)
- Inbox ingestion uses polling, not webhooks
- No canned/template response system yet — all replies are LLM-generated
- Multi-account social tenancy is not implemented; platform IDs are single-account
- `ScheduleRule` model exists but max-per-day enforcement is not yet wired into the publish pipeline

## Security

- `.env` is gitignored — never commit credentials
- Browser access is allowlist-controlled via `BROWSER_ALLOWLIST` policies
- Posting goes through approval workflows (configurable via autonomy preset)
- This is a local operator tool, not a multi-tenant service
