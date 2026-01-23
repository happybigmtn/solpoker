#!/usr/bin/env bash
#
# Verify release build prerequisites for reproducibility.
# Satisfies AC-PR1.1: Reproducible builds with pinned toolchain versions
#
# Usage: ./scripts/verify-build.sh [--strict]
#
# --strict: Fail if installed toolchain versions do not match pinned versions.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

STRICT=0
if [[ "${1:-}" == "--strict" ]]; then
  STRICT=1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_SCRIPT="$PROJECT_ROOT/scripts/build-release.sh"
TOOLCHAIN_FILE="$PROJECT_ROOT/rust-toolchain.toml"

if [[ ! -f "$BUILD_SCRIPT" ]]; then
  log_err "Missing build script: $BUILD_SCRIPT"
  exit 1
fi

if [[ ! -f "$TOOLCHAIN_FILE" ]]; then
  log_err "Missing pinned Rust toolchain file: $TOOLCHAIN_FILE"
  exit 1
fi

SOLANA_VERSION=$(grep -E '^SOLANA_VERSION=' "$BUILD_SCRIPT" | head -1 | sed -E 's/^[^"]*"([^"]+)".*/\1/')
RUST_VERSION=$(grep -E '^RUST_VERSION=' "$BUILD_SCRIPT" | head -1 | sed -E 's/^[^"]*"([^"]+)".*/\1/')
TOOLCHAIN_RUST=$(grep -E '^channel' "$TOOLCHAIN_FILE" | head -1 | sed -E 's/^[^"]*"([^"]+)".*/\1/')

if [[ -z "$SOLANA_VERSION" || -z "$RUST_VERSION" ]]; then
  log_err "Unable to read pinned versions from build-release.sh"
  exit 1
fi

if [[ "$TOOLCHAIN_RUST" != "$RUST_VERSION" ]]; then
  log_err "rust-toolchain.toml does not match pinned Rust version"
  log_err "  build-release.sh: $RUST_VERSION"
  log_err "  rust-toolchain.toml: $TOOLCHAIN_RUST"
  exit 1
fi

log_ok "Pinned versions are consistent"
log_info "  Solana CLI: $SOLANA_VERSION"
log_info "  Rust: $RUST_VERSION"

if command -v rustc &> /dev/null; then
  INSTALLED_RUST=$(rustc --version | grep -oP '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
  if [[ "$INSTALLED_RUST" != "$RUST_VERSION" ]]; then
    if [[ "$STRICT" -eq 1 ]]; then
      log_err "Installed Rust version mismatch"
      log_err "  Expected: $RUST_VERSION"
      log_err "  Found:    $INSTALLED_RUST"
      exit 1
    fi
    log_warn "Installed Rust version differs (expected $RUST_VERSION, found $INSTALLED_RUST)"
  else
    log_ok "Installed Rust matches pinned version"
  fi
else
  log_warn "rustc not found"
fi

if command -v solana &> /dev/null; then
  INSTALLED_SOLANA=$(solana --version 2>/dev/null | grep -oP 'solana-cli \K[0-9.]+' || echo "unknown")
  if [[ "$INSTALLED_SOLANA" != "$SOLANA_VERSION" ]]; then
    if [[ "$STRICT" -eq 1 ]]; then
      log_err "Installed Solana CLI version mismatch"
      log_err "  Expected: $SOLANA_VERSION"
      log_err "  Found:    $INSTALLED_SOLANA"
      exit 1
    fi
    log_warn "Installed Solana CLI differs (expected $SOLANA_VERSION, found $INSTALLED_SOLANA)"
  else
    log_ok "Installed Solana CLI matches pinned version"
  fi
else
  log_warn "solana CLI not found"
fi

log_ok "Reproducible build prerequisites verified"
