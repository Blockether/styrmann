# Mission Control operations

Use this reference when changing this repo directly, validating changes, deploying, or touching production behavior.

## Non-negotiable commands

- Typecheck: `npx tsc --noEmit`
- Build: `npm run build`
- Full check: `./scripts/check.sh`
- Deploy: `/root/repos/blockether/mission-control/scripts/deploy.sh`

Do not use manual systemctl restart flows for deployment.

## Pre-deploy checklist

1. Relevant files inspected and existing patterns matched.
2. LSP diagnostics clean on changed files.
3. `npx tsc --noEmit` passes.
4. `npm run build` passes.
5. `./scripts/check.sh` passes.
6. If React components were created or renamed, verify `data-component` on root DOM element.

## Deploy checklist

1. Run `/root/repos/blockether/mission-control/scripts/deploy.sh`
2. Confirm web responds `200` at `https://control.blockether.com`
3. Confirm daemon is active
4. If the task touched live UX, do a smoke check on the target screen/flow

## UI constraints to remember

- Light theme only
- Tailwind only
- Lucide React icons only
- IBM Plex Mono headings, Atkinson Hyperlegible body
- Avoid horizontal overflow on mobile
- Use helper text below dropdowns instead of long option labels
- Modal action bars use compact top-bordered footers

## OpenClaw constraints to remember

- Gateway/RPC first whenever capability exists
- Use host-level fallback only when RPC is unavailable or fails
- `SOUL.md` is identity/persona
- `MEMORY.md` is for durable agent-scoped learnings

## Git constraints to remember

- Push target is `origin`
- Branch protection assumptions should favor `main`
- Never expose secrets in commits or logs
- When operating through Mission Control workflows, preserve branch visibility back to the task
