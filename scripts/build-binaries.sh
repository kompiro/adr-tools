#!/usr/bin/env bash
# Compile the `adr` CLI into self-contained, Node-free executables for every
# supported platform using `bun build --compile`, then emit SHA256SUMS.
#
# Output: dist/bin/<asset> and dist/bin/SHA256SUMS
# Requires: bun (https://bun.sh) and an installed node_modules (js-yaml).
set -euo pipefail

cd "$(dirname "$0")/.."

ENTRY="src/cli/index.ts"
OUT="dist/bin"

# bun --target  =>  released asset name
targets=(
  "bun-linux-x64:adr-linux-x64"
  "bun-linux-arm64:adr-linux-arm64"
  "bun-darwin-x64:adr-darwin-x64"
  "bun-darwin-arm64:adr-darwin-arm64"
  "bun-windows-x64:adr-windows-x64.exe"
)

rm -rf "$OUT"
mkdir -p "$OUT"

for entry in "${targets[@]}"; do
  target="${entry%%:*}"
  name="${entry##*:}"
  echo "==> building $name ($target)"
  bun build "$ENTRY" --compile --target="$target" --outfile "$OUT/$name"
done

echo "==> generating SHA256SUMS"
(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum adr-* >SHA256SUMS
  else
    shasum -a 256 adr-* >SHA256SUMS
  fi
)

echo "==> done"
ls -lh "$OUT"
