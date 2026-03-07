# Mission Control

**AI Agent Orchestration Dashboard** -- Blockether fork of [Autensa/Mission Control](https://github.com/crshdn/mission-control).

We forked this to build our own agent orchestration layer. The upstream project provides the foundation; we customize it for how Blockether runs AI operations.

Live at **https://control.blockether.com**

---

## What It Does

Create tasks. Plan with AI. Dispatch to agents. Watch them work.

- **Sprint and backlog management** with auto-named sprints (SPRINT-1, SPRINT-2, ...) and milestone grouping
- **Kanban board** with drag-and-drop across 8 status columns, scoped to the active sprint
- **Pareto matrix** for prioritizing tasks by effort vs. impact
- **Agent sync** from OpenClaw Gateway -- agents defined in config files appear automatically
- **Real-time updates** via Server-Sent Events -- no page refresh needed
- **Workflow engine** with configurable pipelines (Simple, Standard, Strict) and fail-loopback routing
- **Activity audit log** and deliverable tracking per task
- **Security** -- Bearer token auth, HMAC webhooks, Zod validation
- **Self-hosted, privacy-first** -- no trackers, no telemetry, your data stays on your server

---

## Architecture

```
Browser <-- SSE -- Mission Control (Next.js 16, port 4000) -- WebSocket --> OpenClaw Gateway (port 18789)
                          |                                                        |
                      SQLite DB                                             AI Providers
```

Next.js 16 App Router, React 19, TypeScript 5.9, SQLite (better-sqlite3), Zustand, Tailwind CSS 4, Zod validation.

---

## Quick Start

```bash
git clone https://github.com/Blockether/mission-control.git
cd mission-control
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

Or use the deploy script (Blockether infrastructure):

```bash
./scripts/deploy.sh
```

---

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `OPENCLAW_GATEWAY_URL` | Yes | WebSocket URL to OpenClaw Gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Authentication token for OpenClaw |
| `MC_API_TOKEN` | No | API auth token (enables Bearer auth middleware) |
| `WEBHOOK_SECRET` | No | HMAC secret for webhook signature verification |
| `DATABASE_PATH` | No | SQLite database location (default: `./mission-control.db`) |

---

## Documentation

- **[KNOWLEDGE.md](KNOWLEDGE.md)** -- Full project knowledge: architecture, API endpoints, database schema, task lifecycle, workflow engine, agent sync, design decisions
- **[AGENTS.md](AGENTS.md)** -- Ground rules and verification checklist for AI agents working on this codebase
- **[CHANGELOG.md](CHANGELOG.md)** -- Version history

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/deploy.sh` | Build, restart service, health check |
| `scripts/lint.sh` | ESLint + TypeScript type check |
| `scripts/validate.sh` | Database, environment, and service validation |
| `scripts/check.sh` | Full pre-deploy check (lint + validate + build) |

---

## License

MIT -- see [LICENSE](LICENSE).

## Upstream

Forked from [crshdn/mission-control](https://github.com/crshdn/mission-control) (Autensa). We track upstream for foundational changes and apply our own customizations on top.
