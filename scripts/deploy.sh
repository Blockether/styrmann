#!/usr/bin/env bash
set -euo pipefail

# Styrmann - Build & Deploy
# Usage: ./scripts/deploy.sh [--skip-build] [--no-restart]

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="/root/repos/blockether/styrmann"
WEB_SERVICE="mission-control"
DAEMON_SERVICE="mission-control-daemon"
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
      echo "  --no-restart   Build only, don't restart the services"
      exit 0
      ;;
  esac
done

step() { echo -e "\n${CYAN}${BOLD}[$1/${TOTAL}]${NC} $2"; }
ok()   { echo -e "    ${GREEN}OK${NC} $1"; }
warn() { echo -e "    ${YELLOW}WARN${NC} $1"; }
fail() { echo -e "    ${RED}FAIL${NC} $1"; }

TOTAL=5
ERRORS=0
WARNINGS=0

echo -e "${BOLD}Styrmann - Deploy${NC}"
echo "================================================"

# ── Step 1: Build ────────────────────────────────────────────
step 1 "Clearing cache + building..."
rm -rf "${PROJECT_DIR}/.next/cache/images" 2>/dev/null || true

if [ "$SKIP_BUILD" = true ]; then
  ok "Cache cleared (build skipped)"
else
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

# ── Step 2: Restart web service ─────────────────────────────
if [ "$NO_RESTART" = true ]; then
  step 2 "Restart web ${YELLOW}(skipped)${NC}"
else
  step 2 "Restarting $WEB_SERVICE..."
  
  systemctl kill -s SIGKILL "$WEB_SERVICE" 2>/dev/null || true
  systemctl start "$WEB_SERVICE"
  ok "Web service restarted"
fi

# ── Step 3: Restart daemon service ──────────────────────────
if [ "$NO_RESTART" = true ]; then
  step 3 "Restart daemon ${YELLOW}(skipped)${NC}"
else
  step 3 "Restarting $DAEMON_SERVICE..."

  # Enable on first deploy
  if ! systemctl is-enabled "$DAEMON_SERVICE" &>/dev/null; then
    systemctl daemon-reload
    systemctl enable "$DAEMON_SERVICE" 2>/dev/null || true
  fi

  systemctl restart "$DAEMON_SERVICE" 2>/dev/null || {
    systemctl daemon-reload
    systemctl start "$DAEMON_SERVICE"
  }
  ok "Daemon service restarted"
fi

# ── Step 4: Health checks ───────────────────────────────────
if [ "$NO_RESTART" = true ]; then
  step 4 "Health checks ${YELLOW}(skipped)${NC}"
else
  step 4 "Health checks..."

  # 4a. Web service health (HTTP)
  WEB_HEALTHY=false
  for i in $(seq 1 12); do
    sleep 5
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      WEB_HEALTHY=true
      break
    fi
    echo -e "      web: attempt $i/12 - HTTP $HTTP_CODE"
  done

  if [ "$WEB_HEALTHY" = true ]; then
    ok "Web: $URL responding 200"
  else
    fail "Web: $URL not responding after 60s"
    systemctl status "$WEB_SERVICE" --no-pager | tail -5
    ERRORS=$((ERRORS + 1))
  fi

  # 4b. Daemon health (systemd active check + process alive)
  sleep 2
  DAEMON_STATUS=$(systemctl is-active "$DAEMON_SERVICE" 2>/dev/null || echo "inactive")
  if [ "$DAEMON_STATUS" = "active" ]; then
    DAEMON_PID=$(systemctl show -p MainPID --value "$DAEMON_SERVICE" 2>/dev/null || echo "0")
    ok "Daemon: active (PID $DAEMON_PID)"
  else
    fail "Daemon: $DAEMON_STATUS"
    systemctl status "$DAEMON_SERVICE" --no-pager | tail -10
    ERRORS=$((ERRORS + 1))
  fi
fi

# ── Step 5: Summary ────────────────────────────────────────
step 5 "Summary"
echo ""
COMMIT=$(cd "$PROJECT_DIR" && git log -1 --format='%h %s' 2>/dev/null || echo "unknown")
echo -e "    Commit:   ${BOLD}$COMMIT${NC}"
echo -e "    Log:      $LOG_FILE"

# Show service status
WEB_ST=$(systemctl is-active "$WEB_SERVICE" 2>/dev/null || echo "unknown")
DAEMON_ST=$(systemctl is-active "$DAEMON_SERVICE" 2>/dev/null || echo "unknown")
echo -e "    Web:      ${WEB_ST}"
echo -e "    Daemon:   ${DAEMON_ST}"

if [ "$ERRORS" -gt 0 ]; then
  echo -e "    Result:   ${RED}${BOLD}$ERRORS error(s), $WARNINGS warning(s)${NC}"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "    Result:   ${YELLOW}${BOLD}$WARNINGS warning(s)${NC}"
else
  echo -e "    Result:   ${GREEN}${BOLD}Clean deploy${NC}"
fi
echo ""
