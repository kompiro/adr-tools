---
id: ADR-17
title: permalink support with a built-in krs anchor-resolution kind
status: accepted
date: 2026-07-13
topic: architecture
---

# ADR-17: permalink support with a built-in krs anchor-resolution kind

- **Date**: 2026-07-13
- **Status**: Accepted
- **Related**:
  - Issue #17
  - Downstream driver: [kompiro/karasu](https://github.com/kompiro/karasu) #1830 (adoption side) / karasu ADR-20260702-01 (the `permalink:` convention)
  - Code: `src/permalink.ts`, `src/cli/check-permalinks.ts`, `src/config.ts`

## Background

ADRs increasingly want to link to a *rendered architecture structure* — a
diagram of the system the decision is about. karasu defined a convention (its
ADR-20260702-01): a `permalink:` frontmatter block with a required `source`
(the in-repo file of record), an optional `short` click-through URL, and an
optional `view`; a `source` may carry a `#fragment` deep anchor addressing a
specific element.

That convention needs machine validation — otherwise a renamed/removed element
silently dangles the link. The check belongs here rather than in karasu's own
scripts: the real consumers are **downstream repos** that model in karasu and
reference it from their ADRs, and they drive `@kompiro/adr-tools`, not karasu's
repo internals. A karasu-side script would only guard karasu's own ADRs.

The blocker was that resolving a `#fragment` deep anchor requires parsing the
domain-specific `.krs`, which a general-purpose ADR tool must not hard-depend
on. But `@karasu-tools/core` is published to the public npm registry, so it can
be loaded *optionally*.

## Decision

Add first-class `permalink:` support in two layers:

- **Generic core** — a `permalink:` frontmatter schema in `validate` (array of
  `{ short?, source, view? }`, `source` required), and a `check-permalinks`
  command that verifies each `source` exists and each `short` is a well-formed,
  non-`#s=`-fragment URL (offline shape check; the link is never fetched).
- **A built-in `krs` resolution kind**, opted into with
  `"permalink": { "kind": "krs" }`. It resolves a karasu `#krs-<view>-<id>`
  anchor by **lazily importing the optional peer dependency
  `@karasu-tools/core`**, rendering the `.krs`, and checking the anchor is in
  the emitted set (bare whole-view anchors are accepted without a membership
  check). An unresolved anchor fails the command (fail-closed); a missing
  `@karasu-tools/core` yields a clear error only when the kind is exercised.

Anchor resolution is delegated through a `PermalinkResolver` interface, so the
generic layer stays language-agnostic and future kinds slot in beside `krs`.

## Rationale

- **Reusable where it is actually used** — every adr-tools adopter gets the
  check, not just karasu.
- **No hard coupling** — `@karasu-tools/core` is an *optional* peer dependency,
  loaded via a dynamic import only when the `krs` kind runs; adr-tools installs
  and runs without it for everyone else.
- **Render output is the source of truth** — the accepted anchor set is exactly
  what the renderer emits, so validation can't drift from what a reader lands on.
- **Fail-closed in CI** — unlike a viewer that degrades a bad anchor to the
  whole model, the checker reports it, so a dangling link breaks the build.

## Rejected alternatives

- **Keep the validator in karasu's own scripts** — guards the wrong repo
  (karasu itself rarely writes a `.krs` permalink) and isn't reusable.
- **Hard-depend on `@karasu-tools/core`** — forces a modeling-language
  dependency on every adr-tools user; rejected in favor of an optional peer.
- **A generic external-resolver plugin API / shell-out contract** — more
  flexible but heavier than warranted for the one kind that exists today; the
  `PermalinkResolver` seam keeps the door open without the upfront cost.
