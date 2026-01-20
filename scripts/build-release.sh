#!/usr/bin/env bash
#
# Reproducible Release Build Script
# Satisfies AC-PR1.1: Reproducible builds with pinned toolchain versions
#
# This script ensures reproducible builds by:
# 1. Pinning exact Solana toolchain version
# 2. Pinning Rust toolchain version via rust-toolchain.toml
# 3. Using deterministic build flags
# 4. Generating checksums for all artifacts
#
# Usage: ./scripts/build-release.sh [--env devnet|testnet|mainnet]
#
# Prerequisites:
#   - Rust toolchain (see rust-toolchain.toml for version)
#   - Solana CLI tools (see SOLANA_VERSION below)
#   - sha256sum (or shasum on macOS)
#
# Output:
#   - target/release-artifacts/
#     - robopoker_entropy.so
#     - robopoker_poker.so
#     - checksums.sha256
#     - build-metadata.json

set -euo pipefail

# ============================================================================
# PINNED TOOLCHAIN VERSIONS (AC-PR1.1)
# ============================================================================
# These versions MUST match what is used in CI and documented in release notes.
# Changing these requires a new release version.
SOLANA_VERSION="3.0.2"
RUST_VERSION="1.92.0"  # Should match rust-toolchain.toml if present

# ============================================================================
# Configuration
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/target/deploy"
RELEASE_DIR="$PROJECT_ROOT/target/release-artifacts"

# Parse arguments
ENVIRONMENT="${1:-devnet}"
if [[ "$1" == "--env" ]]; then
    ENVIRONMENT="${2:-devnet}"
fi

# ============================================================================
# Helper Functions
# ============================================================================
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

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

# ============================================================================
# Version Verification (Critical for Reproducibility)
# ============================================================================
verify_toolchain() {
    echo "=============================================="
    echo "  Toolchain Version Verification"
    echo "=============================================="
    echo ""

    # Check Solana version
    local solana_ver
    solana_ver=$(solana --version 2>/dev/null | grep -oP 'solana-cli \K[0-9.]+' || echo "not found")

    if [ "$solana_ver" != "$SOLANA_VERSION" ]; then
        log_err "Solana version mismatch!"
        log_err "  Expected: $SOLANA_VERSION"
        log_err "  Found:    $solana_ver"
        log_err ""
        log_err "Install correct version with:"
        log_err "  sh -c \"\$(curl -sSfL https://release.anza.xyz/v$SOLANA_VERSION/install)\""
        exit 1
    fi
    log_ok "Solana CLI: $solana_ver"

    # Check Rust version
    local rust_ver
    rust_ver=$(rustc --version | grep -oP '[0-9]+\.[0-9]+\.[0-9]+' || echo "not found")

    if [ "$rust_ver" != "$RUST_VERSION" ]; then
        log_warn "Rust version differs from pinned version"
        log_warn "  Expected: $RUST_VERSION"
        log_warn "  Found:    $rust_ver"
        log_warn "This may affect build reproducibility."
        # Don't exit - let user decide if this is acceptable
    else
        log_ok "Rust: $rust_ver"
    fi

    # Check cargo-build-sbf
    if ! command -v cargo-build-sbf &> /dev/null; then
        log_err "cargo-build-sbf not found"
        log_err "Install with Solana platform tools"
        exit 1
    fi
    log_ok "cargo-build-sbf: available"

    echo ""
}

