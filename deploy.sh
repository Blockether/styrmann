#!/usr/bin/env bash
# deploy.sh — mandatory deploy gate for control.blockether.com
# Failures at ANY stage abort the entire pipeline. No exceptions.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_JAR="${APP_DIR}/target/styrmann.jar"
DEPLOY_DIR="/opt/styrmann"
SERVICE_NAME="styrmann"

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BOLD}==> $1${NC}"; }
pass() { echo -e "${GREEN}OK${NC}"; }
fail() { echo -e "${RED}FAIL${NC}"; exit 1; }

matching_pids() {
  for pid in $(pgrep -f 'java -jar styrmann.jar' || true); do
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$DEPLOY_DIR" ]; then
      echo "$pid"
    fi
  done
}

# -- 1. Secret scan ----------------------------------------------------------
step "Scanning for leaked secrets"
if git diff --cached --name-only 2>/dev/null | grep -qiE '\.env|credential|secret|\.pem|\.key'; then
  echo "DANGER: Potential secret detected in staged files!"
  git diff --cached --name-only | grep -iE '\.env|credential|secret|\.pem|\.key'
  fail
fi
pass

# -- 2. LSP diagnostics ------------------------------------------------------
step "Clojure-LSP diagnostics"
if command -v clojure-lsp &>/dev/null; then
  DIAG_OUTPUT=$(clojure-lsp diagnostics --project-root "$APP_DIR" 2>&1 || true)
  if echo "$DIAG_OUTPUT" | grep -qE '(error|warning)'; then
    echo "$DIAG_OUTPUT"
    fail
  fi
  pass
else
  echo "clojure-lsp not found, skipping"
fi

# -- 3. Tests -----------------------------------------------------------------
step "Running tests (Lazytest)"
clojure -M:test || fail
pass

# -- 4. Build uberjar --------------------------------------------------------
step "Building uberjar"
clojure -T:build uberjar || fail
[ -f "$TARGET_JAR" ] || { echo "JAR not found: $TARGET_JAR"; fail; }
pass

# -- 5. Deploy ----------------------------------------------------------------
step "Deploying to ${DEPLOY_DIR}"
sudo mkdir -p "$DEPLOY_DIR"
sudo cp "$TARGET_JAR" "$DEPLOY_DIR/styrmann.jar"

# -- 6. Restart service -------------------------------------------------------
step "Restarting ${SERVICE_NAME}"
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  sudo systemctl restart "$SERVICE_NAME"
  pass
else
  echo "systemd service not configured — starting directly"
  sudo mkdir -p "$DEPLOY_DIR/log"
  EXISTING_PIDS="$(matching_pids)"
  if [ -n "$EXISTING_PIDS" ]; then
    echo "Stopping existing process(es): ${EXISTING_PIDS//$'\n'/ }"
    # shellcheck disable=SC2086
    kill $EXISTING_PIDS

    for _ in $(seq 1 20); do
      sleep 1
      if [ -z "$(matching_pids)" ]; then
        break
      fi
    done

    if [ -n "$(matching_pids)" ]; then
      echo "Existing processes did not stop cleanly"
      fail
    fi
  fi
  cd "$DEPLOY_DIR"
  nohup java -jar styrmann.jar > log/styrmann.log 2>&1 &
  PID=$!
  echo "PID=$PID"
  sleep 3
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "New process exited immediately. Check $DEPLOY_DIR/log/styrmann.log"
    fail
  fi
  pass
fi

echo -e "\n${GREEN}${BOLD}Deployed to control.blockether.com${NC}"
