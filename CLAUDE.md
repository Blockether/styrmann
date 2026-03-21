# Styrmann - Clojure Datastar Application

Backend-only Clojure application with Ring/Jetty, Datastar SSE, and Tailwind CSS.

## Quick Reference

| Command | Port | Purpose |
|---------|------|---------|
| `clj -M:dev` | 7888 (nREPL), 3000 (HTTP) | Dev REPL (auto-starts via `user.clj`) |
| `clj -M:test` | - | Run all tests (Lazytest) |

| REPL Command | Purpose |
|--------------|---------|
| `(start)` | Start nREPL + HTTP (auto-runs on REPL start) |
| `(stop)` | Stop both services |
| `(restart)` | Stop + start |

**Environment overrides:** `NREPL_PORT` (default 7888), `HTTP_PORT` (default 3000).

---

## Core Principles

*Same conventions as the [unbound](https://github.com/Blockether/unbound) repository.*

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them.
- If a simpler approach exists, say so.
- If something is unclear, stop and ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Match existing style. Every changed line traces to the user's request.
- Remove imports/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

When success criteria are clear, loop independently. When criteria are weak or ambiguous, stop and ask.

### 5. Pre-1.0 Compatibility

**Before version 1.0.0, backward compatibility is not required.**

- Prefer clean, correct domain models over compatibility shims.
- It is acceptable to rename entities/attributes and remove obsolete paths.
- When making breaking changes, update tests and docs in the same change.
- Do not spend effort on migration layers unless explicitly requested.

---

## Non-Negotiable Rules

### NEVER GUESS. USE THE REPL.

When something doesn't work, when you're unsure why, when you have a hypothesis — **try it in the REPL first.**

```bash
clj-nrepl-eval -p 7888 "(your-expression-here)"
```

**DO NOT** speculate. **DO NOT** propose fixes based on reading code alone.

### EVERY REPL Verification → Test

**If you verified it in the REPL, it MUST become a test. No exceptions.**

This applies to ALL `clj-nrepl-eval` calls that confirm behavior: bug reproductions, feature smoke tests, integration checks, data round-trips, API calls — everything. If the REPL call was worth running, the behavior is worth protecting.

```clojure
;; You ran this in the REPL:
(analysis/decompose-ticket! conn ticket-id {:model "gpt-4o-mini"})
;; => 5 tasks with ACs and CoVe questions

;; IMMEDIATELY create a test:
(it "decomposes a ticket into a valid task DAG"
  (with-temp-conn [conn (temp-conn)]
    (let [tasks (sut/decompose-ticket! conn ticket-id opts)]
      (expect (>= (count tasks) 2))
      (expect (every? #(seq (:task/acceptance-criteria-edn %)) tasks)))))
```

**The REPL is for discovery. Tests are for keeping it.**

### Bug Fixing Protocol

**NEVER fix a bug without a failing test first.**

```
1. Write a test that reproduces the bug
2. Run test -> MUST FAIL (proves test captures the bug)
3. Implement the fix
4. Run test -> MUST PASS (proves fix works)
5. Run full suite -> no regressions
```

### TDD Loop (Per Function)

```
1. SCAFFOLD  -> function signature + docstring + (throw "TODO")
2. TEST FIRST -> write test, run -> MUST FAIL
3. IMPLEMENT -> write code, run test -> should pass
4. FIX       -> if test fails, fix, repeat until green
```

### Test Rules

**Tests are about values, not types. NEVER accept weak tests.**

```
1. NO MOCKS         Real temp Datalevin instances, real data
2. EXACT VALUES     (expect (= "Implement login" (:ticket/title t)))
                    NOT (expect (string? (:ticket/title t)))
3. TDD ALWAYS       Write test first, watch it fail, implement, green
4. TEST DOMAIN      Pass conn to domain functions directly
                    No HTTP layer, no presentation in tests
5. TEMP DB          Every test gets a fresh Datalevin instance
                    Clean up after — no test pollution
6. USE MATCHERS     Use matcher-combinators for structural matching
                    NOT (every? some? xs) or (>= (count xs) 1)
```

### No Weak Tests (MANDATORY)

**Weak tests give false confidence. They pass even when things are broken.**

A weak test checks shape instead of substance. A strong test checks the actual data.

| WEAK (PROHIBITED)                              | STRONG (REQUIRED)                                    |
|-------------------------------------------------|------------------------------------------------------|
| `(expect (string? title))`                      | `(expect (= "Add JWT auth" title))`                  |
| `(expect (>= (count tasks) 2))`                 | `(expect (= 3 (count tasks)))`                       |
| `(expect (every? some? xs))`                    | `(expect (match? [map? map?] xs))` with field checks  |
| `(expect (seq (:task/ac task)))`                 | `(expect (match? (m/embeds {:task/ac [string?]}) t))` |
| `(expect (vector? (edn/read-string edn-str)))`  | `(expect (= ["AC one" "AC two"] (edn/read-string s)))`|

**Use `nubank/matcher-combinators`** for structural assertions on maps, vectors, and nested data.
When testing LLM output or other non-deterministic results, use `m/embeds` to check structure
and required fields without brittle exact-match on generated text.

```clojure
(require '[matcher-combinators.matchers :as m])

;; Structural match — checks shape AND presence of keys
(expect (match? (m/embeds {:task/status :task.status/inbox
                           :task/workspace {:workspace/name "styrmann"}
                           :task/acceptance-criteria-edn string?})
                task))

;; Collection with specific count and per-element structure
(expect (match? (m/equals [m/any m/any m/any])  ;; exactly 3
                tasks))

;; Nested structure in any order
(expect (match? (m/in-any-order [{:task/description "Schema migration"}
                                  {:task/description "API handler"}])
                (map #(select-keys % [:task/description]) tasks)))
```

### Pre-Commit Checklist

Run `./pre-commit.sh` to automate steps 1-6. Remaining steps are manual.

```
1. SECRETS      Scan for leaked secrets — ABORT if found
2. DIAGNOSTICS  clojure-lsp diagnostics — ZERO errors/warnings
3. CLEAN-NS     clojure-lsp clean-ns on all files
4. CLJFMT       clojure-lsp format on all files (uses .cljfmt.edn)
5. REPL CHECKS  check-docstrings + check-test-coverage on domain namespaces
6. TESTS        All tests pass (via REPL or clj -M:test)
7. KNOWLEDGE    Update KNOWLEDGE.md if domain concepts changed
8. COMMIT       Semantic: feat|fix|refactor|test|docs|chore(scope): description
9. PUSH         One change = commit + push. If tests pass, ship it.
```

### Deploy Stage (MANDATORY)

**Every deploy to control.blockether.com MUST pass this gate. No exceptions.**

`./deploy.sh` is always at the project root. Do NOT look for it, read it, or verify its existence — just run it.

```
1. SECRETS      Scan for leaked secrets (.env, credentials, API keys)
                NEVER commit secrets. NEVER deploy secrets. ABORT if found.
2. LINT         clojure-lsp diagnostics — ZERO errors, ZERO warnings
3. TESTS        clj -M:test — ALL tests MUST pass
4. BUILD        clojure -T:build uberjar — must produce target/styrmann.jar
5. DEPLOY       Copy jar to /opt/styrmann, restart systemd service
```

Run `./deploy.sh`. Failures at any stage abort the entire pipeline.

### Systemd Service

The production service runs as `/etc/systemd/system/styrmann.service`:

```ini
[Unit]
Description=Styrmann
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/styrmann
ExecStart=/usr/bin/java -jar /opt/styrmann/styrmann.jar
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Secrets and env overrides go in `/etc/systemd/system/styrmann.service.d/override.conf`.

### Secret Prevention

```
NEVER commit:  .env, .env.*, credentials.json, *.pem, *.key, *secret*
NEVER log:     API keys, tokens, passwords, connection strings with auth
NEVER hardcode: Secrets in source — use System/getenv ONLY
NEVER use .env files — ALL secrets go in systemd Environment= directives
```

Secrets belong in `/etc/systemd/system/styrmann.service.d/override.conf`:
```ini
[Service]
Environment=DATABASE_URL=...
Environment=API_KEY=...
```

Access in code via `(System/getenv "KEY")` only.

If a secret is detected in staged files, **ABORT the commit and WARN the user**.

---

## CLI Utilities

Same toolset as unbound. Available on this system:

| Command | Purpose |
|---------|---------|
| `clj-nrepl-eval -p 7888 "(code)"` | Evaluate code in running REPL |
| `clj-paren-repair file.clj` | Auto-fix unbalanced parentheses |

### REPL Test Utilities

```bash
clj-nrepl-eval -p 7888 "(run-test #'my.ns/my-fn)"    # single test
clj-nrepl-eval -p 7888 "(run-tests 'my.ns-test)"      # full namespace
clj-nrepl-eval -p 7888 "(run-all-tests)"               # everything
```

### REPL Validation Utilities

```bash
clj-nrepl-eval -p 7888 "(check-docstrings 'com.blockether.styrmann.domain.ticket)"
clj-nrepl-eval -p 7888 "(check-test-coverage 'com.blockether.styrmann.domain.ticket)"
clj-nrepl-eval -p 7888 "(check-all 'com.blockether.styrmann.domain.ticket)"
clj-nrepl-eval -p 7888 "(gen-test #'com.blockether.styrmann.domain.ticket/create!)"
clj-nrepl-eval -p 7888 "(scaffold-test-namespace 'com.blockether.styrmann.domain.ticket)"
```

---

## Code Style

### Namespace Structure

```clojure
(ns com.blockether.styrmann.feature
  (:require
   [ring.adapter.jetty :as jetty]          ; External libs first
   [starfederation.datastar.clojure.sdk :as ds]  ; Alphabetical
   [com.blockether.styrmann.util :as util]))              ; Project namespaces last
```

One require per line, alphabetize within groups. Use `:as` aliases, avoid `:refer :all`.

### Namespace Boundaries

Keep persistence, business rules, and SSR rendering in separate namespace families.

- `com.blockether.styrmann.db.*` - Datalevin schema, queries, transactions, and persistence-only code
- `com.blockether.styrmann.domain.*` - domain rules and orchestration functions
- `com.blockether.styrmann.presentation.screen.*` - screen-scoped SSR rendering
- `com.blockether.styrmann.presentation.component.*` - reusable SSR components

Do not put Datalevin queries in presentation namespaces. Do not put HTML rendering in db namespaces. Domain namespaces coordinate rules and call db namespaces.

### Naming & Data Rules

| Rule | Correct | Wrong |
|------|---------|-------|
| **Predicates** | `valid?`, `empty?` | `is-valid` |
| **Converters** | `schema->str` | `schemaToStr` |
| **Factories** | `make-handler` | `createHandler` |
| **UUIDs** | `(UUID/randomUUID)` | `(str (UUID/randomUUID))` |
| **No Wrapper Namespaces** | NEVER create namespaces that re-export external package functions | |

---

## Testing

**Lazytest only. clojure.test is PROHIBITED.**

### Lazytest Core

```clojure
(ns my.ns-test
  (:require
   [lazytest.core :refer [defdescribe describe it expect expect-it
                          before after before-each after-each around]]
   [my.ns :as sut]))
```

| Macro | Purpose |
|-------|---------|
| `defdescribe` | Top-level test var |
| `describe` | Group related tests |
| `it` | Single test case |
| `expect` | Assertion (throws on failure) |
| `expect-it` | Shorthand: `it` + single `expect` |

### Setup & Teardown

```clojure
(describe "with setup"
  (before (setup))
  (after (teardown))
  (it "works" ...))

(describe "per test"
  (before-each (reset! state nil))
  (it "starts clean" ...))
```

### Focus & Skip

```clojure
(it "ONLY this runs" {:focus true} ...)
(it "skipped" {:skip true} ...)
```

---

## Architecture

| Layer | Technology |
|-------|-----------|
| **HTTP server** | Ring + Jetty |
| **Reactivity** | Datastar (SSE) |
| **Database** | Datalevin (embedded Datalog) |
| **LLM output** | Svar |
| **Browser automation** | Spel (Playwright) |
| **CSS** | Tailwind v4 (CDN) |
| **Icons** | Lucide (CDN) |
| **Testing** | Lazytest |

### Datastar SSE

All dynamic UI updates go through Datastar server-sent events via `dev.data-star.clojure/ring`. No SPA, no client-side routing — server-driven hypermedia.

### Tailwind CSS v4

Loaded via CDN in HTML `<head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
```

### Lucide Icons

Loaded via CDN. Use `data-lucide` attributes, call `lucide.createIcons()` after DOM load:
```html
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="check-circle"></i>
<script>lucide.createIcons();</script>
```

---

## Spel — Visual Verification & E2E Testing

### Spel Agent Initialization

**Run every 10-20 commits:**

```bash
spel init-agents --force --ns com.blockether.styrmann
```

This regenerates Spel's agent context from the current codebase.

### Spel Always Uses Localhost

**Production (control.blockether.com) requires authentication and returns 401 for unauthenticated requests.**

When using Spel for visual verification, ALWAYS use `http://localhost:3000` instead of production URLs:

```bash
# CORRECT - use localhost
spel open "http://localhost:3000/organizations/..."

# WRONG - production requires auth
spel open "https://control.blockether.com/organizations/..."
```

Start the local server before Spel checks:
```bash
clojure -M:dev &>/dev/null &
# OR run from deployed JAR:
cd /opt/styrmann && java -jar styrmann.jar &
```

### Visual Verification Protocol

After any UI/presentation change:

1. **Start the local server** — `clj -M:dev`
2. **Use `spel snapshot` (NOT screenshot)** — snapshots include styles, positions, and element structure. Screenshots are images that lose detail at small sizes.
3. **Analyze the snapshot** — check element positions, text content, link URLs, and computed styles
4. **Assert expectations** — verify new elements AND absence of regressions
5. **Create E2E test** — convert the verification into a Spel test

**ALWAYS use `spel snapshot` over `spel screenshot`.** Snapshots provide structured DOM data with styles, positions, and accessibility info — far more useful than pixel images. Only use screenshots when explicitly asked by the user.

**NEVER** take a snapshot without analyzing it. **ALWAYS** verify both new elements AND absence of regressions.

### Frontend Bug / Visual Check → Spel Test

**When the user reports a frontend bug or asks to check something visually, ALWAYS create a Spel E2E test.** The test captures the expected behavior so it can never regress.

```
1. Reproduce via Spel (navigate, snapshot, verify)
2. Fix the issue
3. Write a Spel test that asserts the fix
4. Run the test — MUST PASS
```

### Impeccable — Design Quality

After significant UI changes, run impeccable commands:

```
/audit           # Find design issues
/critique        # UX review
/polish          # Final pass before shipping
/normalize       # Align with design system
```

---

## Debugging

### Direct Function Invocation (FIRST RESORT)

```bash
clj-nrepl-eval -p 7888 "(require '[my.ns :as ns] :reload) (ns/my-fn {:param \"value\"})"
```

### Debugging with #p (Hashp)

```clojure
#p (some-expression)
;; Output: #p[my.ns/fn:42] (some-expression) => {:result "value"}
```

### Debugging Protocol (MANDATORY)

1. **ADD LOGGING FIRST** - Insert logging at key points
2. **RELOAD CODE** - Require namespace with `:reload`
3. **REPRODUCE** - Trigger the issue again
4. **CHECK OUTPUT** - Identify WHERE it fails
5. **FIX** - Only now implement the actual fix

---

## KNOWLEDGE.md — Domain Knowledge

**KNOWLEDGE.md is the canonical place for domain concepts, business rules, and terminology.** All domain knowledge goes here — nowhere else.

**PROACTIVELY update KNOWLEDGE.md whenever domain understanding changes.** Do not wait to be asked. If you add a new entity, rename a concept, discover a business rule, or change a workflow — update KNOWLEDGE.md immediately as part of the same change. This is pre-commit step 6 and is NOT optional.

Rules:
- **ALL domain knowledge goes in KNOWLEDGE.md** — entities, workflows, terminology, business rules
- **PROACTIVELY update** — every domain change triggers a KNOWLEDGE.md update in the same commit
- NEVER put domain knowledge in CLAUDE.md — CLAUDE.md is for development conventions only
- NEVER put project structure in KNOWLEDGE.md — the code is the structure
- NEVER put project structure in CLAUDE.md — only mention the main namespace (`com.blockether.styrmann.main`)

---

## Meta-Rules

### Proactive Improvement

After solving a problem, **proactively check if CLAUDE.md or skills can be improved.** If you learn something that would prevent future mistakes, update the relevant document immediately. Don't wait to be asked.

### No Project Structure in Docs

**NEVER add directory trees, file listings, or project structure to KNOWLEDGE.md or CLAUDE.md.** This information goes stale instantly and contradicts the code. The only namespace to mention is the entry point: `com.blockether.styrmann.main`.

---

## Ignore & Protected

**NEVER read:** `.clj-kondo/`, `.cpcache/`, `.lsp/`

---

## Skills Index

| Skill | When to Load |
|-------|--------------|
| `/styrmann` | Project implementation, workflows, task management, deploys |
| `/spel` | Browser automation, E2E tests, Playwright API, visual testing |
| `/datalevin` | Schema design, connections, transactions, queries, test fixtures |
| `/development-lifecycle` | TDD workflow, Lazytest reference, test scaffolding (same as unbound) |
| `/clojure-repl` | REPL debugging, #p, tap>, introspection (same as unbound) |
| `/svar` | Structured LLM output, token counting, guardrails (same as unbound) |

---

## Skill Maintenance

After solving a problem: **update the relevant skill**. Skills are living documents.

*Load skills for implementation details. This file stays minimal.*

---

## Design Context

### Users
Technical team leads and engineering managers orchestrating AI-delegated work across organizations. They use Styrmann to manage sprints, tickets, and AI task execution. The interface should evoke **confidence and control** — users need to trust the system is working correctly and feel empowered to steer complex workflows.

### Brand Personality
**Warm, capable, calm.** Styrmann is a steady helmsman — it conveys quiet competence through editorial warmth (cream backgrounds, serif headlines) without being flashy or distracting. The interface should feel like a well-crafted tool that respects the user's attention.

### Aesthetic Direction
- **Visual tone**: Warm editorial — cream (#faf9f6) backgrounds, DM Serif Display headlines, orange (#ff6b35) accents
- **Reference**: Linear — clean, fast, keyboard-driven with sophisticated polish. Aspire to Linear's precision and speed while maintaining Styrmann's warmer, more editorial character
- **Anti-reference**: Avoid cold corporate dashboards, cluttered admin panels, or overly playful/gamified interfaces
- **Theme**: Light mode with cream warmth (not sterile white)

### Design Principles
1. **Editorial clarity** — Use typography, whitespace, and visual hierarchy to make information scannable. Serif headlines for warmth, sans-serif body for readability.
2. **Calm confidence** — Restrained animations, minimal shadows, generous spacing. The interface should feel unhurried and trustworthy, never frantic.
3. **Status at a glance** — Board-first layouts with clear color-coded badges and status indicators. A team lead should understand project state in seconds.
4. **Keyboard-first, touch-ready** — Optimize for keyboard power users (like Linear) while maintaining 28px+ touch targets for mobile/tablet use.
5. **Accessible by default** — Target WCAG AAA compliance: enhanced contrast ratios (7:1 for text), reduced motion support, comprehensive ARIA labels, full keyboard navigation, and accommodations for color blindness.

### Color System
| Token | Value | Purpose |
|-------|-------|---------|
| `--cream` | #faf9f6 | Primary background |
| `--charcoal` | #1a1a1f | Primary text, dark surfaces |
| `--accent` | #ff6b35 | Primary action (orange) |
| `--good` | #1a7f5a | Success states |
| `--warn` | #c47a20 | Warning states |
| `--danger` | #c43c2c | Error states |
| `--purple` | #6b4fc0 | Review/chore status |
| `--teal` | #2a8f8f | Docs/info |

### Typography
- **Headlines**: DM Serif Display (serif), letter-spacing -0.02em
- **Body**: Inter (sans-serif), -apple-system fallback
- **Both loaded from Google Fonts CDN**
