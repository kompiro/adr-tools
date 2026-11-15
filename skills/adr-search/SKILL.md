---
name: adr-search
description: >
  Find the past decisions (ADRs) that apply to a task and say which of them are still in force,
  using `adr search` and `adr refs` instead of reading the generated indexes. Use it when asked
  to find related ADRs or past decisions, and before designing or implementing something that
  earlier decisions may constrain. Trigger when the user says: "related ADRs", "past decisions",
  "is this decided already", "which ADR applies", "find the ADR", "関連 ADR", "過去の決定",
  "過去の判断", "ADR を探して", "決まっていることはある", or similar phrases.
---

# ADR search

Answer one question: **which past decisions apply here, and which of them are still in
force?** The repo's ADRs are Markdown files with YAML frontmatter, checked by the `adr`
CLI from [`@kompiro/adr-tools`](https://github.com/kompiro/adr-tools).

## Done when

The report classifies every ADR it mentions as exactly one of:

| Class | Means |
| --- | --- |
| **in force** | `status: accepted`, not superseded, and no newer ADR changes part of its decision |
| **in force, partly revised** | as above, but a newer ADR changes part of its decision. Name that ADR and the part |
| **superseded** | `status: superseded`. Name the ADR at the end of its `superseded_by` chain, and classify that ADR by its own status |
| **no longer in force** | `status: deprecated` or `not_adopted`. A `not_adopted` ADR is still worth citing: it records an option that was rejected and why |
| **proposed** | `status: proposed`. Not decided yet |

and these hold:

- A superseded ADR is never cited as the current rule. The ADR at the end of its chain is
  cited instead, but only if that ADR is itself **in force**. When the chain ends at an
  ADR that is deprecated, not adopted, proposed or missing (`search` prints
  `superseded→ADR-99(deprecated)` or `(not found)`), say that no ADR in the chain is in
  force.
- Before an ADR is called **in force**, every reference `adr refs` marks `← NEWER` has been
  checked.
- When nothing matched, the report says so and lists every term that was tried.

## Do not read the generated outputs

`adr.config.json` names generated files under `paths.outputs`, written by `adr regenerate`
into `paths.adrDir` (`adr init` names them `effective.md`, `graph.md` and `graph/`). Do not
open them. They are large, they cannot show a partial revision, and everything this skill
needs comes back from `adr search` and `adr refs` with the status already attached.

## Find the CLI

`search` and `refs` arrived in adr-tools v0.0.14. Try these in order and use the first
for which `<cli> search --help` succeeds:

1. A script the host repo defines for it (for example `pnpm adr`). The host decides the
   flags; do not build your own.
2. `pnpm exec adr`, or `npx --no-install adr`, when `@kompiro/adr-tools` is a dependency.
   Never a bare `npx adr`: when the dependency is not installed, npx downloads and runs
   an unrelated npm package named `adr`.
3. `adr` on `PATH` (the standalone binary).

A host may pin an older version as a dependency while a newer binary is on `PATH`; the
newer one is fine for these read-only lookups. If none has `search`, use the fallback at
the end of this file and suggest upgrading.

Both commands read `paths.adrDir` and `idFormat` from `adr.config.json`. Pass
`--dir=<path>` only when the ADRs live somewhere the config does not name.

## Steps

### 1. Build the search terms

Write down the terms before searching:

- the nouns of the task: the component, the feature, the file or the command it touches
- each term in the language the ADRs are written in **and** the language of the code.
  An ADR written in Japanese about `icon mode` may say `アイコンモード` in one place and
  `icon mode` in another
- synonyms and the older name of anything that was renamed

Three to six terms are usually enough. Terms that differ only in case count once.
Quote a term that has a space in it (`"icon mode"`); unquoted, the shell splits it into
`icon` and `mode`, and `mode` alone matches far too much.

### 2. Search

```sh
adr search <term> [<term> ...]      # e.g. adr search "icon mode" アイコンモード removal
```

One line per ADR, best match first:

```
 1  ADR-2376  superseded→ADR-2906  2026-09-04  <title>  [icon mode(15) removal(10)]
 2  ADR-2906  accepted  2026-09-26  <title>  [icon mode*(8) removal(4)]
```

- The third column is the status. A superseded ADR shows its `superseded_by` chain;
  the last step carries its status when it is not `accepted`
  (`superseded→ADR-99(not found)`).
- `*` marks a term found in the title or filename. The number counts matching body lines.
- Exit status `1` means nothing matched. It is an answer, not a failure: try the
  synonyms from step 1 before reporting that nothing matched.
- `-n <N>` shows more than the default 20. `--format=json` is there for programs; the
  text is shorter to read.

Pick the candidates from the titles. Skip an ADR whose only hits are a passing mention.

### 3. Check what points at each candidate

```sh
adr refs <id> [<id> ...]
```

For each ADR this prints its `superseded_by` chain, the ADRs whose relationship fields
point at it (`referenced by:`, labelled with the field), and the ADRs that mention it only
in the body (`mentioned only in body:`). Ids may be written `ADR-38`, `adr-38` or `38`.

- **Superseded:** run `adr refs` on the ADR at the end of the chain, and treat that one as
  the candidate, classified by its own status.
- **`← NEWER` entries:** open each one and read the section that states its decision. Do
  not depend on the heading text: the reference template calls it `## Decision`, but a
  host may use another heading or another language. Check the host's `TEMPLATE.md` in the
  ADR directory if one exists. Then decide:
  - It changes part of the candidate's decision → **in force, partly revised**, and name
    the part.
  - It replaces the candidate's decision without being recorded as `supersedes` → report
    it as superseding in substance, and point out that the frontmatter does not say so.
  - It builds on the candidate without changing it → it does not affect the class.
- Older referrers (no `← NEWER`) cannot revise the candidate. Read them only if they
  explain why the candidate exists.
- If the CLI notes on stderr that `adr validate` reports errors, an ADR whose frontmatter
  does not parse is missing from the results. Say so in the report.

### 4. Report

Start with a table:

| ADR | Status | Class | Why it applies | Newer ADRs checked |
| --- | --- | --- | --- | --- |
| ADR-2906 | accepted | in force | <one line> | ADR-2996 (no change) |
| ADR-2376 | superseded | superseded → ADR-2906 | <one line> | n/a |

Then two lists:

- **Decisions to keep:** the in-force decisions the task must follow, each in one line
  with its ADR.
- **Decisions that need a discussion before overriding:** where the task would go against
  an in-force decision, or would bring back an option an ADR rejected (`not_adopted`, or a
  rejected-alternatives section). Overriding one means a new ADR that records why, not a
  silent change.

If nothing matched, write that, and list the terms tried in step 1.

## Fallback: CLI older than v0.0.14, or no CLI

Still do not read the generated outputs. Instead:

In every `grep` below, leave out the generated outputs (`paths.outputs`) and the
non-ADR files in the directory (`README.md`, `TEMPLATE.md`): they mention many ids and
carry no ADR frontmatter.

1. `grep -ril` each term under `paths.adrDir` (`adr init` uses `docs/adr`).
2. For each hit, read only the frontmatter: `status`, `superseded_by`, and the
   relationship fields (`supersedes`, `depends_on`, `related_to`, `conflicts_with`,
   `refines`).
3. To find what points at a candidate, `grep -rlw '<id>'` under the ADR directory
   (`-w` keeps `ADR-38` from matching `ADR-380`). A hit is newer when its `date` is
   later, or when the dates are equal and its id sorts after the candidate's, as
   `adr refs` decides.

Then classify and report as above, and say that the lookup used the fallback.
