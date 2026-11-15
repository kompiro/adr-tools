import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeAdrId, parseRefsArgs } from "../src/cli/refs.ts";
import { parseSearchArgs } from "../src/cli/search.ts";
import type { AdrConfig } from "../src/config.ts";
import { loadParsed } from "../src/extractor.ts";
import {
  adrRefs,
  formatRefsJson,
  formatRefsText,
  formatSearchJson,
  formatSearchText,
  normalizeTerms,
  searchAdrs,
} from "../src/finder.ts";
import type { ParsedAdr } from "../src/validator.ts";
import { TEST_CONFIG } from "./test-helpers.ts";

const CONFIG: AdrConfig = { ...TEST_CONFIG, idFormat: "issue-number", topics: [] };

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adr-finder-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Spec {
  n: number;
  slug: string;
  title: string;
  date: string;
  status?: string;
  extra?: string;
  body?: string;
}

function writeAdr(s: Spec): void {
  const fm = [
    `id: ADR-${s.n}`,
    `title: ${s.title}`,
    `status: ${s.status ?? "accepted"}`,
    `topic: core-concepts`,
    `date: ${s.date}`,
    s.extra ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(
    join(tmp, `${s.n}-${s.slug}.md`),
    `---\n${fm}\n---\n\n# ADR-${s.n}: ${s.title}\n\n${s.body ?? "body"}\n`,
  );
}

function load(): ParsedAdr[] {
  return loadParsed(tmp, CONFIG);
}

describe("normalizeTerms", () => {
  it("drops empty terms and terms that differ only in case, keeping the first spelling", () => {
    expect(normalizeTerms(["Icon", "", "icon", "ICON mode", "icon Mode", "x"])).toEqual([
      "Icon",
      "ICON mode",
      "x",
    ]);
  });
});

describe("searchAdrs", () => {
  function seedSearch(): void {
    writeAdr({
      n: 10,
      slug: "icon-mode",
      title: "Icon mode stays",
      date: "2026-01-01",
      status: "superseded",
      extra: "superseded_by: ADR-20",
      body: "The icon mode is kept.\nRemoval is later.\nicon mode again.",
    });
    writeAdr({
      n: 20,
      slug: "keep-deprecated",
      title: "Keep it deprecated",
      date: "2026-02-01",
      status: "superseded",
      extra: "supersedes: [ADR-10]\nsuperseded_by: ADR-30",
      body: "Supersedes ADR-10. No removal yet for icon mode.",
    });
    writeAdr({
      n: 30,
      slug: "final",
      title: "Final word",
      date: "2026-03-01",
      extra: "supersedes: [ADR-20]",
      body: "Supersedes ADR-20.",
    });
    writeAdr({
      n: 40,
      slug: "unrelated",
      title: "Unrelated",
      date: "2026-03-02",
      body: "nothing here",
    });
  }

  it("ranks by distinct terms matched before title hits and line counts", () => {
    seedSearch();
    const hits = searchAdrs(load(), ["icon mode", "removal"]);
    expect(hits.map((h) => h.adr.id)).toEqual(["ADR-10", "ADR-20"]);
    expect(hits[0].terms).toEqual([
      { term: "icon mode", lines: 2, titleHit: true },
      { term: "removal", lines: 1, titleHit: false },
    ]);
  });

  it("counts a filename-only hit as a title hit", () => {
    seedSearch();
    const hits = searchAdrs(load(), ["deprecated"]);
    expect(hits.map((h) => h.adr.id)).toEqual(["ADR-20"]);
    expect(hits[0].terms[0].titleHit).toBe(true);
  });

  it("is case-insensitive and does not count a term twice when it is repeated in another case", () => {
    seedSearch();
    const hits = searchAdrs(load(), ["ICON MODE", "icon mode"]);
    expect(hits[0].terms).toHaveLength(1);
    expect(hits[0].terms[0].term).toBe("ICON MODE");
  });

  it("follows superseded_by to the end of the chain", () => {
    seedSearch();
    const [first] = searchAdrs(load(), ["icon mode"]);
    expect(first.successors).toEqual([
      { id: "ADR-20", status: "superseded" },
      { id: "ADR-30", status: "accepted" },
    ]);
  });

  it("breaks ties with the newer ADR first", () => {
    seedSearch();
    const hits = searchAdrs(load(), ["supersedes"]);
    expect(hits.map((h) => h.adr.id)).toEqual(["ADR-30", "ADR-20"]);
  });

  it("caps the result at limit", () => {
    seedSearch();
    expect(searchAdrs(load(), ["icon"], { limit: 1 })).toHaveLength(1);
  });

  it("matches the filename slug only, not its id prefix or extension", () => {
    seedSearch();
    expect(searchAdrs(load(), ["md"])).toEqual([]);
    expect(searchAdrs(load(), ["40"])).toEqual([]);
  });

  it("drops only a leading H1 from the line count, not a later # line", () => {
    writeFileSync(
      join(tmp, "7-no-heading.md"),
      "---\nid: ADR-7\ntitle: No heading\nstatus: accepted\ntopic: core-concepts\ndate: 2026-01-01\n---\n\nIntro.\n\n```sh\n# install redis\n```\n",
    );
    const [hit] = searchAdrs(load(), ["redis"]);
    expect(hit.terms).toEqual([{ term: "redis", lines: 1, titleHit: false }]);
  });

  it("keeps a leading H1 searchable when it does not restate the id and title", () => {
    writeFileSync(
      join(tmp, "8-cache.md"),
      "---\nid: ADR-8\ntitle: Cache\nstatus: accepted\ntopic: core-concepts\ndate: 2026-01-01\n---\n\n# ADR-8: Redis\n\nbody\n",
    );
    const [hit] = searchAdrs(load(), ["redis"]);
    expect(hit.adr.id).toBe("ADR-8");
    expect(hit.terms).toEqual([{ term: "redis", lines: 1, titleHit: false }]);
  });

  it("shows the status at the end of the chain when it is not accepted", () => {
    writeAdr({
      n: 50,
      slug: "dangling",
      title: "Dangling",
      date: "2026-01-01",
      status: "superseded",
      extra: "superseded_by: ADR-99",
    });
    expect(formatSearchText(searchAdrs(load(), ["dangling"]))).toBe(
      " 1  ADR-50  superseded→ADR-99(not found)  2026-01-01  Dangling  [dangling*(0)]\n",
    );
  });

  it("throws when no non-empty term is given", () => {
    expect(() => searchAdrs([], ["", ""])).toThrow(/at least one/);
  });

  it("writes one line per ADR with the successor chain and the per-term counts", () => {
    seedSearch();
    const text = formatSearchText(searchAdrs(load(), ["icon mode", "removal"]));
    expect(text).toBe(
      [
        " 1  ADR-10  superseded→ADR-20→ADR-30  2026-01-01  Icon mode stays  [icon mode*(2) removal(1)]",
        " 2  ADR-20  superseded→ADR-30  2026-02-01  Keep it deprecated  [icon mode(1) removal(1)]",
        "",
      ].join("\n"),
    );
    expect(formatSearchText([])).toBe("");
  });

  it("writes JSON with the rank, the chain and the term hits", () => {
    seedSearch();
    const json = JSON.parse(formatSearchJson(searchAdrs(load(), ["final"])));
    expect(json).toEqual([
      {
        rank: 1,
        id: "ADR-30",
        title: "Final word",
        status: "accepted",
        date: "2026-03-01",
        file: join(tmp, "30-final.md"),
        superseded_by_chain: [],
        terms: [{ term: "final", lines: 0, title_hit: true }],
      },
    ]);
  });
});

describe("adrRefs", () => {
  function seedRefs(): void {
    writeAdr({
      n: 5,
      slug: "base",
      title: "Base",
      date: "2026-01-10",
      status: "superseded",
      extra: "superseded_by: ADR-9\nrelated_to: [ADR-1, ADR-4]",
      body: "Related to ADR-1 and ADR-4.",
    });
    writeAdr({ n: 1, slug: "older", title: "Older", date: "2026-01-01", body: "body" });
    writeAdr({
      n: 4,
      slug: "same-day-earlier",
      title: "Same day, lower id",
      date: "2026-01-10",
      extra: "depends_on: [ADR-5]",
      body: "Depends on ADR-5.",
    });
    writeAdr({
      n: 9,
      slug: "replacement",
      title: "Replacement",
      date: "2026-02-01",
      extra: "supersedes: [ADR-5]\nrefines: [ADR-5]",
      body: "Replaces ADR-5.",
    });
    writeAdr({
      n: 12,
      slug: "body-only",
      title: "Body only",
      date: "2026-03-01",
      body: "We looked at ADR-5 again.",
    });
    writeAdr({
      n: 13,
      slug: "longer-id",
      title: "Longer id",
      date: "2026-03-02",
      body: "Mentions ADR-55 and ADR-50.",
    });
  }

  it("lists every ADR whose relationship fields point at the target, with the fields", () => {
    seedRefs();
    const r = adrRefs(load(), "ADR-5", "issue-number");
    expect(r.referencedBy.map((x) => [x.adr.id, x.relations, x.newer])).toEqual([
      ["ADR-9", ["supersedes", "refines"], true],
      ["ADR-4", ["depends_on"], false],
    ]);
  });

  it("on the same date, marks a referrer newer only when its id sorts later", () => {
    seedRefs();
    const adrs = load();
    // ADR-4 and ADR-5 share a date and point at each other.
    expect(
      adrRefs(adrs, "ADR-4", "issue-number").referencedBy.map((x) => [x.adr.id, x.newer]),
    ).toEqual([["ADR-5", true]]);
    expect(
      adrRefs(adrs, "ADR-5", "issue-number").referencedBy.find((x) => x.adr.id === "ADR-4")?.newer,
    ).toBe(false);
  });

  it("counts superseded_by as a pointing field", () => {
    seedRefs();
    const r = adrRefs(load(), "ADR-9", "issue-number");
    expect(r.referencedBy.map((x) => [x.adr.id, x.relations])).toEqual([
      ["ADR-5", ["superseded_by"]],
    ]);
  });

  it("lists body-only mentions apart from frontmatter relations, without matching longer ids", () => {
    seedRefs();
    const r = adrRefs(load(), "ADR-5", "issue-number");
    expect(r.mentionedInBody.map((x) => [x.adr.id, x.newer])).toEqual([["ADR-12", true]]);
  });

  it("reports the target's own relations and its successor chain", () => {
    seedRefs();
    const r = adrRefs(load(), "ADR-5", "issue-number");
    expect(r.relations).toEqual([{ relation: "related_to", ids: ["ADR-1", "ADR-4"] }]);
    expect(r.successors).toEqual([{ id: "ADR-9", status: "accepted" }]);
  });

  it("throws for an unknown id", () => {
    seedRefs();
    expect(() => adrRefs(load(), "ADR-404", "issue-number")).toThrow(/not found/);
  });

  it("writes a text block that says when nothing points at the ADR", () => {
    seedRefs();
    const adrs = load();
    expect(formatRefsText([adrRefs(adrs, "ADR-5", "issue-number")])).toBe(
      [
        "ADR-5  superseded  2026-01-10  Base",
        `  file: ${join(tmp, "5-base.md")}`,
        "  superseded by: ADR-9 (accepted)",
        "  relations: related_to ADR-1, ADR-4",
        "  referenced by:",
        "    ADR-9  accepted  2026-02-01  supersedes, refines  ← NEWER  Replacement",
        "    ADR-4  accepted  2026-01-10  depends_on  Same day, lower id",
        "  mentioned only in body:",
        "    ADR-12  accepted  2026-03-01  ← NEWER  Body only",
        "",
      ].join("\n"),
    );
    expect(formatRefsText([adrRefs(adrs, "ADR-13", "issue-number")])).toContain(
      "  relations: none\n  referenced by: none\n  mentioned only in body: none\n",
    );
  });

  it("writes JSON with relations keyed by field", () => {
    seedRefs();
    const [json] = JSON.parse(formatRefsJson([adrRefs(load(), "ADR-5", "issue-number")]));
    expect(json.relations).toEqual({ related_to: ["ADR-1", "ADR-4"] });
    expect(json.superseded_by_chain).toEqual([{ id: "ADR-9", status: "accepted" }]);
    expect(json.referenced_by[0]).toMatchObject({
      id: "ADR-9",
      relations: ["supersedes", "refines"],
      newer: true,
    });
    expect(json.mentioned_in_body).toEqual([
      expect.objectContaining({ id: "ADR-12", newer: true }),
    ]);
  });

  it("matches date-sequence ids in the body", () => {
    writeFileSync(
      join(tmp, "20260101-01-a.md"),
      "---\nid: ADR-20260101-01\ntitle: A\nstatus: accepted\ntopic: core-concepts\ndate: 2026-01-01\n---\n\n# ADR-20260101-01: A\n",
    );
    writeFileSync(
      join(tmp, "20260102-01-b.md"),
      "---\nid: ADR-20260102-01\ntitle: B\nstatus: accepted\ntopic: core-concepts\ndate: 2026-01-02\n---\n\n# ADR-20260102-01: B\n\nSee ADR-20260101-01.\n",
    );
    const adrs = loadParsed(tmp, { ...CONFIG, idFormat: "date-sequence" });
    const r = adrRefs(adrs, "ADR-20260101-01", "date-sequence");
    expect(r.mentionedInBody.map((x) => x.adr.id)).toEqual(["ADR-20260102-01"]);
  });
});

describe("parseSearchArgs", () => {
  it("takes terms, -n, --limit, --format and --dir", () => {
    expect(parseSearchArgs(["a", "-n", "3", "b c", "--format=json", "--dir=x"])).toEqual({
      terms: ["a", "b c"],
      limit: 3,
      format: "json",
      dir: "x",
    });
    expect(parseSearchArgs(["a", "--limit=7"])).toMatchObject({ limit: 7 });
  });

  it("treats arguments after -- as terms", () => {
    expect(parseSearchArgs(["--", "-x", "--format=json"])).toMatchObject({
      terms: ["-x", "--format=json"],
      format: "text",
    });
  });

  it("rejects a missing term, a bad limit, a bad format and unknown options", () => {
    expect(parseSearchArgs([])).toHaveProperty("error");
    expect(parseSearchArgs(["a", "-n"])).toHaveProperty("error");
    expect(parseSearchArgs(["a", "-n", "0"])).toHaveProperty("error");
    expect(parseSearchArgs(["a", "--format=list"])).toHaveProperty("error");
    expect(parseSearchArgs(["a", "-x"])).toHaveProperty("error");
    expect(parseSearchArgs(["a", "-n"])).toEqual({ error: "-n requires a value" });
    expect(parseSearchArgs(["a", "--dir="])).toEqual({ error: "--dir requires a path" });
  });
});

describe("parseRefsArgs", () => {
  it("takes ids once each, --format and --dir", () => {
    expect(parseRefsArgs(["ADR-1", "ADR-2", "ADR-1", "--format=json", "--dir=d"])).toEqual({
      ids: ["ADR-1", "ADR-2"],
      format: "json",
      dir: "d",
    });
  });

  it("rejects a missing id and unknown options", () => {
    expect(parseRefsArgs([])).toHaveProperty("error");
    expect(parseRefsArgs(["ADR-1", "--outside"])).toHaveProperty("error");
    expect(parseRefsArgs(["ADR-1", "--dir="])).toEqual({ error: "--dir requires a path" });
  });

  it("accepts a bare number or a lowercase prefix as an id", () => {
    expect(normalizeAdrId("38")).toBe("ADR-38");
    expect(normalizeAdrId("adr-38")).toBe("ADR-38");
    expect(normalizeAdrId("20260101-01")).toBe("ADR-20260101-01");
    expect(normalizeAdrId("ADR-38")).toBe("ADR-38");
    expect(parseRefsArgs(["38", "ADR-38"])).toMatchObject({ ids: ["ADR-38"] });
  });
});
