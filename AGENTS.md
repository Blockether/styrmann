# AGENTS.md -- Mission Control (Blockether Fork)

## Ground Rules

1. **Deploy**: Always use `/root/repos/blockether/mission-control/scripts/deploy.sh`. Never manual systemctl. Options: `--skip-build`, `--no-restart`.
2. **Git**: Push to `origin` (Blockether fork). Never push to `upstream`. Branch: `main`.
3. **Commits**: Prefix `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`. English. Footer always includes:
   ```
   Ultraworked with [Sisyphus] from OhMyOpenCode v3.11.2 (https://github.com/code-yeongyu/oh-my-openagent)

   Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
   ```
4. **No emojis**. Anywhere. Corporate branding.
5. **No sensitive information** in commits (tokens, IPs, passwords, API keys).
6. **Paths**: Always absolute. Never `~` or relative.
7. **Icons**: Lucide React only. No other icon libraries.
8. **Fonts**: IBM Plex Mono (headings), Atkinson Hyperlegible (body).
9. **Styling**: Light theme, Blockether cream/gold palette (`mc-*` CSS classes). Tailwind only.
10. **Toolbars**: Context title on left, controls on right. Pattern: `p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap`.
11. **Mobile**: `flex-wrap`, text labels hidden via `hidden sm:inline`, icons-only on small screens.
12. **Component traceability**: Every React component's root DOM element MUST have `data-component="src/path/to/File"` (relative path, no extension). This allows pasting rendered HTML and immediately knowing which source file to edit.
13. **OpenClaw integration policy**: For OpenClaw data/operations, use Gateway RPC first whenever capability exists. Use host-level fallbacks (CLI/journalctl/filesystem) only when RPC method is unavailable or fails, and label fallback source explicitly in UI/API output.

## Modal & Dialog Guidelines

14. **Modal footers**: All save/action buttons in modal tabs MUST use the same footer pattern — a `border-t` top-bordered bar with right-aligned compact buttons. Never use full-width block buttons inside scrollable content.
15. **Modal scroll**: Tab-based modals MUST reset scroll position to top when switching tabs.
16. **Dropdowns**: When a dropdown selection has a description, show it as helper text below the dropdown (`text-xs text-mc-text-secondary`) — never cram long descriptions into `<option>` elements.

## Verification Rules (Pre-Commit)

Before every commit:

1. **Update KNOWLEDGE.md** if any architectural, API, schema, or behavioral change was made. KNOWLEDGE.md must always reflect the current state of the implementation.
2. **Build must pass**: `npm run build` (or use `scripts/deploy.sh --no-restart` to verify).
3. **No type errors**: `npx tsc --noEmit` clean.
4. **No broken imports**: If you renamed/moved files, verify all references.
5. **LSP diagnostics clean** on all changed files.
6. **Component traceability**: If you created or renamed a React component, verify its root DOM element has `data-component="src/path/to/File"` (relative path, no extension).
7. **Test the deploy**: After committing, deploy with `scripts/deploy.sh` and verify https://control.blockether.com responds 200.

8. **Always deploy after commit**: Every commit MUST be followed by `scripts/deploy.sh` and `git push origin main`. No orphan commits.

Quick validation: `scripts/check.sh` runs lint + validate + build in one shot.

## References

- **KNOWLEDGE.md** -- Full project knowledge: architecture, API endpoints, database schema, task lifecycle, agent sync, sprint/milestone system, SSE events, workflow engine, and all design decisions.
- **CHANGELOG.md** -- Version history.
- **scripts/deploy.sh** -- Build + restart + health check.
- **scripts/lint.sh** -- ESLint + TypeScript type check.
- **scripts/validate.sh** -- Database, environment, and service health check.
- **scripts/check.sh** -- Full pre-deploy check (lint + validate + build).
