# @kompiro/adr-tools

Frontmatter-driven ADR (Architecture Decision Record) tooling. Validates ADR
metadata, enforces relationship consistency (`supersedes`, `depends_on`,
`refines`, ...), extracts effective sets, regenerates index files, renders
Mermaid views, and verifies code-level assumptions.

Originally extracted from [kompiro/karasu](https://github.com/kompiro/karasu).

> Status: pre-1.0, API may change. Currently `private: true` in
> `package.json` until the publish workflow lands.

## Install

Published to **GitHub Packages** (private). Configure your project's
`.npmrc` to route the `@kompiro` scope and authenticate:

```ini
# .npmrc
@kompiro:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then add the dependency:

```sh
pnpm add -D @kompiro/adr-tools
# or
npm install --save-dev @kompiro/adr-tools
```

`GITHUB_TOKEN` must be a Personal Access Token with **`read:packages`**
permission scoped to `kompiro/adr-tools`. In CI, use a repository secret
and set the env var on the install step.

### Standalone binary (no Node required)

For environments without a Node toolchain (other projects, Go/other-language
devcontainers, etc.), install the self-contained executable published to
[GitHub Releases](https://github.com/kompiro/adr-tools/releases):

```sh
curl -fsSL https://raw.githubusercontent.com/kompiro/adr-tools/main/install.sh | sh
```

The script detects your OS/arch, downloads the matching binary, verifies its
SHA256, and installs it to `~/.local/bin/adr`. Override with `ADR_VERSION`
(release tag) or `INSTALL_DIR`.

While this repository is private, downloading requires authentication: install
the [GitHub CLI](https://cli.github.com/) and run `gh auth login` (preferred),
or set `GITHUB_TOKEN` (the curl fallback also needs `jq`). In a devcontainer,
add the one-liner above as a `RUN` step in your `Dockerfile`.

> The binary embeds everything it needs, so `adr init` works with no companion
> files. The generated config's `$schema` points at the npm package path, so
> JSON Schema autocompletion in editors only resolves when the package is also
> installed via npm.

## Quick start

After installing, the `adr` binary is on your project's `PATH`:

```sh
# Generate a starter config in CWD
npx adr init

# Edit adr.config.json to define your topics and concerns

# Validate ADRs under docs/adr/
npx adr validate

# Regenerate effective.md, graph.md, graph/<topic>.md
npx adr regenerate
```

## CLI

```
adr <subcommand> [options]

Subcommands:
  init                  generate a starter adr.config.json in CWD
  validate              schema and cross-reference validation of ADRs
  regenerate            rewrite effective.md, graph.md, and graph/<topic>.md
  extract               query the ADR set (effective | slice | closure)
  visualize             render Markdown / Mermaid views of the ADR set
  check-assumptions     verify file: / symbol: / grep: assumptions in ADRs
```

## Configuration (`adr.config.json`)

```json
{
  "$schema": "./node_modules/@kompiro/adr-tools/dist/config.schema.json",
  "idFormat": "date-sequence",
  "topics": ["architecture", "infrastructure", "process"],
  "concerns": ["security", "performance", "ci"],
  "paths": {
    "adrDir": "docs/adr",
    "outputs": {
      "effective": "effective.md",
      "graph": "graph.md",
      "graphByTopic": "graph/"
    }
  }
}
```

- `idFormat` selects the ADR id / filename convention (see below). Defaults
  to `"date-sequence"` when omitted.
- `topics` and `concerns` define the controlled vocabulary checked against
  ADR frontmatter. Use `[]` to disable vocabulary enforcement (fields stay
  required, but any string is accepted).
- `paths.outputs` paths are relative to `paths.adrDir`.

### `idFormat`

| Value | Filename | Frontmatter `id` | Use when |
|---|---|---|---|
| `date-sequence` (default) | `YYYYMMDD-NN-<slug>.md` | `ADR-YYYYMMDD-NN` | You want monotonic date-ordered ids and don't care about Issue/PR linkage |
| `issue-number` | `<n>-<slug>.md` (no zero padding) | `ADR-<n>` | You want the filename to encode the GitHub Issue (or PR) number so Issue ↔ ADR linkage is visible at a glance |

Numbering policy under `issue-number` is up to the host project — a common
order is **Issue number → PR number → local sequence (max existing + 1)**.

The validator and body cross-reference scan adapt automatically. Mixing
formats in one corpus is not supported; pick one per project.

## ADR file format

ADRs are Markdown files with YAML frontmatter:

```markdown
---
id: ADR-20260101-01
title: Adopt frontmatter-driven ADRs
status: accepted
date: 2026-01-01
topic: process
depends_on: []
related_to: []
supersedes: []
---

# ADR-20260101-01: Adopt frontmatter-driven ADRs

## Background
...
```

### Reference templates

This repo ships starter templates you can copy into your project:

- [`docs/adr/TEMPLATE.md`](./docs/adr/TEMPLATE.md) — frontmatter + body
  skeleton for a new ADR
- [`docs/adr/README.md`](./docs/adr/README.md) — index, numbering rules,
  status transitions, and operating notes

For a fully populated example corpus, see
[karasu's `docs/adr/`](https://github.com/kompiro/karasu/tree/main/docs/adr).

## Library API

```ts
import { loadConfig, validateDirectory, buildGeneratedFiles } from "@kompiro/adr-tools";

const config = loadConfig();
const { errors, warnings, parsed } = validateDirectory(config.paths.adrDir, config);
const files = buildGeneratedFiles(parsed, config);
```

## Development

```sh
pnpm install
pnpm test
pnpm run build       # tsup -> dist/ (npm package)
pnpm run build:bin   # bun --compile -> dist/bin/ (standalone binaries; needs bun)
```

## License

MIT — see [LICENSE](./LICENSE).
