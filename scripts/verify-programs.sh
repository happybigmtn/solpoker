#!/usr/bin/env bash
#
# Program Verification Script
# Satisfies AC-PR1.2: On-chain verification with stored verification artifacts
#
# This script:
# 1. Compares deployed bytecode against local builds
# 2. Stores verification artifacts (hashes, timestamps)
# 3. Supports verification against on-chain registries (osec.io/solana-verify)
#
# Usage: ./scripts/verify-programs.sh [--env devnet|testnet|mainnet] [--store]
#
# Options:
#   --env ENV   Target environment (devnet, testnet, mainnet) [default: devnet]
#   --store     Store verification artifacts in target/verification/
#
# Output:
#   Verification report with bytecode hash comparison
#   Optional: target/verification/verification-{timestamp}.json

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_ROOT/target/deploy"
RELEASE_DIR="$PROJECT_ROOT/target/release-artifacts"
VERIFICATION_DIR="$PROJECT_ROOT/target/verification"

# Defaults
ENVIRONMENT="devnet"
STORE_ARTIFACTS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --store)
            STORE_ARTIFACTS=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# RPC URLs by environment
case "$ENVIRONMENT" in
    devnet)
        RPC_URL="https://api.devnet.solana.com"
        ;;
    testnet)
        RPC_URL="https://api.testnet.solana.com"
        ;;
    mainnet|mainnet-beta)
        RPC_URL="https://api.mainnet-beta.solana.com"
        ;;
    *)
        echo -e "${RED}Unknown environment: $ENVIRONMENT${NC}"
        exit 1
        ;;
esac

# Program keypairs
ENTROPY_KEYPAIR="$DEPLOY_DIR/robopoker_entropy-keypair.json"
POKER_KEYPAIR="$DEPLOY_DIR/robopoker_poker-keypair.json"

# Program binaries (prefer release-artifacts if available)
if [ -f "$RELEASE_DIR/robopoker_entropy.so" ]; then
    ENTROPY_SO="$RELEASE_DIR/robopoker_entropy.so"
    POKER_SO="$RELEASE_DIR/robopoker_poker.so"
else
    ENTROPY_SO="$DEPLOY_DIR/robopoker_entropy.so"
    POKER_SO="$DEPLOY_DIR/robopoker_poker.so"
fi

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

hash_cmd() {
    if command -v sha256sum &> /dev/null; then
        echo "sha256sum"
    elif command -v shasum &> /dev/null; then
        echo "shasum -a 256"
    else
        log_err "sha256sum or shasum not found"
        exit 1
    fi
}

# Verification result accumulator
VERIFICATION_RESULTS=()
VERIFICATION_SUCCESS=true

# Verify a single program
verify_program() {
    local name=$1
    local keypair=$2
    local so_file=$3

    if [ ! -f "$so_file" ]; then
        log_err "Missing $so_file (run ./scripts/build-release.sh first)"
        VERIFICATION_SUCCESS=false
        return 1
    fi

    if [ ! -f "$keypair" ]; then
        log_err "Missing keypair $keypair"
        VERIFICATION_SUCCESS=false
        return 1
    fi

    local program_id
    program_id=$(solana address -k "$keypair")

    echo -e "${YELLOW}Verifying $name ($program_id)...${NC}"

    # Check if program is deployed
    if ! solana program show "$program_id" --url "$RPC_URL" &>/dev/null; then
        log_warn "$name not deployed on $ENVIRONMENT"
        VERIFICATION_RESULTS+=("{\"program\": \"$name\", \"id\": \"$program_id\", \"status\": \"not_deployed\"}")
        return 0
    fi

    # Dump deployed bytecode
    local dump_file
    dump_file=$(mktemp)
    trap "rm -f $dump_file" EXIT

    solana program dump "$program_id" "$dump_file" --url "$RPC_URL" >/dev/null

    # Compute hashes
    local hasher
    hasher=$(hash_cmd)

    local local_hash deployed_hash
    local_hash=$($hasher "$so_file" | awk '{print $1}')
    deployed_hash=$($hasher "$dump_file" | awk '{print $1}')

    local local_size deployed_size
    local_size=$(stat -f%z "$so_file" 2>/dev/null || stat -c%s "$so_file" 2>/dev/null)
    deployed_size=$(stat -f%z "$dump_file" 2>/dev/null || stat -c%s "$dump_file" 2>/dev/null)

    rm -f "$dump_file"

    # Compare
    if [ "$local_hash" != "$deployed_hash" ]; then
        log_err "BYTECODE MISMATCH for $name"
        echo "  Local hash:    $local_hash (size: $local_size)"
        echo "  Deployed hash: $deployed_hash (size: $deployed_size)"
        VERIFICATION_SUCCESS=false
        VERIFICATION_RESULTS+=("{\"program\": \"$name\", \"id\": \"$program_id\", \"status\": \"mismatch\", \"local_hash\": \"$local_hash\", \"deployed_hash\": \"$deployed_hash\"}")
        return 1
    fi

    log_ok "$name bytecode VERIFIED"
    echo "  Program ID: $program_id"
    echo "  Hash: $local_hash"
    echo "  Size: $local_size bytes"
    VERIFICATION_RESULTS+=("{\"program\": \"$name\", \"id\": \"$program_id\", \"status\": \"verified\", \"hash\": \"$local_hash\", \"size\": $local_size}")
    echo ""
}

