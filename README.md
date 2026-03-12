<div align="center">

# Styrmann

*The helmsman for your AI agent fleet.*

<sub>Task orchestration · Sprint planning · Kanban boards · Agent sync · Real-time SSE · Workflow pipelines · Deliverable tracking — one self-hosted dashboard, zero telemetry.</sub>

<h2>
  <a href="https://github.com/Blockether/Styrmann/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License - Apache 2.0">
  </a>
</h2>

[Rationale](#rationale) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Documentation](#documentation)

</div>

## Rationale

Managing AI agents should not require a PhD in YAML. Most orchestration tools are either glorified job queues or overengineered platforms that collapse under their own abstractions.

Styrmann is a focused, self-hosted dashboard that connects to your [OpenClaw](https://github.com/code-yeongyu/openclaw) gateway and gives you exactly what you need:

- **Sprint and backlog management** with auto-named sprints and milestone grouping
- **Kanban board** with drag-and-drop across 8 status columns, scoped to the active sprint
- **Pareto matrix** for prioritizing tasks by effort vs. impact
- **Agent sync** from OpenClaw Gateway -- agents defined in config files appear automatically
- **Real-time updates** via Server-Sent Events -- no page refresh needed
- **Workflow engine** with configurable pipelines (Simple, Standard, Strict) and fail-loopback routing
- **Activity audit log** and deliverable tracking per task
- **Security** -- Bearer token auth, HMAC webhooks, Zod validation
- **Privacy-first** -- no trackers, no telemetry, your data stays on your server

## Quick Start

```bash
git clone https://github.com/Blockether/Styrmann.git
cd Styrmann
npm install
cp .env.example .env.local
```

Edit `.env.local`:

```env
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your-token-here
```

```bash
npm run dev
```

Open **http://localhost:4000**.

### Production

```bash
npm run build
npx next start -p 4000
```

<details>
<summary>Environment Variables</summary>

| Variable | Required | Description |
|----------|:--------:|-------------|
| `OPENCLAW_GATEWAY_URL` | Yes | WebSocket URL to OpenClaw Gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Authentication token for OpenClaw |
| `MC_API_TOKEN` | No | API auth token (enables Bearer auth middleware) |
| `WEBHOOK_SECRET` | No | HMAC secret for webhook signature verification |
| `DATABASE_PATH` | No | SQLite database location (default: `./styrmann.db`) |

</details>

## Architecture

```
Browser <-- SSE -- Styrmann (Next.js 16, port 4000) -- WebSocket --> OpenClaw Gateway (port 18789)
                       |                                                    |
                   SQLite DB                                          AI Providers
```

Next.js 16 App Router, React 19, TypeScript 5.9, SQLite (better-sqlite3), Zustand, Tailwind CSS 4, Zod validation.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/deploy.sh` | Build, restart service, health check |
| `scripts/lint.sh` | ESLint + TypeScript type check |
| `scripts/validate.sh` | Database, environment, and service validation |
| `scripts/check.sh` | Full pre-deploy check (lint + validate + build) |

## Documentation

- **[KNOWLEDGE.md](KNOWLEDGE.md)** -- Full project knowledge: architecture, API endpoints, database schema, task lifecycle, workflow engine, agent sync, design decisions
- **[AGENTS.md](AGENTS.md)** -- Ground rules and verification checklist for AI agents working on this codebase
- **[CHANGELOG.md](CHANGELOG.md)** -- Version history

## Upstream

Forked from [crshdn/mission-control](https://github.com/crshdn/mission-control) (Autensa). We track upstream for foundational changes and apply our own customizations on top.

## License

Apache License 2.0 -- see [LICENSE](LICENSE).
