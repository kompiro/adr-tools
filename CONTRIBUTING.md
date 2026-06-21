# Contributing to @kompiro/adr-tools

Thanks for your interest in contributing! This document describes the
workflow for changes, the local checks, and how releases are cut.

## Getting started

```sh
pnpm install
pnpm test
pnpm run build
```

Requires Node.js >= 20 and [pnpm](https://pnpm.io/).

## Local checks

Run the same checks CI runs before opening a PR:

```sh
pnpm run typecheck
pnpm run lint
pnpm run format:check   # `pnpm run format` to auto-fix
pnpm test
pnpm run build
```

## Pull requests

- Branch off `main`. Branch names follow `feat/`, `fix/`, `docs/`, `chore/`,
  or `refactor/` + a short kebab-case description.
- Commit messages and PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/) (e.g.
  `feat(validate): enforce supersedes consistency`).
- Keep PRs focused — one logical change per PR.
- Open an issue first for larger changes so the approach can be discussed.

All PRs run CI (typecheck, lint, format, tests, build, and a CLI smoke
test). CI must be green before merge.

## Releasing (maintainers)

Releases publish to the public npm registry, triggered by a `v*` tag.

1. Bump `version` in `package.json` per [SemVer](https://semver.org/).
   While the package is pre-1.0, breaking changes bump the minor.
2. Commit (`chore: release vX.Y.Z`) and merge to `main`.
3. Tag the merge commit and push the tag:
   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. The [`Publish`](.github/workflows/publish.yml) workflow runs the full
   check suite and `pnpm publish --access public --provenance`. It requires
   the `NPM_TOKEN` repository secret (an npm automation token with publish
   rights to the `@kompiro` scope).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
