# AGENTS.md -- Mission Control (Blockether Fork)

## Ground Rules

1. **Deploy**: Always use `/root/repos/blockether/mission-control/scripts/deploy.sh`. Never manual systemctl. Options: `--skip-build`, `--no-restart`.
2. **Git**: Push to `origin` (Blockether fork). Never push to `upstream`. Branch: `main`.
3. **Commits**: Prefix `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`. English. Footer always includes:
   ```
   Ultraworked with [Sisyphus] from OhMyClaude Code (https://ohmyclaude.com)

   Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
   ```
4. **No emojis**. Anywhere. Corporate branding.
5. **No sensitive information** in commits (tokens, IPs, passwords, API keys).
6. **Paths**: Always absolute. Never `~` or relative.
7. **Icons**: Lucide React only. No other icon libraries.
8. **Fonts**: IBM Plex Mono (headings), Atkinson Hyperlegible (body).
9. **Styling**: Light theme, Blockether cream/gold palette (`mc-*` CSS classes). Tailwind only.
10. **Toolbars**: `ChevronRight` leading icon + context title on left, controls on right. Pattern: `p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap`.
11. **Mobile**: `flex-wrap`, text labels hidden via `hidden sm:inline`, icons-only on small screens.

## Verification Rules (Pre-Commit)

Before every commit:

1. **Update KNOWLEDGE.md** if any architectural, API, schema, or behavioral change was made. KNOWLEDGE.md must always reflect the current state of the implementation.
2. **Build must pass**: `npm run build` (or use `scripts/deploy.sh --no-restart` to verify).
3. **No type errors**: `npx tsc --noEmit` clean.
4. **No broken imports**: If you renamed/moved files, verify all references.
5. **LSP diagnostics clean** on all changed files.
6. **Test the deploy**: After committing, deploy with `scripts/deploy.sh` and verify https://control.blockether.com responds 200.

Quick validation: `scripts/check.sh` runs lint + validate + build in one shot.

## References

- **KNOWLEDGE.md** -- Full project knowledge: architecture, API endpoints, database schema, task lifecycle, agent sync, sprint/milestone system, SSE events, workflow engine, and all design decisions.
- **CHANGELOG.md** -- Version history.
- **scripts/deploy.sh** -- Build + restart + health check.
- **scripts/lint.sh** -- ESLint + TypeScript type check.
- **scripts/validate.sh** -- Database, environment, and service health check.
- **scripts/check.sh** -- Full pre-deploy check (lint + validate + build).
