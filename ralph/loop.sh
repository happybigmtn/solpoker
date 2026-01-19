#!/bin/bash
# Wrapper to preserve Ralph README conventions.
set -euo pipefail
exec "$(dirname "$0")/loopclaude.sh" "$@"
