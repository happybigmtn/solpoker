#!/bin/bash
set -euo pipefail

if [ -e "specs" ]; then
  echo "specs/ already exists; refusing to overwrite"
  exit 1
fi

mkdir -p "specs/archive"

cat > "specs/README.md" <<'EOF'
# Specs

Put requirements here as small, focused markdown documents.

Each spec should include Acceptance Criteria with stable IDs so that:
- Planning can derive tests/backpressure from the ACs
- Building can implement only what is explicitly required

Suggested structure:

- Overview
- Acceptance Criteria
  - AC-1, AC-2... with bullet subcriteria (AC-1.1, AC-1.2, ...)
  - Optional perceptual criteria as AC-PQ.*
- Non-goals
- Notes / constraints
EOF

touch "specs/archive/.keep"

echo "Created specs/ skeleton"
