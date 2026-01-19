#!/usr/bin/env bash
#
# Deploy robopoker to Solana devnet
#
# This script:
# 1. Builds both programs (cargo build-sbf)
# 2. Deploys both programs to devnet (if not already deployed)
# 3. Creates CRISPS mint (if not exists)
# 4. Initializes entropy config (if not exists)
# 5. Initializes poker config (if not exists)
# 6. Writes all addresses to clients/ui/.env.local
#
# Tests AC-D4.1, AC-D4.2, AC-D4.3 from specs/devnet-deployment.md
#
# Usage: ./scripts/deploy-devnet.sh
#
# Idempotent: Re-running does not fail or corrupt state.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Project root (one level up from scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Paths
DEPLOY_DIR="$PROJECT_ROOT/target/deploy"
TS_CLIENT_DIR="$PROJECT_ROOT/clients/ts"
UI_DIR="$PROJECT_ROOT/clients/ui"
ENV_FILE="$UI_DIR/.env.local"
MINT_ADDRESS_FILE="$TS_CLIENT_DIR/scripts/.crisps-mint-address"

# Program keypair paths
ENTROPY_KEYPAIR="$DEPLOY_DIR/robopoker_entropy-keypair.json"
POKER_KEYPAIR="$DEPLOY_DIR/robopoker_poker-keypair.json"

# RPC URL
RPC_URL="https://api.devnet.solana.com"

echo "=============================================="
echo "  Robopoker Devnet Deployment"
echo "=============================================="
echo ""

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check solana CLI
    if ! command -v solana &> /dev/null; then
        echo -e "${RED}Error: solana CLI not found${NC}"
        exit 1
    fi

    # Check cargo-build-sbf
    if ! command -v cargo-build-sbf &> /dev/null; then
        echo -e "${RED}Error: cargo-build-sbf not found (install Solana platform tools)${NC}"
        exit 1
    fi

    # Check node/npm
    if ! command -v npx &> /dev/null; then
        echo -e "${RED}Error: npx not found (install Node.js)${NC}"
        exit 1
    fi

    # Check keypair exists
    if [ ! -f "$HOME/.config/solana/id.json" ]; then
        echo -e "${RED}Error: No Solana keypair found at ~/.config/solana/id.json${NC}"
        echo "Run: solana-keygen new"
        exit 1
    fi

    echo -e "${GREEN}✓ Prerequisites satisfied${NC}"
    echo ""
}

# Build programs
build_programs() {
    echo -e "${YELLOW}Building programs...${NC}"

    cd "$PROJECT_ROOT"

    # Build entropy program
    echo "Building robopoker-entropy..."
    cargo build-sbf --manifest-path crates/robopoker-entropy/Cargo.toml

    # Build poker program
    echo "Building robopoker-poker..."
    cargo build-sbf --manifest-path crates/robopoker-poker/Cargo.toml

    echo -e "${GREEN}✓ Programs built${NC}"
    echo ""
}

# Deploy a single program (idempotent)
# Returns program ID via global variable to avoid stdout capture issues
deploy_program() {
    local name=$1
    local keypair=$2
    local so_file=$3

    echo "Deploying $name..." >&2

    # Get program ID from keypair
    local program_id
    program_id=$(solana address -k "$keypair")

    # Check if already deployed
    if solana program show "$program_id" --url "$RPC_URL" &>/dev/null; then
        echo -e "${GREEN}✓ $name already deployed: $program_id${NC}" >&2
        echo "$program_id"
        return 0
    fi

    # Deploy
    echo "  Deploying to devnet (this may take a minute)..." >&2
    solana program deploy "$so_file" \
        --program-id "$keypair" \
        --url "$RPC_URL" \
        --commitment confirmed >&2

    echo -e "${GREEN}✓ $name deployed: $program_id${NC}" >&2
    echo "$program_id"
}

# Deploy both programs
deploy_programs() {
    echo -e "${YELLOW}Deploying programs to devnet...${NC}"

    ENTROPY_PROGRAM_ID=$(deploy_program "robopoker-entropy" "$ENTROPY_KEYPAIR" "$DEPLOY_DIR/robopoker_entropy.so")
    POKER_PROGRAM_ID=$(deploy_program "robopoker-poker" "$POKER_KEYPAIR" "$DEPLOY_DIR/robopoker_poker.so")

    echo ""
}

