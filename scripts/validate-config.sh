#!/usr/bin/env bash
#
# Environment Configuration Validation Script
# Satisfies AC-PR1.7: Environment config validation
#
# This script validates configuration files for each environment:
# 1. JSON schema validation
# 2. Required field presence
# 3. Environment consistency checks
# 4. Solana CLI environment match verification
#
# Usage: ./scripts/validate-config.sh [--env devnet|testnet|mainnet] [--allow-placeholders]
#
# Exit codes:
#   0 - Validation passed
#   1 - Validation failed

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$PROJECT_ROOT/config"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Parse arguments
ENVIRONMENT="${1:-}"
ALLOW_PLACEHOLDERS=false
if [[ "${1:-}" == "--env" ]]; then
    ENVIRONMENT="${2:-}"
    shift 2
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --allow-placeholders)
            ALLOW_PLACEHOLDERS=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [[ -z "$ENVIRONMENT" ]]; then
    echo "Usage: $0 --env <devnet|testnet|mainnet>"
    exit 1
fi

if [[ "$ENVIRONMENT" != "devnet" && "$ENVIRONMENT" != "testnet" && "$ENVIRONMENT" != "mainnet" ]]; then
    log_err "Invalid environment: $ENVIRONMENT"
    log_err "Must be one of: devnet, testnet, mainnet"
    exit 1
fi

CONFIG_FILE="$CONFIG_DIR/$ENVIRONMENT.json"
SCHEMA_FILE="$CONFIG_DIR/schema.json"

echo "=============================================="
echo "  Robopoker Config Validation"
echo "  Environment: $ENVIRONMENT"
echo "=============================================="
echo ""

VALIDATION_ERRORS=0

# Check config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    log_err "Config file not found: $CONFIG_FILE"
    exit 1
fi
log_ok "Config file exists: $CONFIG_FILE"

# Check schema file exists
if [[ ! -f "$SCHEMA_FILE" ]]; then
    log_err "Schema file not found: $SCHEMA_FILE"
    exit 1
fi
log_ok "Schema file exists: $SCHEMA_FILE"

# Validate JSON syntax
if ! python3 -m json.tool "$CONFIG_FILE" > /dev/null 2>&1; then
    log_err "Invalid JSON syntax in $CONFIG_FILE"
    exit 1
fi
log_ok "JSON syntax valid"

# Read config using Python for reliable JSON parsing
validate_config() {
    python3 << EOF
import json
import sys

with open("$CONFIG_FILE") as f:
    config = json.load(f)

with open("$SCHEMA_FILE") as f:
    schema = json.load(f)

errors = []

# Check environment matches
if config.get("environment") != "$ENVIRONMENT":
    errors.append(f"Environment mismatch: config says '{config.get('environment')}' but validating for '$ENVIRONMENT'")

# Environment-specific checks
env = "$ENVIRONMENT"
allow_placeholders = "$ALLOW_PLACEHOLDERS".lower() == "true"

# Check required fields from validation section
required_fields = config.get("validation", {}).get("requiredFields", [])
for field_path in required_fields:
    parts = field_path.split(".")
    value = config
    try:
        for part in parts:
            value = value[part]
        if value is None and not allow_placeholders:
            errors.append(f"Required field is null: {field_path}")
    except (KeyError, TypeError):
        errors.append(f"Required field missing: {field_path}")

if env == "mainnet":
    # Mainnet requires program IDs and mint
    if not config.get("programs", {}).get("entropy", {}).get("programId") and not allow_placeholders:
        errors.append("Mainnet requires programs.entropy.programId")
    if not config.get("programs", {}).get("poker", {}).get("programId") and not allow_placeholders:
        errors.append("Mainnet requires programs.poker.programId")
    if not config.get("tokens", {}).get("crispsMint") and not allow_placeholders:
        errors.append("Mainnet requires tokens.crispsMint")
    # Mainnet should not allow test features
    if config.get("features", {}).get("allowTestMints"):
        errors.append("Mainnet should not have allowTestMints=true")
    if config.get("features", {}).get("allowUnlimitedAirdrop"):
        errors.append("Mainnet should not have allowUnlimitedAirdrop=true")
    if config.get("features", {}).get("debugLogging"):
        errors.append("Mainnet should not have debugLogging=true (performance)")

# Check commitment level appropriateness
commitment = config.get("network", {}).get("commitment")
if env == "mainnet" and commitment != "finalized":
    errors.append(f"Mainnet should use 'finalized' commitment, not '{commitment}'")

# Check parameters are reasonable
entropy_config = config.get("parameters", {}).get("entropyConfig", {})
if entropy_config.get("minBond", 0) < 0:
    errors.append("entropyConfig.minBond cannot be negative")
if entropy_config.get("slashBasisPoints", 0) > 10000:
    errors.append("entropyConfig.slashBasisPoints cannot exceed 10000 (100%)")

poker_config = config.get("parameters", {}).get("pokerConfig", {})
if poker_config.get("minBuyIn", 0) > poker_config.get("maxBuyIn", 0):
    errors.append("pokerConfig.minBuyIn cannot exceed maxBuyIn")
if poker_config.get("rakeBps", 0) > 10000:
    errors.append("pokerConfig.rakeBps cannot exceed 10000 (100%)")

# Output errors
if errors:
    for err in errors:
        print(f"ERROR: {err}")
    sys.exit(1)
else:
    print("CONFIG_VALID")
    sys.exit(0)
EOF
}

log_info "Validating config fields..."
validation_output=$(validate_config 2>&1) || true
if echo "$validation_output" | grep -q "CONFIG_VALID"; then
    log_ok "All required fields present and valid"
else
    echo "$validation_output" | while read -r line; do
        if [[ "$line" == ERROR:* ]]; then
            log_err "${line#ERROR: }"
            ((VALIDATION_ERRORS++)) || true
        fi
    done
    log_err "Config validation failed"
    exit 1
fi

# Verify Solana CLI environment if available
if command -v solana &> /dev/null; then
    log_info "Checking Solana CLI configuration..."

    solana_url=$(solana config get 2>/dev/null | grep "RPC URL" | awk '{print $NF}' || echo "")

    case "$ENVIRONMENT" in
        devnet)
            expected_pattern="devnet"
            ;;
        testnet)
            expected_pattern="testnet"
            ;;
        mainnet)
            expected_pattern="mainnet"
            ;;
    esac

    if [[ "$solana_url" == *"$expected_pattern"* ]]; then
        log_ok "Solana CLI configured for $ENVIRONMENT: $solana_url"
    else
        log_warn "Solana CLI may be configured for different environment"
        log_warn "  Current URL: $solana_url"
        log_warn "  Expected to contain: $expected_pattern"
        log_warn "  Run: solana config set --url <appropriate-url>"
    fi
else
    log_warn "Solana CLI not found - skipping environment match check"
fi

# Summary
echo ""
echo "=============================================="
echo "  Validation Summary"
echo "=============================================="
echo ""

if [[ $VALIDATION_ERRORS -eq 0 ]]; then
    log_ok "Config validation PASSED for $ENVIRONMENT"
    echo ""
    echo "Config is ready for use with:"
    echo "  ./scripts/deploy-$ENVIRONMENT.sh"
    echo "  ./scripts/build-release.sh --env $ENVIRONMENT"
    exit 0
else
    log_err "Config validation FAILED with $VALIDATION_ERRORS error(s)"
    exit 1
fi
