# @kompiro/adr-tools

Frontmatter-driven ADR (Architecture Decision Record) tooling. Validates ADR
metadata, enforces relationship consistency (`supersedes`, `depends_on`,
`refines`, ...), extracts effective sets, regenerates index files, renders
Mermaid views, and verifies code-level assumptions.

Originally extracted from [kompiro/karasu](https://github.com/kompiro/karasu).

> Status: pre-1.0, API may change. Currently `private: true` in
> `package.json` until the publish workflow lands.

## Install

```sh
pnpm add -D @kompiro/adr-tools
```

## Quick start

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

- `topics` and `concerns` define the controlled vocabulary checked against
  ADR frontmatter. Use `[]` to disable vocabulary enforcement (fields stay
  required, but any string is accepted).
- `paths.outputs` paths are relative to `paths.adrDir`.

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

See [karasu's `docs/adr/`](https://github.com/kompiro/karasu/tree/main/docs/adr)
for a worked example.

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
pnpm run build
```

## License

MIT — see [LICENSE](./LICENSE).
