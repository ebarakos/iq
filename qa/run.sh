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
# Helpers
# --------------------------------------------------------------------------
suite_pass() { echo "QA: $1 pass"; }
suite_fail() { echo "QA: $1 fail"; }
suite_skip() { echo "QA: $1 skip"; }

# Run one npm script as a suite, with a timeout in seconds (QA_TIMEOUT overrides it).
run_suite() {
  local name="$1" default_timeout="$2"
  local rc=0
  echo "--- suite: $name ---"
  timeout "${QA_TIMEOUT:-$default_timeout}" npm run "$name" --silent 2>&1 || rc=$?
  if [[ $rc -eq 0 ]]; then
    suite_pass "$name"
    return 0
  fi
  suite_fail "$name"
  return 1
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

# The full local gate from CLAUDE.md, in the same order; accumulate failures.
run_suite typecheck       300 || FAIL=1
run_suite lint            300 || FAIL=1
run_suite test            900 || FAIL=1
run_suite families:verify 600 || FAIL=1
run_suite bank:verify     300 || FAIL=1
run_suite build           600 || FAIL=1
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
