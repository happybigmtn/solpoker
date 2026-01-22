#!/usr/bin/env bash
#
# Fix poker config by deploying a fresh poker program
# and initializing it with the correct CRISPS mint
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TS_CLIENT_DIR="$PROJECT_ROOT/clients/ts"
UI_DIR="$PROJECT_ROOT/clients/ui"
ENV_FILE="$UI_DIR/.env.local"

RPC_URL="https://api.devnet.solana.com"
CRISPS_MINT="7HK33BUJivS2nSsJjZwgpBDQRrSY59WeCYmSQQtJqW3B"

echo "=============================================="
echo "  Fix Poker Config - Fresh Deployment"
echo "=============================================="
echo ""

# Generate new poker program keypair
echo "Generating new poker program keypair..."
NEW_POKER_KEYPAIR="$PROJECT_ROOT/target/deploy/robopoker_poker_new-keypair.json"
solana-keygen new --outfile "$NEW_POKER_KEYPAIR" --no-bip39-passphrase --force

NEW_POKER_PROGRAM_ID=$(solana address -k "$NEW_POKER_KEYPAIR")
echo "New Poker Program ID: $NEW_POKER_PROGRAM_ID"

# Update the program ID in lib.rs BEFORE building
POKER_LIB_RS="$PROJECT_ROOT/crates/robopoker-poker/src/lib.rs"
echo ""
echo "Updating declare_id! in lib.rs with new program ID..."
sed -i "s|pinocchio_pubkey::declare_id!(\"[^\"]*\")|pinocchio_pubkey::declare_id!(\"$NEW_POKER_PROGRAM_ID\")|" "$POKER_LIB_RS"
grep "declare_id" "$POKER_LIB_RS"

# Build poker program
echo ""
echo "Building poker program..."
cd "$PROJECT_ROOT"
cargo build-sbf --manifest-path crates/robopoker-poker/Cargo.toml

# Deploy new poker program
echo ""
echo "Deploying poker program to devnet..."
solana program deploy \
    "$PROJECT_ROOT/target/deploy/robopoker_poker.so" \
    --program-id "$NEW_POKER_KEYPAIR" \
    --url "$RPC_URL" \
    --commitment confirmed

echo "Poker program deployed: $NEW_POKER_PROGRAM_ID"

# Initialize poker config with correct CRISPS mint
echo ""
echo "Initializing poker config with CRISPS mint: $CRISPS_MINT"
cd "$TS_CLIENT_DIR"

# Get entropy program ID from existing env
ENTROPY_PROGRAM_ID=$(grep NEXT_PUBLIC_ENTROPY_PROGRAM_ID "$ENV_FILE" | cut -d'=' -f2)

# Run init-configs with the new poker program ID
# The script will skip entropy (already exists) and init the new poker config
ENTROPY_PROGRAM_ID="$ENTROPY_PROGRAM_ID" \
POKER_PROGRAM_ID="$NEW_POKER_PROGRAM_ID" \
npx tsx scripts/init-configs.ts --crisps-mint "$CRISPS_MINT"

# Derive new PDAs
echo ""
echo "Deriving config PDAs..."
pda_json=$(npx tsx scripts/derive-pdas.ts "$ENTROPY_PROGRAM_ID" "$NEW_POKER_PROGRAM_ID")
ENTROPY_CONFIG_PDA=$(echo "$pda_json" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.entropyConfigPda)")
POKER_CONFIG_PDA=$(echo "$pda_json" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.pokerConfigPda)")

# Update .env.local
echo ""
echo "Updating .env.local..."
cat > "$ENV_FILE" << EOF
# Robopoker Devnet Configuration
# Fixed by fix-poker-config.sh on $(date -Iseconds)

# Solana RPC endpoints
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com

# Program IDs
NEXT_PUBLIC_ENTROPY_PROGRAM_ID=$ENTROPY_PROGRAM_ID
NEXT_PUBLIC_POKER_PROGRAM_ID=$NEW_POKER_PROGRAM_ID

# Config PDAs
NEXT_PUBLIC_ENTROPY_CONFIG_PDA=$ENTROPY_CONFIG_PDA
NEXT_PUBLIC_POKER_CONFIG_PDA=$POKER_CONFIG_PDA

# Token
NEXT_PUBLIC_CRISPS_MINT=$CRISPS_MINT
EOF

echo ""
echo "=============================================="
echo "  Fix Complete"
echo "=============================================="
echo ""
echo "New Poker Program ID: $NEW_POKER_PROGRAM_ID"
echo "Poker Config PDA: $POKER_CONFIG_PDA"
echo "CRISPS Mint: $CRISPS_MINT"
echo ""
echo "Environment file updated: $ENV_FILE"
echo ""
echo "Now rebuild and redeploy the UI:"
echo "  cd $UI_DIR && npm run build && netlify deploy --prod --dir=out"
