#!/usr/bin/env bash
#
# Verify release artifacts and stored verification metadata.
# Satisfies:
#  - AC-PR1.2: On-chain verification artifacts stored and verifiable
#  - AC-PR1.3: Release artifacts include program IDs, IDL, SDK versions, tags, and checksums
#
# Usage:
#   ./scripts/verify-release-artifacts.sh [--strict] [--require-success] [--skip-verification]
#
# Options:
#   --strict            Fail on warnings (missing tag, missing artifacts)
#   --require-success   Require verification_success=true in stored artifacts
#   --skip-verification Skip checking target/verification artifacts

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
REQUIRE_SUCCESS=0
SKIP_VERIFICATION=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=1
      shift
      ;;
    --require-success)
      REQUIRE_SUCCESS=1
      shift
      ;;
    --skip-verification)
      SKIP_VERIFICATION=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$PROJECT_ROOT/target/release-artifacts"
VERIFICATION_DIR="$PROJECT_ROOT/target/verification"

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

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    log_err "Missing required file: $path"
    exit 1
  fi
}

warn_or_fail() {
  local msg="$1"
  if [[ "$STRICT" -eq 1 ]]; then
    log_err "$msg"
    exit 1
  fi
  log_warn "$msg"
}

verify_release_artifacts() {
  log_info "Checking release artifacts in $RELEASE_DIR"

  if [[ ! -d "$RELEASE_DIR" ]]; then
    log_err "Missing release artifacts directory: $RELEASE_DIR"
    exit 1
  fi

  require_file "$RELEASE_DIR/robopoker_entropy.so"
  require_file "$RELEASE_DIR/robopoker_poker.so"
  require_file "$RELEASE_DIR/checksums.sha256"
  require_file "$RELEASE_DIR/build-metadata.json"
  require_file "$RELEASE_DIR/poker.json"

  log_ok "Required release files present"

  local hasher
  hasher=$(hash_cmd)

  local entropy_hash
  entropy_hash=$($hasher "$RELEASE_DIR/robopoker_entropy.so" | awk '{print $1}')
  local poker_hash
  poker_hash=$($hasher "$RELEASE_DIR/robopoker_poker.so" | awk '{print $1}')
  local idl_hash
  idl_hash=$($hasher "$RELEASE_DIR/poker.json" | awk '{print $1}')

  local checksum_file="$RELEASE_DIR/checksums.sha256"

  grep -q "$entropy_hash  robopoker_entropy.so" "$checksum_file" || {
    log_err "Checksum mismatch for robopoker_entropy.so"
    exit 1
  }
  grep -q "$poker_hash  robopoker_poker.so" "$checksum_file" || {
    log_err "Checksum mismatch for robopoker_poker.so"
    exit 1
  }
  grep -q "$idl_hash  poker.json" "$checksum_file" || {
    log_err "Checksum mismatch for poker.json"
    exit 1
  }

  log_ok "Checksums match for release artifacts"

  python - <<'PY'
import json
from pathlib import Path

release_dir = Path("target/release-artifacts")
meta = json.loads((release_dir / "build-metadata.json").read_text())

required_top = ["version", "commit", "environment", "toolchain", "programs", "client_sdk"]
for key in required_top:
    if key not in meta or meta[key] in ("", None):
        raise SystemExit(f"Missing build metadata field: {key}")

toolchain = meta.get("toolchain", {})
for key in ["solana", "rust", "cargo_build_sbf"]:
    if key not in toolchain or not toolchain[key]:
        raise SystemExit(f"Missing toolchain field: {key}")

programs = meta.get("programs", {})
for name in ["entropy", "poker"]:
    prog = programs.get(name, {})
    for key in ["id", "binary", "checksum"]:
        if key not in prog or not prog[key]:
            raise SystemExit(f"Missing program metadata: {name}.{key}")
    if prog["binary"] not in ("robopoker_entropy.so", "robopoker_poker.so"):
        raise SystemExit(f"Unexpected binary name for {name}: {prog['binary']}")

client = meta.get("client_sdk", {})
for key in ["name", "version"]:
    if key not in client or not client[key]:
        raise SystemExit(f"Missing client SDK metadata: {key}")

version = meta.get("version", "")
if version in ("unknown", ""):
    raise SystemExit("Missing version tag in build metadata")

print("Build metadata validated")
PY

  log_ok "Build metadata validated"
}

verify_verification_artifacts() {
  if [[ "$SKIP_VERIFICATION" -eq 1 ]]; then
    log_warn "Skipping verification artifact checks"
    return 0
  fi

  if [[ ! -d "$VERIFICATION_DIR" ]]; then
    warn_or_fail "Missing verification artifacts directory: $VERIFICATION_DIR"
    return 0
  fi

  local latest
  latest=$(ls -1 "$VERIFICATION_DIR"/verification-*.json 2>/dev/null | sort | tail -n 1 || true)
  if [[ -z "$latest" ]]; then
    warn_or_fail "No verification artifacts found in $VERIFICATION_DIR"
    return 0
  fi

  python - <<PY
import json
from pathlib import Path

path = Path("$latest")
data = json.loads(path.read_text())

required = ["timestamp", "environment", "rpc_url", "commit", "verification_success", "programs"]
for key in required:
    if key not in data:
        raise SystemExit(f"Missing verification field: {key}")

programs = data.get("programs", [])
if not programs:
    raise SystemExit("Verification artifact has no program entries")

for prog in programs:
    for key in ["program", "id", "status"]:
        if key not in prog:
            raise SystemExit(f"Missing program verification field: {key}")
    status = prog.get("status")
    if status == "verified":
        if "hash" not in prog:
            raise SystemExit("Verified entry missing hash")
    elif status == "mismatch":
        if "local_hash" not in prog or "deployed_hash" not in prog:
            raise SystemExit("Mismatch entry missing hashes")

print("Verification artifact validated")
PY

  if [[ "$REQUIRE_SUCCESS" -eq 1 ]]; then
    local success
    success=$(python - <<PY
import json
from pathlib import Path
data = json.loads(Path("$latest").read_text())
print("true" if data.get("verification_success") else "false")
PY
)
    if [[ "$success" != "true" ]]; then
      log_err "verification_success is false (use --require-success only when verified)"
      exit 1
    fi
  fi

  log_ok "Verification artifacts validated: $latest"
}

verify_release_artifacts
verify_verification_artifacts

log_ok "Release artifacts verification complete"
