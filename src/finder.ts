/**
 * `adr search` / `adr refs`: answer "which past decisions apply here, and which
 * of them are still in force?" without reading the generated indexes.
 *
 * Both work on the validator's parse (`loadParsed`), so they inherit `idFormat`
 * and `paths.adrDir` from the config. The text output is the default on
 * purpose: one short line per ADR that already says whether it is current is
 * what lets a reader (often an agent) stop there. See ADR-38.
 */
import { basename } from "node:path";
import type { IdFormat } from "./config.ts";
import { compareAdrIds } from "./sort.ts";
import { adrIdRefRegex, RELATIONSHIP_FIELDS, type ParsedAdr } from "./validator.ts";

/** One step of a `superseded_by` chain. `status` is null when the id does not resolve. */
export interface ChainStep {
  id: string;
  status: string | null;
}

/**
 * Follow `superseded_by` from `adr` to its end. The start is not included, so
 * an ADR that is not superseded yields `[]`. Stops at an unresolvable id
 * (included, with `status: null`) and at a cycle.
 */
export function successorChain(adr: ParsedAdr, byId: Map<string, ParsedAdr>): ChainStep[] {
  const chain: ChainStep[] = [];
  const seen = new Set([adr.id]);
  let next = adr.fm.superseded_by ?? null;
  while (next && !seen.has(next)) {
    seen.add(next);
    const node = byId.get(next);
    chain.push({ id: next, status: node ? node.fm.status : null });
    next = node?.fm.superseded_by ?? null;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// search

export interface TermHit {
  term: string;
  /** Number of body lines containing the term. */
  lines: number;
  /** The term occurs in the title or the filename. */
  titleHit: boolean;
}

export interface SearchHit {
  adr: ParsedAdr;
  successors: ChainStep[];
  /** Only the terms that matched, in the order they were given. */
  terms: TermHit[];
}

/** Case-insensitive dedup that keeps the first spelling and the given order. */
export function normalizeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Rank ADRs by case-insensitive substring match of `terms` against the title,
 * filename and body. Order: number of distinct terms matched, then number of
 * terms hitting the title or filename, then matching body lines; ties go to the
 * newer ADR (date, then id). `limit` caps the result (default: no cap).
 */
export function searchAdrs(
  parsed: ParsedAdr[],
  terms: readonly string[],
  opts: { limit?: number } = {},
): SearchHit[] {
  const wanted = normalizeTerms(terms);
  if (wanted.length === 0) throw new Error("search requires at least one non-empty term");
  const byId = new Map(parsed.map((p) => [p.id, p]));

  const scored: Array<SearchHit & { titleHits: number; totalLines: number }> = [];
  for (const adr of parsed) {
    const title = adr.fm.title.toLowerCase();
    const file = filenameSlug(adr.file).toLowerCase();
    const bodyLines = bodyLinesWithoutHeading(adr);
    const hits: TermHit[] = [];
    for (const term of wanted) {
      const needle = term.toLowerCase();
      const titleHit = title.includes(needle) || file.includes(needle);
      let lines = 0;
      for (const line of bodyLines) if (line.includes(needle)) lines++;
      if (titleHit || lines > 0) hits.push({ term, lines, titleHit });
    }
    if (hits.length === 0) continue;
    scored.push({
      adr,
      successors: successorChain(adr, byId),
      terms: hits,
      titleHits: hits.filter((h) => h.titleHit).length,
      totalLines: hits.reduce((n, h) => n + h.lines, 0),
    });
  }

  scored.sort(
    (a, b) =>
      b.terms.length - a.terms.length ||
      b.titleHits - a.titleHits ||
      b.totalLines - a.totalLines ||
      compareNewerFirst(a.adr, b.adr),
  );
  const limited = opts.limit === undefined ? scored : scored.slice(0, opts.limit);
  return limited.map(({ adr, successors, terms: t }) => ({ adr, successors, terms: t }));
}

/**
 * The filename without its id prefix and `.md`, so a term like `md`, `-` or a
 * digit does not hit every file.
 */
function filenameSlug(file: string): string {
  return basename(file)
    .replace(/\.md$/i, "")
    .replace(/^(?:\d{8}-\d{2}|\d+)-/, "");
}

/**
 * Lower-cased body lines minus a leading H1 that restates `<id>: <title>`.
 * Counting that heading would add one line to every title hit, which the `*`
 * mark already reports. A heading that says anything else (the validator only
 * warns when it differs from the title) stays searchable, and so does a `#`
 * line further down, such as a shell comment in a code block.
 */
function bodyLinesWithoutHeading(adr: ParsedAdr): string[] {
  const lines = adr.body.toLowerCase().split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== "");
  const restated = `# ${adr.id}: ${adr.fm.title}`.toLowerCase().replace(/\s+/g, " ");
  if (first >= 0 && lines[first].trim().replace(/\s+/g, " ") === restated) lines.splice(first, 1);
  return lines;
}

/**
 * `superseded→ADR-20→ADR-30`. The last step carries its status when it is not
 * `accepted`, so a chain that ends at a missing, deprecated or not-adopted ADR
 * does not read as settled.
 */
function statusLabel(adr: ParsedAdr, successors: ChainStep[]): string {
  if (successors.length === 0) return adr.fm.status;
  const last = successors[successors.length - 1];
  const tail = last.status === "accepted" ? "" : `(${last.status ?? "not found"})`;
  return `${adr.fm.status}→${successors.map((s) => s.id).join("→")}${tail}`;
}

export function formatSearchText(hits: SearchHit[]): string {
  if (hits.length === 0) return "";
  const width = String(hits.length).length;
  const lines = hits.map((h, i) => {
    const terms = h.terms.map((t) => `${t.term}${t.titleHit ? "*" : ""}(${t.lines})`).join(" ");
    return [
      String(i + 1).padStart(width + 1),
      h.adr.id,
      statusLabel(h.adr, h.successors),
      h.adr.fm.date,
      h.adr.fm.title,
      `[${terms}]`,
    ].join("  ");
  });
  return lines.join("\n") + "\n";
}

export function formatSearchJson(hits: SearchHit[]): string {
  return (
    JSON.stringify(
      hits.map((h, i) => ({
        rank: i + 1,
        id: h.adr.id,
        title: h.adr.fm.title,
        status: h.adr.fm.status,
        date: h.adr.fm.date,
        file: h.adr.file,
        superseded_by_chain: h.successors,
        terms: h.terms.map((t) => ({ term: t.term, lines: t.lines, title_hit: t.titleHit })),
      })),
      null,
      2,
    ) + "\n"
  );
}

// ---------------------------------------------------------------------------
// refs

/** Relationship fields an ADR can point with, `superseded_by` included. */
const POINTING_FIELDS = [...RELATIONSHIP_FIELDS, "superseded_by"] as const;
type PointingField = (typeof POINTING_FIELDS)[number];

function pointers(adr: ParsedAdr, field: PointingField): string[] {
  const v = adr.fm[field];
  if (v === undefined || v === null) return [];
  return typeof v === "string" ? [v] : v;
}

export interface Referrer {
  adr: ParsedAdr;
  /** The fields on the referring ADR that point at the target. */
  relations: PointingField[];
  /** The referring ADR is later than the target (date, then id). */
  newer: boolean;
}

export interface Mention {
  adr: ParsedAdr;
  newer: boolean;
}

export interface AdrRefs {
  adr: ParsedAdr;
  /** The target's own relationship fields (`superseded_by` is in `successors`). */
  relations: Array<{ relation: PointingField; ids: string[] }>;
  successors: ChainStep[];
  /** ADRs whose relationship fields point at the target, newest first. */
  referencedBy: Referrer[];
  /** ADRs that mention the target in the body but in no relationship field, newest first. */
  mentionedInBody: Mention[];
}

/**
 * Everything that points at `id`, plus where `id` itself points. Throws when
 * `id` is not in `parsed`.
 */
export function adrRefs(parsed: ParsedAdr[], id: string, idFormat: IdFormat): AdrRefs {
  const byId = new Map(parsed.map((p) => [p.id, p]));
  const target = byId.get(id);
  if (!target) throw new Error(`ADR id "${id}" not found`);

  const relations = RELATIONSHIP_FIELDS.map((relation) => ({
    relation: relation as PointingField,
    ids: pointers(target, relation),
  })).filter((r) => r.ids.length > 0);

  const referencedBy: Referrer[] = [];
  const mentionedInBody: Mention[] = [];
  const idRe = adrIdRefRegex(idFormat);
  for (const p of parsed) {
    if (p.id === id) continue;
    const via = POINTING_FIELDS.filter((f) => pointers(p, f).includes(id));
    const newer = isNewer(p, target);
    if (via.length > 0) {
      referencedBy.push({ adr: p, relations: via, newer });
    } else if ((p.body.match(idRe) ?? ([] as string[])).includes(id)) {
      mentionedInBody.push({ adr: p, newer });
    }
  }
  referencedBy.sort((a, b) => compareNewerFirst(a.adr, b.adr));
  mentionedInBody.sort((a, b) => compareNewerFirst(a.adr, b.adr));

  return {
    adr: target,
    relations,
    successors: successorChain(target, byId),
    referencedBy,
    mentionedInBody,
  };
}

const NEWER = "← NEWER";

export function formatRefsText(results: AdrRefs[]): string {
  const blocks = results.map((r) => {
    const a = r.adr;
    const out = [`${a.id}  ${a.fm.status}  ${a.fm.date}  ${a.fm.title}`, `  file: ${a.file}`];
    if (r.successors.length > 0) {
      const chain = r.successors.map((s) => s.id).join(" → ");
      const last = r.successors[r.successors.length - 1];
      out.push(`  superseded by: ${chain} (${last.status ?? "not found"})`);
    }
    out.push(
      r.relations.length === 0
        ? "  relations: none"
        : `  relations: ${r.relations.map((x) => `${x.relation} ${x.ids.join(", ")}`).join("; ")}`,
    );
    out.push(`  referenced by: ${r.referencedBy.length === 0 ? "none" : ""}`.trimEnd());
    for (const ref of r.referencedBy) {
      out.push(`    ${row(ref.adr, ref.relations.join(", "), ref.newer)}`);
    }
    out.push(`  mentioned only in body: ${r.mentionedInBody.length === 0 ? "none" : ""}`.trimEnd());
    for (const m of r.mentionedInBody) out.push(`    ${row(m.adr, null, m.newer)}`);
    return out.join("\n");
  });
  return blocks.length === 0 ? "" : blocks.join("\n\n") + "\n";
}

function row(adr: ParsedAdr, relation: string | null, newer: boolean): string {
  const parts = [adr.id, adr.fm.status, adr.fm.date];
  if (relation) parts.push(relation);
  if (newer) parts.push(NEWER);
  parts.push(adr.fm.title);
  return parts.join("  ");
}

function summary(adr: ParsedAdr): Record<string, string> {
  return {
    id: adr.id,
    title: adr.fm.title,
    status: adr.fm.status,
    date: adr.fm.date,
    file: adr.file,
  };
}

export function formatRefsJson(results: AdrRefs[]): string {
  return (
    JSON.stringify(
      results.map((r) => ({
        ...summary(r.adr),
        relations: Object.fromEntries(r.relations.map((x) => [x.relation, x.ids])),
        superseded_by_chain: r.successors,
        referenced_by: r.referencedBy.map((x) => ({
          ...summary(x.adr),
          relations: x.relations,
          newer: x.newer,
        })),
        mentioned_in_body: r.mentionedInBody.map((x) => ({ ...summary(x.adr), newer: x.newer })),
      })),
      null,
      2,
    ) + "\n"
  );
}

// ---------------------------------------------------------------------------

/** `a` is later than `b`: by date, and by id when the dates are equal. */
function isNewer(a: ParsedAdr, b: ParsedAdr): boolean {
  if (a.fm.date !== b.fm.date) return a.fm.date > b.fm.date;
  return compareAdrIds(a.id, b.id) > 0;
}

function compareNewerFirst(a: ParsedAdr, b: ParsedAdr): number {
  if (a.fm.date !== b.fm.date) return a.fm.date < b.fm.date ? 1 : -1;
  return compareAdrIds(b.id, a.id);
}
