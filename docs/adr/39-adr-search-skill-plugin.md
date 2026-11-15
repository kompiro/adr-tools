---
id: ADR-39
title: ship the adr-search skill from this repo as a Claude Code plugin
status: accepted
date: 2026-11-15
topic: architecture
depends_on: [ADR-38]
---

# ADR-39: ship the adr-search skill from this repo as a Claude Code plugin

- **Date**: 2026-11-15
- **Status**: Accepted
- **Related**:
  - Issue #39
  - Builds on [ADR-38](38-search-and-refs.md) (`adr search` / `adr refs`)
  - Follows [kompiro/tpl-tools ADR-39](https://github.com/kompiro/tpl-tools/blob/main/docs/adr/39-test-perspective-skill-plugin.md),
    which made tpl-tools a plugin for the same reasons
  - Code: `.claude-plugin/plugin.json`, `skills/adr-search/SKILL.md`,
    `test/skill-drift.test.ts`, `CONTRIBUTING.md`
  - Host side: the `kompiro-hane` marketplace entry (kompiro/hane)

## Background

ADR-38 gave an agent the raw answers: `adr search` finds ADRs with their status
and successor, `adr refs` lists what points at an ADR. An agent still has to be
told **when** to use them and **what a finished lookup looks like**. Without
that it reads `effective.md` / `graph.md` in full, or reports a superseded ADR as
current.

In karasu's measurement (Issue #38), a skill that said this fired in 10 of 10
runs, every run used both commands, and only 1 run in 50 still read the
generated indexes. That skill lived in karasu, in Japanese, and hard-coded the
`## 決定` heading.

## Decision

Make this repo a Claude Code plugin named `adr-tools`, with one skill,
`skills/adr-search/`, invoked as `/adr-tools:adr-search`. The `kompiro-hane`
marketplace distributes it; this repo has no marketplace of its own.

The skill is in English and states:

1. **The end state.** Every ADR reported is one of *in force*, *in force, partly
   revised*, *superseded*, *no longer in force* (`deprecated` / `not_adopted`) or
   *proposed*. A superseded ADR is never cited as the current rule, every
   `← NEWER` reference is checked before an ADR is called in force, and an empty
   result lists the terms tried.
2. **Do not read the generated outputs** named by `paths.outputs`.
3. **The steps:** build terms in the documents' language and the code's, run
   `adr search`, run `adr refs` on the candidates and read the decision of every
   `← NEWER` reference, then report a table and two lists (decisions to keep,
   decisions that need a discussion before overriding).
4. **The decision section is found without depending on its heading.** The
   reference template calls it `## Decision`; the skill says so, points at the
   host's `TEMPLATE.md`, and asks for the section that states the decision. No
   config key is added for it.
5. **It does not assume a CLI version.** It names v0.0.14 as the release that
   brought `search` / `refs`, and gives a `grep`-on-frontmatter fallback for an
   older or missing CLI, which still does not read the generated outputs.

`test/skill-drift.test.ts` fails when the skill names a subcommand the CLI does
not dispatch, a flag (`--format=`, `-n`, ...) that `search` / `refs` do not
define, or a `paths.*` key the config schema lacks, or when it leaves out a
status or leaves a relationship field out of its fallback. It also holds `.claude-plugin/plugin.json`'s version equal to
`package.json`'s.

## Rationale

- **The commands and their instructions change together.** A rename of a flag,
  or a new relationship field such as `amends` (#37), updates the skill in the
  same PR, and the drift test catches a PR that forgets.
- **The npm package does not change.** `files` in `package.json` lists `dist`,
  `LICENSE` and `README.md` only, so CLI users receive nothing new.
- **No heading key.** A key would have to be set in every host whose template is
  not in English, and would still miss a host that renamed the section. Asking
  for "the section that states the decision" works for any heading an agent can
  read.

## Alternatives considered

- **Keep the skill in each host's `.claude/skills/`.** It gets copied, drifts, and
  is tied to whichever CLI version that host has.
- **Have `adr init` write the skill into the host.** Simpler to install, but an
  update needs a re-run and a manual merge, and the file reaches users who do not
  use Claude Code.
- **A `decisionHeading` config key.** Rejected above.

## Consequences

- Hosts install one more plugin, through `kompiro-hane`. Until that marketplace
  entry exists, the README's install commands do not work.
- A release also bumps `.claude-plugin/plugin.json`. The drift test fails if it is
  forgotten.
- "Partly revised" is judged by reading newer ADRs. Once #37 adds `amends` /
  `amended_by`, the skill can read it from frontmatter instead.
