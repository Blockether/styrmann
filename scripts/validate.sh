#!/usr/bin/env bash
set -euo pipefail

# Mission Control - Environment & Service Validation
# Usage: ./scripts/validate.sh
#
# Checks database, environment, and service health.
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="/root/repos/blockether/mission-control"
DB_PATH="${PROJECT_DIR}/mission-control.db"
ENV_FILE="${PROJECT_DIR}/.env.local"
SERVICE_NAME="mission-control"
DAEMON_SERVICE="mission-control-daemon"
URL="https://control.blockether.com"

step() { echo -e "\n${CYAN}${BOLD}[$1/$TOTAL]${NC} $2"; }
ok()   { echo -e "    ${GREEN}OK${NC} $1"; }
warn() { echo -e "    ${YELLOW}WARN${NC} $1"; }
fail() { echo -e "    ${RED}FAIL${NC} $1"; }

TOTAL=5
ERRORS=0
WARNINGS=0

echo -e "${BOLD}Mission Control - Validation${NC}"
echo "================================================"

# -- Step 1: Environment file ----------------------------------------------
step 1 "Checking environment..."

if [ -f "$ENV_FILE" ]; then
  ok ".env.local exists"

  REQUIRED_VARS=("OPENCLAW_GATEWAY_URL" "OPENCLAW_GATEWAY_TOKEN" "MC_API_TOKEN")
  for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
      ok "$var is set"
    else
      warn "$var is not set in .env.local"
      WARNINGS=$((WARNINGS + 1))
    fi
  done
else
  fail ".env.local not found at $ENV_FILE"
  ERRORS=$((ERRORS + 1))
fi

# -- Step 2: Database -------------------------------------------------------
step 2 "Checking database..."

if [ -f "$DB_PATH" ]; then
  DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
  ok "Database exists ($DB_SIZE)"

  if command -v sqlite3 &>/dev/null; then
    TABLE_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null || echo "0")
    ok "$TABLE_COUNT tables found"

    MIGRATION_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM _migrations;" 2>/dev/null || echo "0")
    ok "$MIGRATION_COUNT migrations applied"

    AGENT_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM agents;" 2>/dev/null || echo "0")
    ok "$AGENT_COUNT agents registered"

    WORKSPACE_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM workspaces;" 2>/dev/null || echo "0")
    ok "$WORKSPACE_COUNT workspaces"
  else
    warn "sqlite3 CLI not installed -- skipping detailed DB checks"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  fail "Database not found at $DB_PATH"
  fail "Run: npm run db:seed"
  ERRORS=$((ERRORS + 1))
fi

# -- Step 3: Web service status --------------------------------------------
step 3 "Checking web service..."

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  UPTIME=$(systemctl show "$SERVICE_NAME" --property=ActiveEnterTimestamp --no-pager 2>/dev/null | cut -d= -f2)
  ok "Service is running (since $UPTIME)"

  PID=$(systemctl show "$SERVICE_NAME" --property=MainPID --no-pager 2>/dev/null | cut -d= -f2)
  if [ -n "$PID" ] && [ "$PID" != "0" ]; then
    MEM=$(ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "%.0f MB", $1/1024}')
    ok "PID $PID, memory: $MEM"
  fi
else
  fail "Service $SERVICE_NAME is not running"
  echo ""
  echo "    Recent logs:"
  journalctl -u "$SERVICE_NAME" --no-pager -n 5 2>/dev/null | while IFS= read -r line; do
    echo "      $line"
  done
  ERRORS=$((ERRORS + 1))
fi

# -- Step 4: Daemon service ------------------------------------------------
step 4 "Checking daemon..."

if systemctl is-active --quiet "$DAEMON_SERVICE" 2>/dev/null; then
  UPTIME=$(systemctl show "$DAEMON_SERVICE" --property=ActiveEnterTimestamp --no-pager 2>/dev/null | cut -d= -f2)
  ok "Daemon is running (since $UPTIME)"

  PID=$(systemctl show "$DAEMON_SERVICE" --property=MainPID --no-pager 2>/dev/null | cut -d= -f2)
  if [ -n "$PID" ] && [ "$PID" != "0" ]; then
    MEM=$(ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "%.0f MB", $1/1024}')
    ok "Daemon PID $PID, memory: $MEM"
  fi
else
  fail "Daemon $DAEMON_SERVICE is not running"
  echo ""
  echo "    Recent daemon logs:"
  journalctl -u "$DAEMON_SERVICE" --no-pager -n 5 2>/dev/null | while IFS= read -r line; do
    echo "      $line"
  done
  ERRORS=$((ERRORS + 1))
fi

# -- Step 5: HTTP health check ---------------------------------------------
step 5 "Checking HTTP endpoint..."

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  ok "$URL responding 200"
elif [ "$HTTP_CODE" = "000" ]; then
  fail "$URL not reachable (connection failed)"
  ERRORS=$((ERRORS + 1))
else
  warn "$URL returned HTTP $HTTP_CODE"
  WARNINGS=$((WARNINGS + 1))
fi

# -- Summary ----------------------------------------------------------------
echo ""
echo -e "${BOLD}Summary${NC}"
if [ "$ERRORS" -gt 0 ]; then
  echo -e "    ${RED}${BOLD}FAILED${NC} - $ERRORS error(s), $WARNINGS warning(s)"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "    ${YELLOW}${BOLD}PASSED${NC} with $WARNINGS warning(s)"
else
  echo -e "    ${GREEN}${BOLD}PASSED${NC} - All checks clean"
fi