# Create CRISPS mint (idempotent via address file)
create_mint() {
    echo -e "${YELLOW}Creating CRISPS mint...${NC}"

    cd "$TS_CLIENT_DIR"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing TypeScript client dependencies..."
        npm install
    fi

    # Build if needed
    if [ ! -d "dist" ]; then
        echo "Building TypeScript client..."
        npm run build
    fi

    # Run create-crisps-mint (it's idempotent via .crisps-mint-address file)
    npx tsx scripts/create-crisps-mint.ts

    # Read the mint address
    if [ -f "$MINT_ADDRESS_FILE" ]; then
        CRISPS_MINT=$(cat "$MINT_ADDRESS_FILE")
        echo -e "${GREEN}✓ CRISPS mint: $CRISPS_MINT${NC}"
    else
        echo -e "${RED}Error: Mint address file not created${NC}"
        exit 1
    fi

    echo ""
}

# Initialize configs (idempotent via on-chain checks)
init_configs() {
    echo -e "${YELLOW}Initializing config accounts...${NC}"

    cd "$TS_CLIENT_DIR"

    # Run init-configs with CRISPS mint (script is idempotent - checks if accounts exist)
    ENTROPY_PROGRAM_ID="$ENTROPY_PROGRAM_ID" \
    POKER_PROGRAM_ID="$POKER_PROGRAM_ID" \
    npx tsx scripts/init-configs.ts --crisps-mint "$CRISPS_MINT"

    echo ""
}

# Derive config PDAs using TypeScript helper
derive_pdas() {
    echo -e "${YELLOW}Deriving config PDAs...${NC}"

    cd "$TS_CLIENT_DIR"

    # Use derive-pdas.ts script to get PDAs as JSON
    local pda_json
    pda_json=$(npx tsx scripts/derive-pdas.ts "$ENTROPY_PROGRAM_ID" "$POKER_PROGRAM_ID")

    # Parse JSON output using node for reliability
    ENTROPY_CONFIG_PDA=$(echo "$pda_json" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.entropyConfigPda)")
    POKER_CONFIG_PDA=$(echo "$pda_json" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.pokerConfigPda)")

    echo "  Entropy Config PDA: $ENTROPY_CONFIG_PDA"
    echo "  Poker Config PDA: $POKER_CONFIG_PDA"
    echo ""
}

# Write environment file
write_env_file() {
    echo -e "${YELLOW}Writing environment file...${NC}"

    # Ensure UI directory exists
    mkdir -p "$UI_DIR"

    # Write .env.local
    cat > "$ENV_FILE" << EOF
# Robopoker Devnet Configuration
# Generated by deploy-devnet.sh on $(date -Iseconds)

# Solana RPC endpoints
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com

# Program IDs
NEXT_PUBLIC_ENTROPY_PROGRAM_ID=$ENTROPY_PROGRAM_ID
NEXT_PUBLIC_POKER_PROGRAM_ID=$POKER_PROGRAM_ID

# Config PDAs
NEXT_PUBLIC_ENTROPY_CONFIG_PDA=$ENTROPY_CONFIG_PDA
NEXT_PUBLIC_POKER_CONFIG_PDA=$POKER_CONFIG_PDA

# Token
NEXT_PUBLIC_CRISPS_MINT=$CRISPS_MINT
EOF

    echo -e "${GREEN}✓ Environment file written to: $ENV_FILE${NC}"
    echo ""
}

# Print summary
print_summary() {
    echo "=============================================="
    echo "  Deployment Complete"
    echo "=============================================="
    echo ""
    echo "Programs:"
    echo "  Entropy: $ENTROPY_PROGRAM_ID"
    echo "  Poker:   $POKER_PROGRAM_ID"
    echo ""
    echo "Configs:"
    echo "  Entropy Config: $ENTROPY_CONFIG_PDA"
    echo "  Poker Config:   $POKER_CONFIG_PDA"
    echo ""
    echo "Token:"
    echo "  CRISPS Mint: $CRISPS_MINT"
    echo ""
    echo "Environment file: $ENV_FILE"
    echo ""
    echo -e "${GREEN}All addresses are written to $ENV_FILE${NC}"
}

# Main execution
main() {
    check_prerequisites
    build_programs
    deploy_programs
    create_mint
    init_configs
    derive_pdas
    write_env_file
    print_summary
}

main "$@"
