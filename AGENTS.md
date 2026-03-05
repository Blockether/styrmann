# AGENTS.md -- Mission Control (Blockether Fork)

## Deployment

**ALWAYS use the deploy script:**

```bash
/root/repos/blockether/mission-control/scripts/deploy.sh
```

Options:
- `--skip-build` -- Just restart the service (no build)
- `--no-restart` -- Build only, do not restart

**NEVER use manual systemctl commands.** The deploy script handles build, cache clear, restart, health check, and summary.

## Service

- **Service name:** `mission-control` (systemd)
- **URL:** https://control.blockether.com
- **Port:** 4000
- **Server OS:** Rocky Linux
- **Node.js:** v18+
- **Process manager:** systemd (NOT pm2)
- **RestartSec:** 60 (Node.js startup time)

### Logs

```bash
journalctl -u mission-control --no-pager -n 50
```

## Build

```bash
npm run build
```

This runs `next build` from `/root/repos/blockether/mission-control`.

## Git

- **Remote `origin`:** Blockether fork (push here)
- **Remote `upstream`:** crshdn/mission-control (upstream OSS)
- **Branch:** `main`
- **Push:** `git push origin main`
- **NEVER push to upstream**

### Commit Convention

- Prefix: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`
- Language: English
- Footer (always):
  ```
  Ultraworked with [Sisyphus] from OhMyClaude Code (https://ohmyclaude.com)

  Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
  ```
- **No emojis.** Corporate branding.
- **No sensitive information** (tokens, IPs, passwords) in commits.

## Project Structure

```
mission-control/
  src/
    app/                          # Next.js App Router
      api/
        agents/                   # Agent CRUD
        demo/                     # Demo mode endpoints
        events/stream/            # SSE real-time stream
        files/                    # File upload/download/reveal
        milestones/               # Milestone CRUD
        openclaw/                 # Gateway proxy + sessions
        sprints/                  # Sprint CRUD
        tags/                     # Tag management
        tasks/                    # Task CRUD + dispatch + activities + deliverables
        webhooks/                 # Agent completion webhooks
        workspaces/               # Workspace CRUD + knowledge + workflows
      settings/                   # Settings page
      workspace/[slug]/           # Single-page workspace dashboard
    components/                   # React components
      ActiveSprint.tsx            # Sprint view (List + Kanban toggle)
      AgentActivityDashboard.tsx  # Activity view (embedded in dashboard)
      AgentsSidebar.tsx           # Left sidebar (agents list, collapsed by default)
      BacklogView.tsx             # Backlog table view
      Header.tsx                  # Top nav bar
      LiveFeed.tsx                # Right sidebar (real-time events)
      ParetoView.tsx              # Pareto priority matrix
      TaskModal.tsx               # Task create/edit modal
      TaskDetailPanel.tsx         # Task detail side panel
    hooks/
      useSSE.ts                   # SSE connection hook
    lib/
      db/
        index.ts                  # SQLite connection (better-sqlite3)
        migrations.ts             # Migration runner (001-019)
        schema.ts                 # Table definitions
        seed.ts                   # Database seeding
      openclaw/                   # Gateway client + device identity
      config.ts                   # Environment config helpers
      events.ts                   # SSE event broadcaster
      learner.ts                  # Learner agent knowledge loop
      orchestration.ts            # Orchestration helper library
      store.ts                    # Zustand global state
      types.ts                    # TypeScript type definitions
      validation.ts               # Zod schemas
      workflow-engine.ts          # Auto-handoff engine
    middleware.ts                  # Auth middleware (Bearer token)
  scripts/
    deploy.sh                     # Build + deploy (USE THIS)
    lint.sh                       # Lint runner
    validate.sh                   # DB/env/service validation
    check.sh                      # Pre-deploy check (build + lint + validate)
  public/
    workspace-logos/              # Workspace logo assets
  KNOWLEDGE.md                    # Consolidated project knowledge
  CHANGELOG.md                    # Version history
```

## Database

- **Engine:** SQLite via better-sqlite3
- **Path:** `/root/repos/blockether/mission-control/mission-control.db`
- **Migrations:** 19 applied (001-019), auto-run on startup in `src/lib/db/index.ts`

### npm database scripts

```bash
npm run db:seed       # Create DB + seed default data
npm run db:backup     # Checkpoint WAL + copy to .backup
npm run db:restore    # Restore from .backup
npm run db:reset      # Delete DB + re-seed
```

## Environment

All config in `.env.local` (gitignored). Key variables:

| Variable | Purpose |
|----------|---------|
| `OPENCLAW_GATEWAY_URL` | WebSocket URL to OpenClaw Gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Auth token for OpenClaw |
| `MC_API_TOKEN` | API auth token (enables auth middleware) |
| `DATABASE_PATH` | SQLite database location |

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5
- **Database:** SQLite (better-sqlite3)
- **State:** Zustand
- **Styling:** Tailwind CSS with custom `mc-*` palette
- **Icons:** Lucide React (only)
- **Fonts:** IBM Plex Mono (headings), Atkinson Hyperlegible (body)
- **Real-time:** Server-Sent Events (SSE)
- **Validation:** Zod
- **Agent runtime:** OpenClaw Gateway (WebSocket)

## Dashboard Architecture

Single-page dashboard per workspace. No page navigations between views.

```
/workspace/[slug]/page.tsx
  Header (nav buttons, view switching callback, no border-b on desktop)
  Desktop: AgentsSidebar(collapsed) | {view content} | LiveFeed
    view='sprint'   -> ActiveSprint (List/Board toggle)
    view='backlog'  -> BacklogView
    view='pareto'   -> ParetoView
    view='activity' -> AgentActivityDashboard (embedded)
  Mobile: tab bar (Content/Agents/Feed)
```

All view toolbars use:
```
p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap
```

## Style Rules

- **No emojis.** Anywhere. Corporate branding.
- **IBM Plex Mono** for headings, **Atkinson Hyperlegible** for body text.
- Light theme with Blockether cream/gold palette (`mc-*` CSS classes).
- Lucide icons only. No other icon libraries.
- All paths must be **absolute** (never `~` or relative).
- Toolbar pattern: `ChevronRight` leading icon + context title on left, controls on right.
- Mobile: `flex-wrap`, text labels hidden via `hidden sm:inline`, icons-only on small screens.

## Agent Configuration

Five synced gateway agents (appear in all workspaces):

| Slug | Name | Model |
|------|------|-------|
| `main` | Michal Kruk | opus-4-6 |
| `arch-explorer` | Robert Architect - Explorer | opus-4-6 |
| `arch-simplicity` | Robert Architect - Pragmatist | opus-4-6 |
| `arch-correctness` | Robert Architect - Guardian | glm-5 |
| `arch-consolidator` | Robert Architect - Consolidator | opus-4-6 |

Agent names start with "Robert Architect | {Role}" (except `main`).

## Validation Scripts

```bash
/root/repos/blockether/mission-control/scripts/lint.sh       # ESLint + type check
/root/repos/blockether/mission-control/scripts/validate.sh    # DB + env + service check
/root/repos/blockether/mission-control/scripts/check.sh       # Full pre-deploy (lint + validate + build)
```

See each script for usage and exit codes.
