---
id: ADR-32
title: report assumptions that pin a caret range to a full version (warn by default, opt-in error)
status: accepted
date: 2026-08-26
topic: architecture
scope:
  concerns: [ci, dependencies]
related_to: [ADR-23]
---

# ADR-32: report assumptions that pin a caret range to a full version (warn by default, opt-in error)

- **Date**: 2026-08-26
- **Status**: Accepted
- **Related**:
  - Issue #32
  - Follows [ADR-23](23-repo-backed-permalink-sha-recommendation.md)'s severity stance (start at a non-fatal warn; keep an opt-in hard-fail open)
  - Downstream driver: [kompiro/karasu](https://github.com/kompiro/karasu) #2628 / karasu ADR-2628, which implemented the same rule locally as a policy test
  - Code: `src/validator.ts`, `src/config.ts`, `src/config.schema.json`

## Background

`assumptions:` earns its place by failing CI when the world an ADR relies on
moves ([ADR-788](https://github.com/kompiro/karasu/blob/main/docs/adr/788-adr-knowledge-graph.md)
downstream). That only holds when what is asserted is the **decision**.

Downstream in karasu, an assumption twice wrote the literal dependency version
instead, and both times a routine Dependabot bump failed a decision nobody had
revisited:

- karasu ADR-1338 asserted `fast-uri: \^3\.1\.2`; ADR-2115 loosened it.
- karasu ADR-2447 asserted `"oxfmt": "\^0.62.0"`; a bump to 0.63.0 failed
  `check-assumptions` with `798 OK, 1 failing`, and ADR-2623 loosened it.

The repair costs more than the failure looks like it should. Dependabot does not
edit `docs/adr/`, so the bot PR cannot go green in the shape it was raised:
someone has to recognise the red as the repo's own rather than upstream's, then
raise a second PR carrying the same bump. Twice that cost a PR that changed no
decision.

The failure is not karasu-specific. Any project that points an assumption at a
dependency range meets it on the second bump.

## Decision

`validate` reports an `assumptions:` entry where a **caret or tilde range is
asserted down to a full `major.minor.patch`**.

1. **The rule keys on the range operator, not the version shape.** The caret is
   already a statement that the tail may move, so asserting the tail contradicts
   the range on the same line. Stopping at the major (`\^0\.`) asserts what was
   decided — this dependency is caret-pinned to that major — and survives every
   bump the caret permits.

2. **Exact pins are exempt.** `"pkg": "1.2.3"` with no caret is a decision
   *about* 1.2.3, so the version is the content of the assumption and belongs
   there.

3. **Severity is configurable, defaulting to `warn`.** New optional
   `assumptions.rangePin: "off" | "warn" | "error"`. `warn` prints without
   affecting the exit code, so upgrading to a version carrying this check
   changes no existing build; `error` fails `validate` for projects that want
   the gate.

Matching is done with backslashes stripped, because `grep:` assumptions carry
regexes and the escaping is inconsistent in practice: `\^0.62.0`, `\^1\.125\.0`
and `^4.3.3` are the same assertion wearing different amounts of escaping.

## Rationale

- **Warn by default keeps the upgrade non-breaking.** [ADR-23](23-repo-backed-permalink-sha-recommendation.md)
  already settled this direction for a check of this kind: raising severity
  later is backward compatible, starting at fail and loosening is not. Measured
  across the known adopters at the time of writing, an `error` default would
  have broken none of them — karasu's corpus of 806 assumption entries had no
  surviving violation, and hane and this repo declare none — but the package is
  public and its other adopters are not observable from here.

- **The knob exists now rather than later because the gate has a user.** ADR-23
  deferred its opt-in hard-fail on the grounds that nothing yet used the
  convention it guarded. Here the opposite holds: the problem has fired twice in
  a real corpus, and karasu has already built a local gate for exactly this rule
  that it can retire once `"error"` is available.

- **Keying on the caret avoids an exclusion list.** Rejecting any
  `major.minor.patch` would also reject `BlueOak-1.0.0` — an SPDX licence
  identifier that merely looks like a version and is never bumped. Over karasu's
  corpus the caret rule scored 8 true positives and 0 false positives, where the
  version-shape rule took 2 innocents with it. An exclusion list would have
  covered those two and then broken on the next identifier of that shape.

- **It belongs in `validate`, not `check-assumptions`.** The rule is about the
  shape of the assertion, which is knowable from the frontmatter alone.
  `check-assumptions` evaluates assumptions against the working tree and needs a
  checkout to say anything.

## Alternatives considered

- **Reject any `major.minor.patch`.** Simpler to describe, but 2 false positives
  on the only corpus large enough to measure, both of them SPDX identifiers.

- **`error` by default.** Correct for the known adopters and tempting because
  the rule's whole value is gating. Rejected: the package is public, unknown
  adopters cannot be measured, and a warn-now/error-later path costs them
  nothing while reaching the same end state.

- **Leave it downstream.** karasu's local policy test already works. Rejected
  because the rule is not karasu-specific — any project asserting a dependency
  range meets it on the second bump — and every project that repeats it pays the
  same two-incidents-then-fix tuition.
