#!/usr/bin/env bash
set -euo pipefail

# Mission Control - Pre-Deploy Check
# Usage: ./scripts/check.sh
#
# Runs lint, validate, and build in sequence.
# All three must pass for a clean pre-deploy check.
# Exit codes:
#   0 - All checks passed, safe to deploy
#   1 - One or more checks failed

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="/root/repos/blockether/mission-control"
SCRIPTS_DIR="${PROJECT_DIR}/scripts"

for arg in "$@"; do
  case $arg in
    --help|-h)
      echo "Usage: ./scripts/check.sh"
      echo ""
      echo "Runs all pre-deploy checks: lint, validate, build."
      echo "Use before deploying to catch issues early."
      exit 0
      ;;
  esac
done

echo -e "${BOLD}Mission Control - Pre-Deploy Check${NC}"
echo "================================================"
echo ""

FAILED=0

echo -e "${CYAN}${BOLD}[1/3]${NC} Lint..."
echo "------------------------------------------------"
if "${SCRIPTS_DIR}/lint.sh" 2>&1; then
  echo ""
else
  FAILED=$((FAILED + 1))
  echo ""
fi

echo -e "${CYAN}${BOLD}[2/3]${NC} Validate..."
echo "------------------------------------------------"
if "${SCRIPTS_DIR}/validate.sh" 2>&1; then
  echo ""
else
  FAILED=$((FAILED + 1))
  echo ""
fi

echo -e "${CYAN}${BOLD}[3/3]${NC} Build..."
echo "------------------------------------------------"
BUILD_OUTPUT=$(cd "$PROJECT_DIR" && npx next build 2>&1) || {
  echo -e "    ${RED}FAIL${NC} Build failed"
  echo "$BUILD_OUTPUT" | tail -20
  FAILED=$((FAILED + 1))
}

if [ "$FAILED" -eq 0 ]; then
  BUILD_WARNINGS=$(echo "$BUILD_OUTPUT" | grep -c "Warning:" 2>/dev/null || true)
  if [ "$BUILD_WARNINGS" -gt 0 ]; then
    echo -e "    ${YELLOW}WARN${NC} Build passed with $BUILD_WARNINGS warning(s)"
  else
    echo -e "    ${GREEN}OK${NC} Build clean"
  fi
fi

echo ""
echo "================================================"
if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}${BOLD}PRE-DEPLOY CHECK FAILED${NC} - $FAILED step(s) failed"
  echo -e "Fix issues before deploying."
  exit 1
else
  echo -e "${GREEN}${BOLD}PRE-DEPLOY CHECK PASSED${NC} - Safe to deploy"
  echo -e "Run: ${CYAN}/root/repos/blockether/mission-control/scripts/deploy.sh${NC}"
fi
