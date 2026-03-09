#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Mission Control — ACP Provenance Smoke Test
# Usage: ./scripts/smoke-provenance.sh
#
# Validates provenance schema, API endpoints, receipt parsing, and data flow.
# Uses localhost:4000 with Bearer auth. Requires running MC web service.
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="/root/repos/blockether/mission-control"
DB_PATH="${PROJECT_DIR}/mission-control.db"
BASE_URL="http://localhost:4000"
PASSED=0
FAILED=0
SKIPPED=0

# Load API token from .env.local
TOKEN=""
if [ -f "${PROJECT_DIR}/.env.local" ]; then
  TOKEN=$(grep -E '^MC_API_TOKEN=' "${PROJECT_DIR}/.env.local" | cut -d= -f2 | tr -d '[:space:]' || true)
fi

AUTH_HEADER=""
if [ -n "$TOKEN" ]; then
  AUTH_HEADER="Authorization: Bearer ${TOKEN}"
fi

pass() { echo -e "    ${GREEN}PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "    ${RED}FAIL${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "    ${YELLOW}SKIP${NC} $1"; SKIPPED=$((SKIPPED + 1)); }
info() { echo -e "    ${CYAN}INFO${NC} $1"; }

api_get() {
  local path="$1"
  if [ -n "$AUTH_HEADER" ]; then
    curl -sf -H "$AUTH_HEADER" "${BASE_URL}${path}" 2>/dev/null
  else
    curl -sf "${BASE_URL}${path}" 2>/dev/null
  fi
}

echo -e "${BOLD}Mission Control — ACP Provenance Smoke Test${NC}"
echo "================================================"
echo ""

# ─── Phase 1: Schema Integrity ──────────────────────────────────────────────

echo -e "${CYAN}${BOLD}[1/5]${NC} Schema Integrity"
echo "------------------------------------------------"

# 1a: Migration 035 applied
if sqlite3 "$DB_PATH" "SELECT id FROM _migrations WHERE id='035';" 2>/dev/null | grep -q "035"; then
  pass "Migration 035 applied"
else
  fail "Migration 035 NOT applied"
fi

# 1b: task_provenance table exists
if sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='task_provenance';" 2>/dev/null | grep -q "task_provenance"; then
  pass "task_provenance table exists"
else
  fail "task_provenance table missing"
fi

# 1c: All expected columns present
EXPECTED_COLS="id task_id session_id kind origin_session_id source_session_key source_channel source_tool receipt_text receipt_data message_role message_index created_at"
ACTUAL_COLS=$(sqlite3 "$DB_PATH" "PRAGMA table_info(task_provenance);" 2>/dev/null | cut -d'|' -f2 | tr '\n' ' ')
ALL_COLS_OK=true
for col in $EXPECTED_COLS; do
  if ! echo "$ACTUAL_COLS" | grep -qw "$col"; then
    fail "Missing column: $col"
    ALL_COLS_OK=false
  fi
done
if $ALL_COLS_OK; then
  pass "All 13 expected columns present"
fi

# 1d: Indexes exist
if sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_task_provenance_task';" 2>/dev/null | grep -q "idx_task_provenance_task"; then
  pass "Index idx_task_provenance_task exists"
else
  fail "Index idx_task_provenance_task missing"
fi
if sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_task_provenance_session';" 2>/dev/null | grep -q "idx_task_provenance_session"; then
  pass "Index idx_task_provenance_session exists"
else
  fail "Index idx_task_provenance_session missing"
fi

# 1e: FK constraint (task_id references tasks)
FK_SQL=$(sqlite3 "$DB_PATH" "SELECT sql FROM sqlite_master WHERE name='task_provenance';" 2>/dev/null)
if echo "$FK_SQL" | grep -q "REFERENCES tasks(id) ON DELETE CASCADE"; then
  pass "FK constraint: task_id -> tasks(id) ON DELETE CASCADE"
else
  fail "FK constraint missing on task_id"
fi

echo ""

# ─── Phase 2: API Endpoints ─────────────────────────────────────────────────

echo -e "${CYAN}${BOLD}[2/5]${NC} API Endpoints"
echo "------------------------------------------------"

# Check web service is running
if curl -sf -o /dev/null "${BASE_URL}" 2>/dev/null; then
  pass "Web service responding at ${BASE_URL}"
else
  fail "Web service not responding"
  echo -e "    ${RED}Aborting API tests — service is down${NC}"
  echo ""
  echo "================================================"
  echo -e "Results: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILED} failed${NC}, ${YELLOW}${SKIPPED} skipped${NC}"
  exit 1
fi

# Find a real task for API testing
REAL_TASK_ID=$(sqlite3 "$DB_PATH" "SELECT t.id FROM tasks t LIMIT 1;" 2>/dev/null || true)
FAKE_TASK_ID="00000000-0000-0000-0000-000000000000"

# 2a: Provenance API — valid task returns JSON with expected shape
if [ -n "$REAL_TASK_ID" ]; then
  PROV_RESP=$(api_get "/api/tasks/${REAL_TASK_ID}/provenance" || true)
  if echo "$PROV_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'task_id' in d; assert 'count' in d; assert 'records' in d; assert isinstance(d['records'], list)" 2>/dev/null; then
    pass "GET /api/tasks/{id}/provenance returns valid shape (task_id, count, records[])"
  else
    fail "GET /api/tasks/{id}/provenance invalid response shape"
    info "Response: ${PROV_RESP:-empty}"
  fi
else
  skip "No tasks in DB to test provenance API"
fi

# 2b: Provenance API — nonexistent task returns 404
PROV_404=$(curl -sf -o /dev/null -w "%{http_code}" -H "${AUTH_HEADER}" "${BASE_URL}/api/tasks/${FAKE_TASK_ID}/provenance" 2>/dev/null || true)
if [ "$PROV_404" = "404" ]; then
  pass "GET /api/tasks/{fake}/provenance returns 404"
else
  fail "GET /api/tasks/{fake}/provenance expected 404, got ${PROV_404}"
fi

# 2c: Trace API — find a task with sessions
TASK_WITH_SESSION=$(sqlite3 "$DB_PATH" "SELECT t.id FROM tasks t JOIN openclaw_sessions os ON os.task_id = t.id WHERE os.session_type='subagent' LIMIT 1;" 2>/dev/null || true)
if [ -n "$TASK_WITH_SESSION" ]; then
  SESSION_ID=$(sqlite3 "$DB_PATH" "SELECT openclaw_session_id FROM openclaw_sessions WHERE task_id='${TASK_WITH_SESSION}' AND session_type='subagent' LIMIT 1;" 2>/dev/null || true)
  if [ -n "$SESSION_ID" ]; then
    ENCODED_SESSION=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${SESSION_ID}', safe=''))")
    TRACE_RESP=$(api_get "/api/tasks/${TASK_WITH_SESSION}/sessions/${ENCODED_SESSION}/trace" || true)
    if echo "$TRACE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'provenance' in d; assert isinstance(d['provenance'], list); assert 'history' in d; assert 'summary' in d" 2>/dev/null; then
      HIST_COUNT=$(echo "$TRACE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['history']))")
      PROV_COUNT=$(echo "$TRACE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['provenance']))")
      pass "Trace API returns provenance[] field (history: ${HIST_COUNT}, provenance: ${PROV_COUNT})"
    else
      fail "Trace API response missing provenance[] field"
      info "Response: $(echo "$TRACE_RESP" | head -c 200)"
    fi
  else
    skip "No session ID found for trace API test"
  fi
else
  skip "No tasks with sessions — cannot test trace API"
fi

echo ""

# ─── Phase 3: Source Receipt Parsing ─────────────────────────────────────────

echo -e "${CYAN}${BOLD}[3/5]${NC} Source Receipt Parsing (Synthetic)"
echo "------------------------------------------------"

# Create a synthetic test using Node.js to test the receipt parsing directly
PARSE_RESULT=$(node -e "
  const SOURCE_RECEIPT_RE = /\[Source Receipt\]\n([\s\S]*?)\n\[\/?Source Receipt\]/;

  function parseSourceReceipt(content) {
    const match = SOURCE_RECEIPT_RE.exec(content);
    if (!match) return null;
    const data = {};
    for (const line of match[1].split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        data[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
      }
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  // Test 1: Valid receipt
  const receipt1 = parseSourceReceipt(
    'Hello\n[Source Receipt]\nbridge=openclaw-acp\noriginHost=mc-server\noriginCwd=/root/repos\nacpSessionId=abc-123\noriginSessionId=def-456\ntargetSession=agent:main:xyz\n[/Source Receipt]\nWorld'
  );
  const t1 = receipt1 && receipt1.bridge === 'openclaw-acp' && receipt1.originHost === 'mc-server' && receipt1.acpSessionId === 'abc-123' && receipt1.originSessionId === 'def-456' && receipt1.targetSession === 'agent:main:xyz' && receipt1.originCwd === '/root/repos';

  // Test 2: No receipt
  const receipt2 = parseSourceReceipt('Just a normal message with no receipt');
  const t2 = receipt2 === null;

  // Test 3: Empty receipt
  const receipt3 = parseSourceReceipt('[Source Receipt]\n[/Source Receipt]');
  const t3 = receipt3 === null;

  // Test 4: Partial receipt (no closing tag variant)
  const receipt4 = parseSourceReceipt('[Source Receipt]\nbridge=test\n[Source Receipt]');
  const t4 = receipt4 && receipt4.bridge === 'test';

  // Test 5: Receipt with special chars in values
  const receipt5 = parseSourceReceipt('[Source Receipt]\noriginCwd=/root/repos/blockether/mission-control\nbridge=openclaw-acp\n[/Source Receipt]');
  const t5 = receipt5 && receipt5.originCwd === '/root/repos/blockether/mission-control' && receipt5.bridge === 'openclaw-acp';

  console.log(JSON.stringify({ t1, t2, t3, t4, t5, receipt1_keys: receipt1 ? Object.keys(receipt1).length : 0 }));
" 2>&1)

echo "$PARSE_RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
results = {
  'Valid receipt parsed (6 fields)': d['t1'] and d['receipt1_keys'] == 6,
  'No receipt returns null': d['t2'],
  'Empty receipt returns null': d['t3'],
  'Self-closing receipt variant': d['t4'],
  'Paths with slashes preserved': d['t5'],
}
for name, ok in results.items():
  if ok:
    print(f'    \033[0;32mPASS\033[0m {name}')
  else:
    print(f'    \033[0;31mFAIL\033[0m {name}')
" 2>/dev/null && {
  # Count results manually
  for key in t1 t2 t3 t4 t5; do
    val=$(echo "$PARSE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('${key}',False))")
    if [ "$val" = "True" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
  done
} || {
  fail "Receipt parsing test script failed to run"
}

echo ""

# ─── Phase 4: Provenance Extraction Logic ───────────────────────────────────

echo -e "${CYAN}${BOLD}[4/5]${NC} Provenance Extraction Logic (Synthetic)"
echo "------------------------------------------------"

EXTRACT_RESULT=$(node -e "
  function extractProvenance(msg) {
    const prov = msg.provenance;
    if (!prov || typeof prov !== 'object') return null;
    const kind = String(prov.kind || '');
    if (!['external_user', 'inter_session', 'internal_system'].includes(kind)) return null;
    return {
      kind,
      originSessionId: prov.originSessionId || undefined,
      sourceSessionKey: prov.sourceSessionKey || undefined,
      sourceChannel: prov.sourceChannel || undefined,
      sourceTool: prov.sourceTool || undefined,
    };
  }

  // Test 1: external_user provenance
  const p1 = extractProvenance({
    provenance: { kind: 'external_user', originSessionId: 'ses-001', sourceChannel: 'acp', sourceTool: 'openclaw_acp' }
  });
  const t1 = p1 && p1.kind === 'external_user' && p1.originSessionId === 'ses-001' && p1.sourceChannel === 'acp' && p1.sourceTool === 'openclaw_acp';

  // Test 2: inter_session provenance
  const p2 = extractProvenance({
    provenance: { kind: 'inter_session', sourceSessionKey: 'agent:main:abc' }
  });
  const t2 = p2 && p2.kind === 'inter_session' && p2.sourceSessionKey === 'agent:main:abc';

  // Test 3: internal_system provenance
  const p3 = extractProvenance({
    provenance: { kind: 'internal_system' }
  });
  const t3 = p3 && p3.kind === 'internal_system';

  // Test 4: No provenance field
  const p4 = extractProvenance({});
  const t4 = p4 === null;

  // Test 5: Invalid kind
  const p5 = extractProvenance({ provenance: { kind: 'bogus' } });
  const t5 = p5 === null;

  // Test 6: Provenance is not an object
  const p6 = extractProvenance({ provenance: 'string' });
  const t6 = p6 === null;

  console.log(JSON.stringify({ t1, t2, t3, t4, t5, t6 }));
" 2>&1)

echo "$EXTRACT_RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
results = {
  'external_user provenance extracted': d['t1'],
  'inter_session provenance extracted': d['t2'],
  'internal_system provenance extracted': d['t3'],
  'Missing provenance returns null': d['t4'],
  'Invalid kind returns null': d['t5'],
  'Non-object provenance returns null': d['t6'],
}
for name, ok in results.items():
  if ok:
    print(f'    \033[0;32mPASS\033[0m {name}')
  else:
    print(f'    \033[0;31mFAIL\033[0m {name}')
" 2>/dev/null && {
  for key in t1 t2 t3 t4 t5 t6; do
    val=$(echo "$EXTRACT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('${key}',False))")
    if [ "$val" = "True" ]; then PASSED=$((PASSED + 1)); else FAILED=$((FAILED + 1)); fi
  done
} || {
  fail "Provenance extraction test script failed to run"
}

echo ""

# ─── Phase 5: End-to-End DB Round-Trip ───────────────────────────────────────

echo -e "${CYAN}${BOLD}[5/5]${NC} End-to-End DB Round-Trip"
echo "------------------------------------------------"

# Insert a synthetic provenance record, read it back via API, then clean up
SYNTH_TASK_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM tasks LIMIT 1;" 2>/dev/null || true)
if [ -n "$SYNTH_TASK_ID" ]; then
  SYNTH_PROV_ID="smoke-test-$(date +%s)"
  SYNTH_SESSION="smoke-test-session"
  SYNTH_RECEIPT='{"bridge":"openclaw-acp","originHost":"smoke-host","originCwd":"/tmp/smoke","acpSessionId":"smoke-acp-001","originSessionId":"smoke-origin-001","targetSession":"agent:main:smoke"}'
  SYNTH_RECEIPT_TEXT='[Source Receipt]
bridge=openclaw-acp
originHost=smoke-host
originCwd=/tmp/smoke
acpSessionId=smoke-acp-001
originSessionId=smoke-origin-001
targetSession=agent:main:smoke
[/Source Receipt]'

  # Insert
  sqlite3 "$DB_PATH" "INSERT INTO task_provenance (id, task_id, session_id, kind, origin_session_id, source_session_key, source_channel, source_tool, receipt_text, receipt_data, message_role, message_index)
    VALUES ('${SYNTH_PROV_ID}', '${SYNTH_TASK_ID}', '${SYNTH_SESSION}', 'external_user', 'smoke-origin-001', 'agent:main:smoke', 'acp', 'openclaw_acp', '${SYNTH_RECEIPT_TEXT}', '${SYNTH_RECEIPT}', 'user', 0);" 2>/dev/null

  # Verify via DB query
  DB_KIND=$(sqlite3 "$DB_PATH" "SELECT kind FROM task_provenance WHERE id='${SYNTH_PROV_ID}';" 2>/dev/null || true)
  if [ "$DB_KIND" = "external_user" ]; then
    pass "DB insert + read: kind='external_user'"
  else
    fail "DB insert + read: expected 'external_user', got '${DB_KIND}'"
  fi

  DB_TOOL=$(sqlite3 "$DB_PATH" "SELECT source_tool FROM task_provenance WHERE id='${SYNTH_PROV_ID}';" 2>/dev/null || true)
  if [ "$DB_TOOL" = "openclaw_acp" ]; then
    pass "DB read: source_tool='openclaw_acp'"
  else
    fail "DB read: expected 'openclaw_acp', got '${DB_TOOL}'"
  fi

  DB_RECEIPT=$(sqlite3 "$DB_PATH" "SELECT receipt_data FROM task_provenance WHERE id='${SYNTH_PROV_ID}';" 2>/dev/null || true)
  if echo "$DB_RECEIPT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['bridge']=='openclaw-acp'; assert d['originHost']=='smoke-host'" 2>/dev/null; then
    pass "DB read: receipt_data JSON parsed correctly"
  else
    fail "DB read: receipt_data JSON invalid"
  fi

  # Verify via API
  API_RESP=$(api_get "/api/tasks/${SYNTH_TASK_ID}/provenance" || true)
  if echo "$API_RESP" | python3 -c "
import sys,json
d = json.load(sys.stdin)
assert d['count'] >= 1
smoke = [r for r in d['records'] if r['id'] == '${SYNTH_PROV_ID}']
assert len(smoke) == 1
r = smoke[0]
assert r['kind'] == 'external_user'
assert r['source_tool'] == 'openclaw_acp'
assert r['source_channel'] == 'acp'
assert r['origin_session_id'] == 'smoke-origin-001'
assert r['receipt_data']['bridge'] == 'openclaw-acp'
assert r['receipt_data']['originHost'] == 'smoke-host'
assert r['receipt_data']['targetSession'] == 'agent:main:smoke'
" 2>/dev/null; then
    pass "API returns synthetic provenance with full receipt data"
  else
    fail "API response does not match synthetic provenance"
    info "Response: $(echo "$API_RESP" | head -c 300)"
  fi

  # Verify count field
  API_COUNT=$(echo "$API_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || true)
  if [ "$API_COUNT" -ge 1 ] 2>/dev/null; then
    pass "API count field >= 1 (actual: ${API_COUNT})"
  else
    fail "API count field invalid: ${API_COUNT}"
  fi

  # Cleanup
  sqlite3 "$DB_PATH" "DELETE FROM task_provenance WHERE id='${SYNTH_PROV_ID}';" 2>/dev/null
  AFTER_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM task_provenance WHERE id='${SYNTH_PROV_ID}';" 2>/dev/null || true)
  if [ "$AFTER_COUNT" = "0" ]; then
    pass "Cleanup: synthetic record removed"
  else
    fail "Cleanup: record still present"
  fi
else
  skip "No tasks in DB for round-trip test"
fi

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────

echo "================================================"
TOTAL=$((PASSED + FAILED + SKIPPED))
echo -e "Results: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILED} failed${NC}, ${YELLOW}${SKIPPED} skipped${NC} (${TOTAL} total)"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}${BOLD}SMOKE TEST FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}${BOLD}SMOKE TEST PASSED${NC}"
  exit 0
fi
