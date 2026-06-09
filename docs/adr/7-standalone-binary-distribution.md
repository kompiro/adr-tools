---
id: ADR-7
title: Distribute the adr CLI as a Node-free standalone binary
status: accepted
date: 2026-06-09
topic: infrastructure
---

# ADR-7: Distribute the adr CLI as a Node-free standalone binary

- **Date**: 2026-06-09
- **Status**: Accepted
- **Related**:
  - PR #6 (design doc), PR #7 (implementation), released as v0.0.4
  - `scripts/build-binaries.sh`, `.github/workflows/release.yml`, `install.sh`

## Background

`@kompiro/adr-tools` was distributed only as a GitHub Packages npm package, and
the `adr` bin used a `#!/usr/bin/env node` shebang — so it could not run where
no Node toolchain exists (other projects, Go/other-language devcontainers). We
wanted `adr` usable without installing Node or `node_modules`.

The CLI is small and dependency-light: file I/O (`node:fs`/`path`/`url`) plus
`js-yaml`, no native addons or network. That makes a self-contained binary
cheap to produce.

## Decision

Compile the `adr` CLI to self-contained executables with `bun build --compile`
for five targets (linux/macOS/windows × x64/arm64), publish them to GitHub
Releases with a `SHA256SUMS`, and install them via `install.sh` into
`~/.local/bin`. This is **additive**: the existing npm distribution is kept
unchanged.

## Rationale

- Bun natively supports the `node:` APIs this CLI uses and bundles `js-yaml`
  automatically; one command cross-compiles all targets. Verified end-to-end —
  the compiled binary runs `adr validate`/`init` with no Node present.
- The init starter is embedded (`src/init.template.ts`) so the binary needs no
  companion file on disk; `dist/bin` is excluded from the npm tarball so the
  ~90MB artifacts never bloat the package.
- GitHub Releases distribution costs nothing; per-platform binaries plus
  checksums give a simple, verifiable install path. `install.sh` prefers the
  `gh` CLI (handles the currently-private repo's auth) with a
  `curl`+`GITHUB_TOKEN`+`jq` fallback.

## Rejected alternatives

- **Deno compile** — comparable, but no advantage over Bun for this CLI and an
  extra permissions model to wire up.
- **Node SEA** — multi-step (ESM→CJS→blob→postject→codesign), needs a per-OS
  node binary, and cross-compilation is awkward; still experimental.
- **Rewrite in Go/Rust** — yields tiny static binaries but a full rewrite of an
  actively-maintained TypeScript codebase, not worth the cost.

## Known trade-offs

- Binaries are ~90MB (the Bun runtime floor); `--minify`/`--bytecode` do not
  help since the app code is tiny.
- The generated config's `$schema` points at the npm package path, so editor
  autocompletion only resolves when the package is also installed via npm.
  Revisit with a hosted schema URL once the repo is public.
