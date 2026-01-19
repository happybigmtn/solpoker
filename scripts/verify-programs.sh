#!/usr/bin/env bash
#
# Verify deployed program bytecode matches local build
# Tests AC-D1.3 from specs/devnet-deployment.md
#
# Usage: ./scripts/verify-programs.sh
# Optional: RPC_URL=https://api.devnet.solana.com ./scripts/verify-programs.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_ROOT/target/deploy"

ENTROPY_KEYPAIR="$DEPLOY_DIR/robopoker_entropy-keypair.json"
POKER_KEYPAIR="$DEPLOY_DIR/robopoker_poker-keypair.json"
ENTROPY_SO="$DEPLOY_DIR/robopoker_entropy.so"
POKER_SO="$DEPLOY_DIR/robopoker_poker.so"

RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"

hash_cmd() {
    if command -v sha256sum &> /dev/null; then
        echo "sha256sum"
    elif command -v shasum &> /dev/null; then
        echo "shasum -a 256"
    else
        echo -e "${RED}Error: sha256sum or shasum not found${NC}" >&2
        exit 1
    fi
}

verify_program() {
    local name=$1
    local keypair=$2
    local so_file=$3

    if [ ! -f "$so_file" ]; then
        echo -e "${RED}Error: Missing $so_file (run cargo build-sbf)${NC}" >&2
        exit 1
    fi

    local program_id
    program_id=$(solana address -k "$keypair")

    echo -e "${YELLOW}Verifying $name ($program_id)...${NC}"

    local dump_file
    dump_file=$(mktemp)

    solana program dump "$program_id" "$dump_file" --url "$RPC_URL" >/dev/null

    local hasher
    hasher=$(hash_cmd)

    local local_hash
    local deployed_hash
    local_hash=$($hasher "$so_file" | awk '{print $1}')
    deployed_hash=$($hasher "$dump_file" | awk '{print $1}')

    rm -f "$dump_file"

    if [ "$local_hash" != "$deployed_hash" ]; then
        echo -e "${RED}✗ Bytecode mismatch for $name${NC}"
        echo "  Local:    $local_hash"
        echo "  Deployed: $deployed_hash"
        exit 1
    fi

    echo -e "${GREEN}✓ $name bytecode matches local build${NC}"
    echo ""
}

main() {
    echo "=============================================="
    echo "  Robopoker Program Verification"
    echo "=============================================="
    echo ""
    echo "RPC: $RPC_URL"
    echo ""

    verify_program "robopoker-entropy" "$ENTROPY_KEYPAIR" "$ENTROPY_SO"
    verify_program "robopoker-poker" "$POKER_KEYPAIR" "$POKER_SO"

    echo -e "${GREEN}All program bytecode verified.${NC}"
}

main "$@"
