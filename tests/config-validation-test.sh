#!/usr/bin/env bash
#
# Config Validation Test Plan (AC-PR1.7)
#
# Tests that environment configurations are valid and properly structured.
#
# Usage: ./tests/config-validation-test.sh
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$PROJECT_ROOT/config"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

test_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
    ((TESTS_RUN++))
}

test_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    echo -e "       $2"
    ((TESTS_FAILED++))
    ((TESTS_RUN++))
}

echo "=============================================="
echo "  Config Validation Test Suite"
echo "=============================================="
echo ""

# Test 1: Config files exist
echo "Test 1: Config files exist"
for env in devnet testnet mainnet; do
    if [[ -f "$CONFIG_DIR/$env.json" ]]; then
        test_pass "  $env.json exists"
    else
        test_fail "  $env.json exists" "File not found: $CONFIG_DIR/$env.json"
    fi
done

if [[ -f "$CONFIG_DIR/schema.json" ]]; then
    test_pass "  schema.json exists"
else
    test_fail "  schema.json exists" "File not found: $CONFIG_DIR/schema.json"
fi
echo ""

# Test 2: JSON syntax valid
echo "Test 2: JSON syntax validation"
for env in devnet testnet mainnet schema; do
    if python3 -m json.tool "$CONFIG_DIR/$env.json" > /dev/null 2>&1; then
        test_pass "  $env.json valid JSON"
    else
        test_fail "  $env.json valid JSON" "Invalid JSON syntax"
    fi
done
echo ""

# Test 3: Environment field matches filename
echo "Test 3: Environment field matches filename"
for env in devnet testnet mainnet; do
    env_field=$(python3 -c "import json; print(json.load(open('$CONFIG_DIR/$env.json'))['environment'])" 2>/dev/null || echo "ERROR")
    if [[ "$env_field" == "$env" ]]; then
        test_pass "  $env.json environment field = '$env'"
    else
        test_fail "  $env.json environment field = '$env'" "Got: '$env_field'"
    fi
done
echo ""

# Test 4: Required fields present
echo "Test 4: Required fields present"
for env in devnet testnet mainnet; do
    has_network=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/$env.json')); print('network' in c and 'rpcUrl' in c['network'])" 2>/dev/null)
    if [[ "$has_network" == "True" ]]; then
        test_pass "  $env.json has network.rpcUrl"
    else
        test_fail "  $env.json has network.rpcUrl" "Missing network.rpcUrl"
    fi

    has_programs=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/$env.json')); print('programs' in c and 'entropy' in c['programs'] and 'poker' in c['programs'])" 2>/dev/null)
    if [[ "$has_programs" == "True" ]]; then
        test_pass "  $env.json has programs.entropy and programs.poker"
    else
        test_fail "  $env.json has programs.entropy and programs.poker" "Missing program config"
    fi
done
echo ""

# Test 5: Mainnet safety checks
echo "Test 5: Mainnet safety checks"
mainnet_test_mints=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/mainnet.json')); print(c.get('features',{}).get('allowTestMints', True))" 2>/dev/null)
if [[ "$mainnet_test_mints" == "False" ]]; then
    test_pass "  mainnet allowTestMints = false"
else
    test_fail "  mainnet allowTestMints = false" "Mainnet should not allow test mints"
fi

mainnet_airdrop=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/mainnet.json')); print(c.get('features',{}).get('allowUnlimitedAirdrop', True))" 2>/dev/null)
if [[ "$mainnet_airdrop" == "False" ]]; then
    test_pass "  mainnet allowUnlimitedAirdrop = false"
else
    test_fail "  mainnet allowUnlimitedAirdrop = false" "Mainnet should not allow unlimited airdrop"
fi

mainnet_debug=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/mainnet.json')); print(c.get('features',{}).get('debugLogging', True))" 2>/dev/null)
if [[ "$mainnet_debug" == "False" ]]; then
    test_pass "  mainnet debugLogging = false"
else
    test_fail "  mainnet debugLogging = false" "Mainnet should not have debug logging enabled"
fi

mainnet_commitment=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/mainnet.json')); print(c.get('network',{}).get('commitment',''))" 2>/dev/null)
if [[ "$mainnet_commitment" == "finalized" ]]; then
    test_pass "  mainnet commitment = finalized"
else
    test_fail "  mainnet commitment = finalized" "Mainnet should use 'finalized' commitment, got: '$mainnet_commitment'"
fi
echo ""

# Test 6: Parameter bounds
echo "Test 6: Parameter bounds validation"
for env in devnet testnet mainnet; do
    slash_bps=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/$env.json')); print(c['parameters']['entropyConfig']['slashBasisPoints'])" 2>/dev/null || echo "0")
    if [[ "$slash_bps" -le 10000 ]]; then
        test_pass "  $env.json slashBasisPoints <= 10000"
    else
        test_fail "  $env.json slashBasisPoints <= 10000" "Got: $slash_bps"
    fi

    rake_bps=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/$env.json')); print(c['parameters']['pokerConfig']['rakeBps'])" 2>/dev/null || echo "0")
    if [[ "$rake_bps" -le 10000 ]]; then
        test_pass "  $env.json rakeBps <= 10000"
    else
        test_fail "  $env.json rakeBps <= 10000" "Got: $rake_bps"
    fi

    min_buy=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/$env.json')); print(c['parameters']['pokerConfig']['minBuyIn'])" 2>/dev/null || echo "0")
    max_buy=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/$env.json')); print(c['parameters']['pokerConfig']['maxBuyIn'])" 2>/dev/null || echo "0")
    if [[ "$min_buy" -le "$max_buy" ]]; then
        test_pass "  $env.json minBuyIn <= maxBuyIn"
    else
        test_fail "  $env.json minBuyIn <= maxBuyIn" "minBuyIn=$min_buy > maxBuyIn=$max_buy"
    fi
done
echo ""

# Test 7: Validate-config script exists and is executable
echo "Test 7: Validate script exists"
if [[ -x "$PROJECT_ROOT/scripts/validate-config.sh" ]]; then
    test_pass "  validate-config.sh executable"
else
    test_fail "  validate-config.sh executable" "Not found or not executable"
fi

# Test 8: Run validate-config.sh for devnet (should pass)
echo ""
echo "Test 8: Run validate-config.sh for devnet"
if "$PROJECT_ROOT/scripts/validate-config.sh" --env devnet > /dev/null 2>&1; then
    test_pass "  validate-config.sh --env devnet succeeds"
else
    test_fail "  validate-config.sh --env devnet succeeds" "Validation script failed"
fi

# Summary
echo ""
echo "=============================================="
echo "  Test Summary"
echo "=============================================="
echo ""
echo "Tests run:    $TESTS_RUN"
echo "Tests passed: $TESTS_PASSED"
echo "Tests failed: $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}All tests PASSED${NC}"
    exit 0
else
    echo -e "${RED}$TESTS_FAILED test(s) FAILED${NC}"
    exit 1
fi
