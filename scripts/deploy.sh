#!/usr/bin/env bash
set -euo pipefail

# Blockether Mission Control - Build & Deploy
# Usage: ./scripts/deploy.sh [--skip-build] [--no-restart]

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="/root/repos/blockether/mission-control"
SERVICE_NAME="mission-control"
LOG_FILE="${PROJECT_DIR}/.next/deploy.log"
URL="https://control.blockether.com"

SKIP_BUILD=false
NO_RESTART=false

for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --no-restart) NO_RESTART=true ;;
    --help|-h)
      echo "Usage: ./scripts/deploy.sh [--skip-build] [--no-restart]"
      echo ""
      echo "  --skip-build   Skip the build step (just restart)"
      echo "  --no-restart   Build only, don't restart the service"
      exit 0
      ;;
  esac
done

step() { echo -e "\n${CYAN}${BOLD}[$1/${TOTAL}]${NC} $2"; }
ok()   { echo -e "    ${GREEN}OK${NC} $1"; }
warn() { echo -e "    ${YELLOW}WARN${NC} $1"; }
fail() { echo -e "    ${RED}FAIL${NC} $1"; }

TOTAL=4
ERRORS=0
WARNINGS=0

echo -e "${BOLD}Blockether Mission Control - Deploy${NC}"
echo "================================================"

# ── Step 1: Build ────────────────────────────────────────────
if [ "$SKIP_BUILD" = true ]; then
  step 1 "Build ${YELLOW}(skipped)${NC}"
else
  step 1 "Building Next.js..."
  
  BUILD_OUTPUT=$(cd "$PROJECT_DIR" && npx next build 2>&1) || {
    fail "Build failed!"
    echo "$BUILD_OUTPUT" | tail -30
    echo "$BUILD_OUTPUT" > "$LOG_FILE"
    fail "Full log: $LOG_FILE"
    exit 1
  }

  # Parse warnings and errors
  BUILD_WARNINGS=$(echo "$BUILD_OUTPUT" | grep -c "Warning:" || true)
  BUILD_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c "Error:" || true)
  WARNINGS=$((WARNINGS + BUILD_WARNINGS))
  ERRORS=$((ERRORS + BUILD_ERRORS))

  # Save build log
  echo "$BUILD_OUTPUT" > "$LOG_FILE"

  if [ "$BUILD_ERRORS" -gt 0 ]; then
    fail "Build has $BUILD_ERRORS error(s)!"
    echo "$BUILD_OUTPUT" | grep -A2 "Error:" | head -20
    exit 1
  elif [ "$BUILD_WARNINGS" -gt 0 ]; then
    warn "Build succeeded with $BUILD_WARNINGS warning(s):"
    echo "$BUILD_OUTPUT" | grep "Warning:" | while read -r line; do
      echo -e "      ${YELLOW}-${NC} $line"
    done
  else
    ok "Build clean - zero warnings, zero errors"
  fi
fi

# ── Step 2: Restart ──────────────────────────────────────────
if [ "$NO_RESTART" = true ]; then
  step 2 "Restart ${YELLOW}(skipped)${NC}"
else
  step 2 "Restarting $SERVICE_NAME..."
  
  systemctl kill -s SIGKILL "$SERVICE_NAME" 2>/dev/null || true
  systemctl start "$SERVICE_NAME"
  ok "Service restarted"
fi

# ── Step 3: Health check ─────────────────────────────────────
if [ "$NO_RESTART" = true ]; then
  step 3 "Health check ${YELLOW}(skipped)${NC}"
else
  step 3 "Waiting for service..."
  
  HEALTHY=false
  for i in $(seq 1 12); do
    sleep 5
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      HEALTHY=true
      break
    fi
    echo -e "      attempt $i/12 - HTTP $HTTP_CODE"
  done

  if [ "$HEALTHY" = true ]; then
    ok "$URL responding 200"
  else
    fail "$URL not responding after 60s"
    systemctl status "$SERVICE_NAME" --no-pager | tail -10
    ERRORS=$((ERRORS + 1))
  fi
fi

# ── Step 4: Summary ──────────────────────────────────────────
step 4 "Summary"
echo ""
COMMIT=$(cd "$PROJECT_DIR" && git log -1 --format='%h %s' 2>/dev/null || echo "unknown")
echo -e "    Commit:   ${BOLD}$COMMIT${NC}"
echo -e "    Log:      $LOG_FILE"

if [ "$ERRORS" -gt 0 ]; then
  echo -e "    Result:   ${RED}${BOLD}$ERRORS error(s), $WARNINGS warning(s)${NC}"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "    Result:   ${YELLOW}${BOLD}$WARNINGS warning(s)${NC}"
else
  echo -e "    Result:   ${GREEN}${BOLD}Clean deploy${NC}"
fi
echo ""
