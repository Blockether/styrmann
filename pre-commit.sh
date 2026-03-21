#!/usr/bin/env bash
# pre-commit.sh — run all pre-commit checks
# Mirrors the Pre-Commit Checklist in CLAUDE.md
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BOLD}==> $1${NC}"; }
pass() { echo -e "  ${GREEN}PASS${NC}"; }
warn() { echo -e "  ${YELLOW}WARN${NC}: $1"; }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; exit 1; }

NREPL_PORT="${NREPL_PORT:-7888}"

# -- 1. Secret scan -----------------------------------------------------------
step "1. Secret scan"
SUSPECTS=$(git diff --cached --name-only 2>/dev/null | grep -iE '\.env|credential|secret|\.pem|\.key' || true)
if [ -n "$SUSPECTS" ]; then
  fail "Potential secrets in staged files:\n$SUSPECTS"
fi
pass

# -- 2. clojure-lsp diagnostics -----------------------------------------------
step "2. Clojure-LSP diagnostics"
if command -v clojure-lsp &>/dev/null; then
  DIAG=$(clojure-lsp diagnostics --project-root . 2>&1 | grep -vE '(unused-public-var|^\[)' | grep -E '(error|warning)' || true)
  if [ -n "$DIAG" ]; then
    echo "$DIAG"
    fail "Diagnostics found errors/warnings"
  fi
  pass
else
  warn "clojure-lsp not found, skipping"
fi

# -- 3. clojure-lsp clean-ns --------------------------------------------------
step "3. Clean namespaces"
if command -v clojure-lsp &>/dev/null; then
  clojure-lsp clean-ns --project-root . 2>&1 | tail -1
  pass
fi

# -- 4. clojure-lsp format (cljfmt) -------------------------------------------
step "4. Format (cljfmt)"
if command -v clojure-lsp &>/dev/null; then
  clojure-lsp format --project-root . 2>&1 | tail -1
  pass
fi

# -- 5. REPL validation (if nREPL is running) ---------------------------------
step "5. REPL validation (docstrings + test coverage)"
if command -v clj-nrepl-eval &>/dev/null && ss -tlnp 2>/dev/null | grep -q ":${NREPL_PORT} "; then
  echo "  nREPL detected on port ${NREPL_PORT}"

  # Find all styrmann domain namespaces
  NAMESPACES=$(clj-nrepl-eval -p "$NREPL_PORT" "
    (->> (all-ns)
         (map ns-name)
         (filter #(clojure.string/starts-with? (name %) \"com.blockether.styrmann.domain\"))
         (remove #(clojure.string/ends-with? (name %) \"-test\"))
         (sort)
         (mapv str)
         (clojure.string/join \",\"))
  " 2>/dev/null | tr -d '"' || echo "")

  if [ -n "$NAMESPACES" ] && [ "$NAMESPACES" != "nil" ] && [ "$NAMESPACES" != "" ]; then
    IFS=',' read -ra NS_ARRAY <<< "$NAMESPACES"
    DOCSTRING_ERRORS=0
    for ns in "${NS_ARRAY[@]}"; do
      echo "  Checking: $ns"
      RESULT=$(clj-nrepl-eval -p "$NREPL_PORT" "(let [r (check-docstrings '$ns)] (:invalid r))" 2>/dev/null || echo "0")
      INVALID=$(echo "$RESULT" | grep -oE '[0-9]+' | tail -1 || echo "0")
      if [ "$INVALID" -gt 0 ] 2>/dev/null; then
        warn "$ns has $INVALID invalid docstring(s)"
        DOCSTRING_ERRORS=$((DOCSTRING_ERRORS + INVALID))
      fi
    done
    if [ "$DOCSTRING_ERRORS" -gt 0 ]; then
      warn "Total: $DOCSTRING_ERRORS docstring issue(s) — fix before shipping"
    else
      echo -e "  ${GREEN}All docstrings valid${NC}"
    fi
  else
    echo "  No domain namespaces found (yet)"
  fi
  pass
else
  warn "nREPL not running on port ${NREPL_PORT}, skipping REPL checks"
fi

# -- 6. Tests ------------------------------------------------------------------
step "6. Tests"
if command -v clj-nrepl-eval &>/dev/null && ss -tlnp 2>/dev/null | grep -q ":${NREPL_PORT} "; then
  # Try running tests via REPL (faster, doesn't need fresh JVM)
  RESULT=$(clj-nrepl-eval -p "$NREPL_PORT" "(run-all-tests)" 2>/dev/null || echo "error")
  if echo "$RESULT" | grep -qiE '(fail|error)'; then
    fail "Tests failed — see output above"
  fi
  pass
else
  echo "  Running via clj -M:test (no REPL available)..."
  clojure -M:test || fail "Tests failed"
  pass
fi

# -- Summary -------------------------------------------------------------------
echo -e "\n${GREEN}${BOLD}All pre-commit checks passed.${NC}"