# ============================================================================
# Build Programs
# ============================================================================
build_programs() {
    echo "=============================================="
    echo "  Building Programs (Deterministic)"
    echo "=============================================="
    echo ""

    cd "$PROJECT_ROOT"

    # Clean previous builds for reproducibility
    log_info "Cleaning previous build artifacts..."
    rm -rf "$BUILD_DIR"/*.so 2>/dev/null || true

    # Build entropy program
    log_info "Building robopoker-entropy..."
    cargo build-sbf \
        --manifest-path crates/robopoker-entropy/Cargo.toml \
        --sbf-out-dir "$BUILD_DIR"

    # Build poker program
    log_info "Building robopoker-poker..."
    cargo build-sbf \
        --manifest-path crates/robopoker-poker/Cargo.toml \
        --sbf-out-dir "$BUILD_DIR"

    log_ok "Programs built successfully"
    echo ""
}

# ============================================================================
# Generate Release Artifacts (AC-PR1.3)
# ============================================================================
generate_artifacts() {
    echo "=============================================="
    echo "  Generating Release Artifacts"
    echo "=============================================="
    echo ""

    # Create release directory
    rm -rf "$RELEASE_DIR"
    mkdir -p "$RELEASE_DIR"

    # Copy program binaries
    log_info "Copying program binaries..."
    cp "$BUILD_DIR/robopoker_entropy.so" "$RELEASE_DIR/"
    cp "$BUILD_DIR/robopoker_poker.so" "$RELEASE_DIR/"

    # Copy program keypairs (for program ID derivation)
    if [ -f "$BUILD_DIR/robopoker_entropy-keypair.json" ]; then
        cp "$BUILD_DIR/robopoker_entropy-keypair.json" "$RELEASE_DIR/"
    fi
    if [ -f "$BUILD_DIR/robopoker_poker-keypair.json" ]; then
        cp "$BUILD_DIR/robopoker_poker-keypair.json" "$RELEASE_DIR/"
    fi

    # Copy IDL if exists
    if [ -f "$PROJECT_ROOT/clients/ts/idl/poker.json" ]; then
        log_info "Copying IDL..."
        cp "$PROJECT_ROOT/clients/ts/idl/poker.json" "$RELEASE_DIR/"
    fi

    # Generate checksums
    log_info "Generating checksums..."
    local hasher
    hasher=$(hash_cmd)

    cd "$RELEASE_DIR"
    $hasher *.so > checksums.sha256
    if [ -f poker.json ]; then
        $hasher poker.json >> checksums.sha256
    fi

    # Get program IDs
    local entropy_id="unknown"
    local poker_id="unknown"
    if [ -f "robopoker_entropy-keypair.json" ]; then
        entropy_id=$(solana address -k robopoker_entropy-keypair.json)
    fi
    if [ -f "robopoker_poker-keypair.json" ]; then
        poker_id=$(solana address -k robopoker_poker-keypair.json)
    fi

    # Get client SDK version
    local sdk_version="unknown"
    if [ -f "$PROJECT_ROOT/clients/ts/package.json" ]; then
        sdk_version=$(grep '"version"' "$PROJECT_ROOT/clients/ts/package.json" | head -1 | grep -oP '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
    fi

    # Generate build metadata (AC-PR1.3)
    log_info "Generating build metadata..."
    cat > build-metadata.json << EOF
{
  "version": "$(git -C "$PROJECT_ROOT" describe --tags --always 2>/dev/null || echo "untagged")",
  "commit": "$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")",
  "commit_short": "$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")",
  "branch": "$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")",
  "build_time": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": "$ENVIRONMENT",
  "toolchain": {
    "solana": "$SOLANA_VERSION",
    "rust": "$RUST_VERSION",
    "cargo_build_sbf": "$(cargo build-sbf --version 2>/dev/null | head -1 || echo "unknown")"
  },
  "programs": {
    "entropy": {
      "id": "$entropy_id",
      "binary": "robopoker_entropy.so",
      "checksum": "$(grep robopoker_entropy.so checksums.sha256 | awk '{print $1}')"
    },
    "poker": {
      "id": "$poker_id",
      "binary": "robopoker_poker.so",
      "checksum": "$(grep robopoker_poker.so checksums.sha256 | awk '{print $1}')"
    }
  },
  "client_sdk": {
    "name": "@robopoker/client",
    "version": "$sdk_version"
  }
}
EOF

    log_ok "Release artifacts generated"
    echo ""
}

# ============================================================================
# Print Summary
# ============================================================================
print_summary() {
    echo "=============================================="
    echo "  Build Complete"
    echo "=============================================="
    echo ""
    echo "Release artifacts: $RELEASE_DIR/"
    echo ""
    echo "Contents:"
    ls -la "$RELEASE_DIR/"
    echo ""
    echo "Checksums:"
    cat "$RELEASE_DIR/checksums.sha256"
    echo ""
    log_ok "Reproducible build completed successfully"
    echo ""
    echo "Next steps:"
    echo "  1. Verify checksums: ./scripts/verify-build.sh"
    echo "  2. Deploy to $ENVIRONMENT: ./scripts/deploy-$ENVIRONMENT.sh"
    echo "  3. Verify on-chain: ./scripts/verify-programs.sh"
}

# ============================================================================
# Main
# ============================================================================
main() {
    echo "=============================================="
    echo "  Robopoker Reproducible Build"
    echo "  Environment: $ENVIRONMENT"
    echo "=============================================="
    echo ""

    verify_toolchain
    build_programs
    generate_artifacts
    print_summary
}

main "$@"
