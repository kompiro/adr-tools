---
id: ADR-23
title: recommend @<sha> pinning for repo-backed permalinks (non-fatal warn)
status: accepted
date: 2026-07-15
topic: architecture
related_to: [ADR-17]
---

# ADR-23: recommend @<sha> pinning for repo-backed permalinks (non-fatal warn)

- **Date**: 2026-07-15
- **Status**: Accepted
- **Related**:
  - Issue #23
  - Builds on [ADR-17](17-permalink-krs-kind.md) (the `permalink:` support and the `krs` kind)
  - Downstream driver: [kompiro/karasu](https://github.com/kompiro/karasu) #1959 (slice d of #1828), design `docs/design/repo-backed-permalink-sha-enforcement.md`; karasu ADR-20260713-02 placed this validation here in the `krs` kind
  - Code: `src/permalink.ts`, `src/cli/check-permalinks.ts`, `src/config.ts`, `src/config.schema.json`

## Background

Downstream, karasu is introducing **repo-backed permalinks**: URLs served by
karasu-nest that resolve a repo's `.krs` at a git ref, of the form
`…/<owner>/<repo>[/<path>][@<ref>]#krs-<view>-<id>`. An ADR that embeds such a
link as its `permalink[].short` click-through wants it to point at the structure
**as of the decision** — i.e. pinned to an immutable commit SHA. But the nest
resolver is deliberately permissive: `@<ref>` is optional (omitted → the mutable
default branch) and branch/tag/SHA all render.

So "an ADR-embedded repo-backed permalink should be SHA-pinned" is an authoring
recommendation, and the natural place to surface it is `adr check-permalinks`.
Today `validateShort` only checks that `short` is a parseable http(s) URL that
is not a `#s=` fragment share — it has no concept of a repo-backed URL, so a
mutable `@main` or ref-less link passes silently.

## Decision

Add a **non-fatal recommendation** that a repo-backed `short` be pinned to a
full commit SHA. Three pieces:

1. **Config — a host allowlist.** New optional `permalink.repoBackedHosts:
   string[]`. A `short` whose URL host matches an entry is treated as a
   repo-backed permalink. Keying on **host, not URL path shape** keeps the check
   independent of the resolver's route form (karasu is still deciding between a
   bare `/<owner>/<repo>@<sha>` route and a `/r/`-prefixed one — karasu #1961).
   Absent/empty ⇒ the check is inert (no behavior change for existing adopters).

2. **Check — recommend `@<sha>`.** For a repo-backed `short`, inspect the
   pathname for a trailing `@<ref>` (the `#krs-…` deep anchor lives in the hash
   and is ignored here). If the ref is **not** a full 40-hex SHA
   (`/^[0-9a-f]{40}$/`) — ref-less, `@HEAD`, `@branch`, `@tag`, or an
   abbreviated SHA — emit a warning recommending `@<40-hex-sha>`. Offline only:
   the ref is never resolved over the network.

3. **Severity — a new non-fatal `warn` status.** `PermalinkResult.status` gains
   `"warn"`, surfaced in `check-permalinks` output with its own counter and
   symbol, mirroring the existing `manual` status in `check-assumptions`. `warn`
   is **excluded from the exit code** — it never fails CI.

## Rationale

- **Recommend, don't enforce.** Hard-failing a non-SHA link would re-impose the
  strictness the nest resolver deliberately dropped; both "decision-time" and
  "living" ADR links are legitimate. A warning nudges without blocking.
- **Not premature as a gate.** No ADR embeds a repo-backed permalink yet; a hard
  CI gate on an unused convention would be over-reach. A future **opt-in**
  hard-fail via config stays open — raising severity later is backward
  compatible, whereas starting at fail and loosening would be breaking.
- **Host-keyed detection is route-form-agnostic.** It survives karasu's pending
  bare-vs-`/r/` decision and generalizes to any downstream nest host.
- **Validation belongs here** (per karasu ADR-20260713-02): the real consumers
  are downstream repos that model in karasu and reference it from their ADRs;
  they run `@kompiro/adr-tools`, not karasu's repo scripts.

## Rejected alternatives

- **Hard-fail non-SHA repo-backed links.** Conflicts with the permissive
  resolver and gates an unused convention. Deferred to a possible future opt-in.
- **Detect by URL path shape** (`[/r]/<owner>/<repo>[/<path>][@<ref>]`). Couples
  the check to a route form karasu has not finalized, and risks misclassifying
  arbitrary two-segment paths. Host allowlist is precise and stable.
- **A new dedicated frontmatter field** for repo-backed links. A repo-backed URL
  plays the same click-through role as any other `short`; a new field would grow
  the schema surface for no gain. It rides `short`; `source` stays the record.
