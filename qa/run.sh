#!/usr/bin/env bash
# qa/run.sh — QA runner for aiq
# Contract: https://github.com/ebarakos/claude-automation/blob/main/docs/plans/qa-runner-contract.md
#
# Usage: ./qa/run.sh   (from project root)
#
# Output protocol:
#   QA: <suite-name> <pass|fail|skip>   — one line per suite
#   QA_RESULT: pass|fail|none           — always the last line
# Exit codes: 0=pass/none, 1=fail, 2=infra error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Log file
RUNS_DIR="$PROJECT_ROOT/qa/runs"
mkdir -p "$RUNS_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M)"
LOG_FILE="$RUNS_DIR/runner-$TIMESTAMP.log"

# Tee all output (stdout + stderr) to the log file while still printing to terminal
exec > >(tee -a "$LOG_FILE") 2>&1

cd "$PROJECT_ROOT"

# --------------------------------------------------------------------------
# Cleanup tracking — only tear down what WE started
# --------------------------------------------------------------------------
_STARTED_SERVER=0
_SERVER_PID=""

cleanup() {
  if [[ "$_STARTED_SERVER" == "1" && -n "$_SERVER_PID" ]]; then
    kill "$_SERVER_PID" 2>/dev/null || true
    wait "$_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
suite_pass() { echo "QA: $1 pass"; }
suite_fail() { echo "QA: $1 fail"; }
suite_skip() { echo "QA: $1 skip"; }

# Run a command with a timeout; return its exit code.
run_suite() {
  local name="$1"; shift
  local timeout_sec="${QA_TIMEOUT:-120}"
  local rc=0
  timeout "$timeout_sec" bash -c "$*" || rc=$?
  return $rc
}

# --------------------------------------------------------------------------
# Suite: typecheck
# --------------------------------------------------------------------------
run_typecheck() {
  echo "--- suite: typecheck ---"
  local rc=0
  run_suite typecheck "npm run typecheck --silent" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]]; then
    suite_pass typecheck
    return 0
  else
    suite_fail typecheck
    return 1
  fi
}

# --------------------------------------------------------------------------
# Suite: test (vitest unit tests — 114 tests, no LLM, mocked)
# --------------------------------------------------------------------------
run_test() {
  echo "--- suite: test ---"
  local rc=0
  run_suite test "npm run test --silent" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]]; then
    suite_pass test
    return 0
  else
    suite_fail test
    return 1
  fi
}

# --------------------------------------------------------------------------
# Suite: bank:verify (schema + rule + fingerprint integrity, no LLM)
# --------------------------------------------------------------------------
run_bank_verify() {
  echo "--- suite: bank:verify ---"
  local rc=0
  run_suite "bank:verify" "npm run bank:verify --silent" 2>&1 || rc=$?
  if [[ $rc -eq 0 ]]; then
    suite_pass "bank:verify"
    return 0
  else
    suite_fail "bank:verify"
    return 1
  fi
}

# --------------------------------------------------------------------------
# Suite: agent:smoke — SKIP
# Rationale: sends real vision-model requests through the relay to multiple
# providers (openrouter/gemini-3-flash, openai/gpt-4o-mini, openai/gpt-4.1-mini,
# groq/llama-4-scout). Even free-tier calls consume relay quota, are unbounded
# in latency, and require valid API credentials in .env.local — not appropriate
# for a local CI gate. Covered by manual smoke runs / relay health checks.
# --------------------------------------------------------------------------
run_agent_smoke_skip() {
  echo "--- suite: agent:smoke (skip: calls real LLM vision models via relay) ---"
  suite_skip "agent:smoke"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
echo "=== aiq QA runner — $(date) ==="
echo "project: $PROJECT_ROOT"
echo "log: $LOG_FILE"
echo ""

FAIL=0

# Run all suites; accumulate failures
run_typecheck    || FAIL=1
run_test         || FAIL=1
run_bank_verify  || FAIL=1
run_agent_smoke_skip

echo ""

# Determine result
if [[ $FAIL -eq 0 ]]; then
  echo "QA_RESULT: pass"
  exit 0
else
  echo "QA_RESULT: fail"
  exit 1
fi
