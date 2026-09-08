#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

cargo test --manifest-path sidecar/Cargo.toml
cargo build --manifest-path sidecar/Cargo.toml
WAYFINDER_RUST_SIDECAR_BIN=sidecar/target/debug/wayfinder-core-sidecar \
  npx tsx --test src/lib/__tests__/rust-sidecar.test.ts
