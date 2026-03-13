<p align="center">
  <img src="https://raw.githubusercontent.com/Blockether/styrmann/main/logo.png" alt="Styrmann logo" width="220" />
</p>

<div align="center">
<i>Styrmann</i> - Mission control for orchestrating agent and human delivery.
<br/>
<sub>Backlog and sprint management · Orchestration pipelines · Agent sessions and traces · Deliverables and acceptance flow · Real-time updates.</sub>
</div>

<div align="center">
  <h2>
    <a href="https://github.com/Blockether/styrmann/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License - Apache 2.0" />
    </a>
  </h2>
</div>

<div align="center">
<h3>

[Rationale](#rationale) • [Quick Start](#quick-start) • [Architecture](#architecture) • [Scripts](#scripts) • [Documentation](#documentation)

</h3>
</div>

## Rationale

Styrmann is a focused, self-hosted control room for software execution.
It connects your workspace, OpenClaw agents, and human reviewers in one operational loop so planning, execution, and acceptance stay in sync.

- Sprint and backlog views with milestone-based execution planning
- Session-aware orchestration with OpenClaw trace visibility
- Deliverable and acceptance workflow with clear audit trail
- Real-time updates over SSE for status and activity surfaces
- Security primitives: Bearer auth, webhook verification, strict API validation
- Privacy-first deployment model with no telemetry dependency

## Quick Start

```bash
git clone https://github.com/Blockether/styrmann.git
cd styrmann
npm install
cp .env.example .env.local
```

Configure `.env.local`:

```env
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your-token
MC_API_TOKEN=optional-api-token
```

Run locally:

```bash
npm run dev
```

Open `http://localhost:4000`.

## Architecture

```text
Browser (SSE)
  -> Styrmann (Next.js, React, TypeScript)
  -> SQLite state + workflow engine
  -> OpenClaw Gateway (WebSocket)
  -> Model providers
```

Core stack:

- Next.js App Router
- React + TypeScript
- SQLite (`better-sqlite3`)
- Zustand state management
- Tailwind CSS
- Zod validation

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/check.sh` | Full pre-deploy validation (lint + validate + build) |
| `scripts/deploy.sh` | Build, restart services, run health checks |
| `scripts/lint.sh` | ESLint and TypeScript checks |
| `scripts/validate.sh` | Environment, database, and service validation |

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `OPENCLAW_GATEWAY_URL` | Yes | OpenClaw gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Gateway authentication token |
| `MC_API_TOKEN` | No | API Bearer auth token |
| `WEBHOOK_SECRET` | No | HMAC verification secret |
| `DATABASE_PATH` | No | SQLite path (default: `./styrmann.db`) |

## Documentation

- `KNOWLEDGE.md` - architecture, APIs, data model, and workflow behavior
- `AGENTS.md` - execution rules and contributor constraints
- `CHANGELOG.md` - release history

## License

Apache License 2.0 - see `LICENSE`.
