import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdrConfig } from "../src/config.ts";
import {
  createKrsResolver,
  evaluatePermalinksForAdr,
  normalizeKrsAnchor,
  splitSourceAnchor,
  validateShort,
  type PermalinkResolver,
} from "../src/permalink.ts";
import type { ParsedAdr, PermalinkEntry } from "../src/validator.ts";
import { TEST_CONFIG } from "./test-helpers.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adr-permalink-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fakeAdr(permalink: PermalinkEntry[]): ParsedAdr {
  return {
    file: "ADR-1.md",
    id: "ADR-1",
    fm: {
      id: "ADR-1",
      title: "t",
      status: "accepted",
      date: "2026-01-01",
      topic: "core-concepts",
      permalink,
    },
    bodyHeading: null,
    body: "",
  };
}

/** A config with the krs kind enabled but resolver injected per-test. */
const KRS_CONFIG: AdrConfig = { ...TEST_CONFIG, permalink: { kind: "krs" } };

/** Resolver that accepts a fixed set of fragments; everything else fails. */
function fakeResolver(accept: string[]): PermalinkResolver {
  const ok = new Set(accept);
  return {
    async resolveAnchor(_src, fragment) {
      return ok.has(fragment) ? { ok: true } : { ok: false, message: `no: ${fragment}` };
    },
  };
}

describe("splitSourceAnchor", () => {
  it("splits path and fragment", () => {
    expect(splitSourceAnchor("a/b.krs#krs-system-X")).toEqual({
      path: "a/b.krs",
      fragment: "krs-system-X",
    });
  });
  it("returns null fragment when absent", () => {
    expect(splitSourceAnchor("a/b.krs")).toEqual({ path: "a/b.krs", fragment: null });
  });
});

describe("normalizeKrsAnchor", () => {
  it("drops a leading # and the :highlight suffix", () => {
    expect(normalizeKrsAnchor("#krs-system-X:focusY")).toBe("krs-system-X");
    expect(normalizeKrsAnchor("krs-org-Team")).toBe("krs-org-Team");
  });
});

describe("validateShort", () => {
  it("accepts an https query-form short link", () => {
    expect(validateShort("https://taka.example/AbC")).toBeNull();
  });
  it("rejects a non-URL", () => {
    expect(validateShort("not a url")).toMatch(/not a valid URL/);
  });
  it("rejects a #s= fragment share", () => {
    expect(validateShort("https://x.example/s#s=eyJ")).toMatch(/fragment/);
  });
});

describe("evaluatePermalinksForAdr (generic layer)", () => {
  it("passes a source that exists with no anchor", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(fakeAdr([{ source: "sys.krs" }]), tmp, TEST_CONFIG);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("ok");
  });

  it("fails a missing source", async () => {
    const r = await evaluatePermalinksForAdr(fakeAdr([{ source: "nope.krs" }]), tmp, TEST_CONFIG);
    expect(r[0].status).toBe("fail");
    expect(r[0].message).toMatch(/does not exist/);
  });

  it("fails a malformed short but keeps the entry located", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs", short: "nope" }]),
      tmp,
      TEST_CONFIG,
    );
    expect(r[0].status).toBe("fail");
    expect(r[0].message).toMatch(/not a valid URL/);
    expect(r[0].at).toBe("permalink[0]");
  });

  it("defers a deep anchor to manual review when no resolver is configured", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs#krs-system-X" }]),
      tmp,
      TEST_CONFIG, // no permalink.kind
    );
    expect(r[0].status).toBe("manual");
    expect(r[0].message).toMatch(/no `permalink.kind` resolver/);
  });

  it("resolves a deep anchor with the configured resolver (ok)", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs#krs-system-X" }]),
      tmp,
      KRS_CONFIG,
      { resolver: fakeResolver(["krs-system-X"]) },
    );
    expect(r[0].status).toBe("ok");
  });

  it("fails a deep anchor the resolver rejects (dangling)", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs#krs-system-Gone" }]),
      tmp,
      KRS_CONFIG,
      { resolver: fakeResolver(["krs-system-X"]) },
    );
    expect(r[0].status).toBe("fail");
  });

  it("reports each entry independently", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs" }, { source: "gone.krs" }]),
      tmp,
      TEST_CONFIG,
    );
    expect(r.map((x) => x.status)).toEqual(["ok", "fail"]);
    expect(r[1].at).toBe("permalink[1]");
  });
});

describe("createKrsResolver", () => {
  // Inject a fake @karasu-tools/core so the unit test needs no real render.
  function fakeCore(ids: string[]) {
    const svg = ids.map((id) => `<g id="${id}">`).join("");
    return async () => ({ buildAllViewsSvgProject: async () => ({ svg }) });
  }

  it("passes an anchor present in the emitted set", async () => {
    const r = createKrsResolver(fakeCore(["krs-system-Payments"]));
    expect(await r.resolveAnchor("/x/sys.krs", "krs-system-Payments")).toEqual({ ok: true });
  });

  it("fails an anchor absent from the emitted set", async () => {
    const r = createKrsResolver(fakeCore(["krs-system-Payments"]));
    const res = await r.resolveAnchor("/x/sys.krs", "krs-system-Gone");
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown view without loading core", async () => {
    let loaded = false;
    const r = createKrsResolver(async () => {
      loaded = true;
      return { buildAllViewsSvgProject: async () => ({ svg: "" }) };
    });
    const res = await r.resolveAnchor("/x/sys.krs", "krs-bogus-X");
    expect(res.ok).toBe(false);
    expect(loaded).toBe(false);
  });

  it("accepts a whole-view anchor without loading core", async () => {
    let loaded = false;
    const r = createKrsResolver(async () => {
      loaded = true;
      return { buildAllViewsSvgProject: async () => ({ svg: "" }) };
    });
    expect(await r.resolveAnchor("/x/sys.krs", "krs-deploy")).toEqual({ ok: true });
    expect(loaded).toBe(false);
  });

  it("fails clearly when core cannot be loaded", async () => {
    const r = createKrsResolver(async () => {
      throw new Error("Cannot find module");
    });
    const res = await r.resolveAnchor("/x/sys.krs", "krs-system-X");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/@karasu-tools\/core/);
  });
});

describe("createKrsResolver — integration with real @karasu-tools/core", () => {
  it("resolves a real element anchor and rejects a dangling one", async () => {
    writeFileSync(
      join(tmp, "sys.krs"),
      `system Shop {\n  service Payments {\n    domain Ledger { usecase Charge {} }\n  }\n}\n`,
    );
    const r = createKrsResolver();
    const good = await r.resolveAnchor(join(tmp, "sys.krs"), "krs-system-Payments");
    expect(good).toEqual({ ok: true });
    const bad = await r.resolveAnchor(join(tmp, "sys.krs"), "krs-system-Nope");
    expect(bad.ok).toBe(false);
  });
});
