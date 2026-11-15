---
id: ADR-38
title: add `search` and `refs` so an ADR lookup answers "is it still in force?" in one short call
status: accepted
date: 2026-11-15
topic: architecture
---

# ADR-38: add `search` and `refs` so an ADR lookup answers "is it still in force?" in one short call

- **Date**: 2026-11-15
- **Status**: Accepted
- **Related**:
  - Issue #38 (measurements in the Issue and its comment)
  - Follow-ups: #37 (`amends` / `amended_by`), #36 (`refines` in the graph), #39 (a skill that uses these commands)
  - Code: `src/finder.ts`, `src/cli/search.ts`, `src/cli/refs.ts`

## Background

Before designing something, an agent or a person asks: *which past decisions
apply here, and which of them are still in force?* The CLI could not answer
that:

- `extract slice` filters by `topic` / `scope.packages` / `scope.concerns`. There
  was no way to search by words.
- `--format=list` shows `id`, `status` and `title`, not the successor of a
  superseded ADR.
- `closure` follows `depends_on` forward only. Nothing listed the ADRs that point
  **at** a given ADR, which is where a later, partial revision shows up.

So agents read `effective.md` / `graph.md` in full. In karasu (about 500 ADRs)
each is about 70KB.

karasu measured two bash scripts doing what this ADR adds, packaged as a Claude
Code skill: 10 ADR-lookup tasks, 5 runs each, under three conditions (R: as is;
RS: with the scripts; RN: one `CLAUDE.md` sentence telling the agent to skip the
indexes, no scripts). Correctness was judged blind.

| | R | RS | RN |
| --- | --- | --- | --- |
| correct | 49/50 | 48/50 | 49/50 |
| total cost | $28.22 | $22.49 (-20%) | $24.38 (-14%) |
| runs that read `effective.md` / `graph.md` | 50/50 | 1/50 | 8/50 |

Correctness was at the ceiling in every condition. What the commands buy is
cost and time, and they make the cheap path stick: with the sentence alone, 8
runs in 50 still read the indexes.

## Decision

Add two subcommands. Both run on the validator's parse (`loadParsed`), so they
inherit `idFormat` and `paths.adrDir` from the config like every other command.

1. **`adr search <term>...`** ranks ADRs by case-insensitive substring matches
   against the title, filename and body. Order: distinct terms matched, then
   terms that hit the title or filename, then matching body lines; ties go to
   the newer ADR (date, then id). Terms that differ only in case count once.
   Output is one line per ADR:

   ```
    1  ADR-2376  superseded→ADR-2906  2026-09-04  <title>  [icon mode(15) 削除(10)]
    2  ADR-2906  accepted  2026-09-26  <title>  [icon mode(8) 削除*(20)]
   ```

   A superseded ADR shows its `superseded_by` chain to the end; `*` marks a hit
   in the title or filename; the count is matching body lines. Options: `-n`
   (default 20), `--format=json`, `--dir`. Exit status 1 when nothing matched,
   as with `grep`.

2. **`adr refs <id>...`** prints, per ADR, its status, date, title, file and own
   relationship fields; the `superseded_by` chain to its end; every ADR whose
   relationship fields point at it (`supersedes`, `superseded_by`, `depends_on`,
   `related_to`, `conflicts_with`, `refines`), labelled with the fields; and the
   ADRs that mention it only in the body. Referrers are listed newest first and
   marked `← NEWER` when later than the ADR. Options: `--format=json`, `--dir`.
   Exit status 1 when any id is unknown.

3. **Text is the default output, JSON an option.** The measured saving comes
   from a short, line-oriented answer that already says which ADR is current.

4. **The body line count skips the first H1.** The validator requires it to
   restate `<id>: <title>`, so counting it would add one line to every title
   hit, which the `*` already reports.

5. **"Newer" compares dates, then ids on the same date.** With `issue-number`
   ids several ADRs often share a date, and the id order is the only remaining
   signal of which came later.

## Rationale

- **Ship it in the package rather than in each host repo.** Every repo that keeps
  its own scripts re-implements a frontmatter parser. karasu's broke on empty
  tab-separated fields and on indented keys; the package already has a parser
  the validator keeps honest.

- **Reverse references cover every relationship field, not only `depends_on`.**
  A newer ADR that `refines` or is `related_to` an older one is exactly the
  partial revision a reader must not miss. When #37 adds `amends`, it joins the
  same list.

- **Body-only mentions are listed apart.** An ADR named in a body but in no
  relationship field is a weaker signal; keeping it in its own section lets the
  reader tell the two apart without the tool guessing.

## Alternatives considered

- **Point readers at `effective.md` / `graph.md`.** The expensive path measured
  above, and it cannot show partial revisions either.

- **Only a `CLAUDE.md` sentence telling agents to skip the indexes.** Recovered
  about two thirds of the saving with no code, but 8 runs in 50 still read the
  indexes; giving the agent something to use instead brought that to 1 in 50.

- **`refs --outside`: also list mentions outside `adrDir` (code, rules, docs)
  through `git grep`.** Not now. It ties the command to git and a working tree,
  which nothing else in `search` / `refs` needs, and the measurement did not
  isolate what it adds. A host repo can run `git grep` beside `refs` meanwhile.

- **JSON by default.** Easier for programs, longer for the reader the commands
  are for. Kept as `--format=json`.
