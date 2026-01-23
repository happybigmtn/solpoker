#!/usr/bin/env bash
set -euo pipefail

REPORT="ralph/docs/reliability/LOAD_TEST_REPORT.md"

if [[ ! -f "${REPORT}" ]]; then
  echo "Missing load test report: ${REPORT}" >&2
  exit 1
fi

missing=0

require_line() {
  local pattern="$1"
  local label="$2"
  if ! grep -Eq "${pattern}" "${REPORT}"; then
    echo "Missing ${label} in ${REPORT}" >&2
    missing=1
  fi
}

require_line '^-\s+Max concurrent tables:\s+[0-9]+' "max concurrent tables"
require_line '^-\s+Max concurrent players:\s+[0-9]+' "max concurrent players"
require_line '^-\s+Target latency p95:\s+.*[0-9]+' "target latency p95"
require_line '^-\s+Target latency p99:\s+.*[0-9]+' "target latency p99"

if [[ "${missing}" -ne 0 ]]; then
  exit 1
fi

echo "Load test report checks passed."