# Check on-chain verification registry (osec.io / solana-verify)
check_onchain_verification() {
    local program_id=$1
    local name=$2

    # Check if solana-verify CLI is available
    if command -v solana-verify &> /dev/null; then
        log_info "Checking on-chain verification registry for $name..."
        if solana-verify get-program-hash "$program_id" --url "$RPC_URL" &>/dev/null; then
            local registry_hash
            registry_hash=$(solana-verify get-program-hash "$program_id" --url "$RPC_URL" 2>/dev/null || echo "")
            if [ -n "$registry_hash" ]; then
                log_ok "On-chain verification found: $registry_hash"
                return 0
            fi
        fi
        log_warn "No on-chain verification found for $name"
    else
        log_info "solana-verify CLI not installed (optional for on-chain registry verification)"
        log_info "Install with: cargo install solana-verify"
    fi
}

# Store verification artifacts
store_artifacts() {
    if [ "$STORE_ARTIFACTS" = false ]; then
        return 0
    fi

    mkdir -p "$VERIFICATION_DIR"

    local timestamp
    timestamp=$(date -u +"%Y%m%d-%H%M%S")

    local artifact_file="$VERIFICATION_DIR/verification-$ENVIRONMENT-$timestamp.json"

    # Build JSON
    cat > "$artifact_file" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": "$ENVIRONMENT",
  "rpc_url": "$RPC_URL",
  "commit": "$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")",
  "verification_success": $VERIFICATION_SUCCESS,
  "programs": [
    $(IFS=,; echo "${VERIFICATION_RESULTS[*]}")
  ]
}
EOF

    log_ok "Verification artifacts stored: $artifact_file"
}

# Print on-chain verification instructions
print_onchain_instructions() {
    if [ "$ENVIRONMENT" = "mainnet" ] || [ "$ENVIRONMENT" = "mainnet-beta" ]; then
        echo ""
        echo "=============================================="
        echo "  On-Chain Verification (Recommended)"
        echo "=============================================="
        echo ""
        echo "For mainnet deployments, consider registering your build with"
        echo "an on-chain verification registry (e.g., osec.io/solana-verify):"
        echo ""
        echo "  1. Install solana-verify: cargo install solana-verify"
        echo "  2. Build with verification: solana-verify build"
        echo "  3. Verify against registry: solana-verify verify-from-repo"
        echo ""
        echo "This provides third-party attestation that deployed bytecode"
        echo "matches audited source code."
        echo ""
    fi
}

# Main
main() {
    echo "=============================================="
    echo "  Robopoker Program Verification"
    echo "  Environment: $ENVIRONMENT"
    echo "=============================================="
    echo ""
    echo "RPC: $RPC_URL"
    echo "Source: $(dirname "$ENTROPY_SO")"
    echo ""

    verify_program "robopoker-entropy" "$ENTROPY_KEYPAIR" "$ENTROPY_SO" || true
    verify_program "robopoker-poker" "$POKER_KEYPAIR" "$POKER_SO" || true

    # Optional: Check on-chain verification registries
    if [ -f "$ENTROPY_KEYPAIR" ]; then
        check_onchain_verification "$(solana address -k "$ENTROPY_KEYPAIR")" "entropy"
    fi

    store_artifacts

    echo "=============================================="
    echo "  Verification Summary"
    echo "=============================================="
    echo ""

    if [ "$VERIFICATION_SUCCESS" = true ]; then
        log_ok "All programs verified successfully"
        print_onchain_instructions
        exit 0
    else
        log_err "Verification failed - see errors above"
        exit 1
    fi
}

main "$@"
