#!/usr/bin/env bash
set -euo pipefail

# Mission Control - Lint & Type Check
# Usage: ./scripts/lint.sh [--fix]
#
# Runs ESLint and TypeScript type checking.
# Exit codes:
#   0 - All checks passed
#   1 - Lint or type errors found

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="/root/repos/blockether/mission-control"
FIX_FLAG=""

for arg in "$@"; do
  case $arg in
    --fix) FIX_FLAG="--fix" ;;
    --help|-h)
      echo "Usage: ./scripts/lint.sh [--fix]"
      echo ""
      echo "  --fix    Auto-fix ESLint issues where possible"
      exit 0
      ;;
  esac
done

step() { echo -e "\n${CYAN}${BOLD}[$1/$TOTAL]${NC} $2"; }
ok()   { echo -e "    ${GREEN}OK${NC} $1"; }
warn() { echo -e "    ${YELLOW}WARN${NC} $1"; }
fail() { echo -e "    ${RED}FAIL${NC} $1"; }

TOTAL=2
ERRORS=0

echo -e "${BOLD}Mission Control - Lint & Type Check${NC}"
echo "================================================"

# -- Step 1: ESLint --------------------------------------------------------
step 1 "Running ESLint..."

LINT_OUTPUT=$(cd "$PROJECT_DIR" && npx eslint . $FIX_FLAG 2>&1) || {
  LINT_EXIT=$?
  if [ "$LINT_EXIT" -ne 0 ]; then
    fail "ESLint found errors"
    echo "$LINT_OUTPUT" | tail -40
    ERRORS=$((ERRORS + 1))
  fi
}

if [ "$ERRORS" -eq 0 ]; then
  LINT_WARNINGS=$(echo "$LINT_OUTPUT" | grep -c "Warning:" 2>/dev/null || true)
  if [ "$LINT_WARNINGS" -gt 0 ]; then
    warn "ESLint passed with $LINT_WARNINGS warning(s)"
  else
    ok "ESLint clean"
  fi
fi

# -- Step 2: TypeScript type check -----------------------------------------
step 2 "Running TypeScript type check..."

TSC_OUTPUT=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1) || {
  TSC_EXIT=$?
  if [ "$TSC_EXIT" -ne 0 ]; then
    fail "TypeScript found type errors"
    echo "$TSC_OUTPUT" | head -40
    ERRORS=$((ERRORS + 1))
  fi
}

if echo "$TSC_OUTPUT" | grep -q "error TS"; then
  fail "TypeScript type errors detected"
  echo "$TSC_OUTPUT" | grep "error TS" | head -20
  ERRORS=$((ERRORS + 1))
else
  ok "TypeScript types clean"
fi

# -- Summary ---------------------------------------------------------------
echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}${BOLD}FAILED${NC} - $ERRORS check(s) failed"
  exit 1
else
  echo -e "${GREEN}${BOLD}PASSED${NC} - All lint checks clean"
fi
