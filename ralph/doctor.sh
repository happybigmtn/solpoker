#!/bin/bash
set -euo pipefail

missing=0

need() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing: $bin"
    missing=1
  fi
}

need git
need jq
need claude

if [ "$missing" -ne 0 ]; then
  echo ""
  echo "Install the missing tools and re-run: ralph/doctor.sh"
  exit 1
fi

echo "OK: git, jq, claude present"
