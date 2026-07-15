import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdrConfig } from "../src/config.ts";
import {
  checkRepoBackedPin,
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
  it("does not reject an unrelated fragment that merely contains `s=`", () => {
    expect(validateShort("https://x.example/AbC#tips=1")).toBeNull();
  });
});

describe("checkRepoBackedPin", () => {
  const SHA = "a".repeat(40); // a full 40-hex commit SHA
  const HOSTS = ["karasu-nest.example"];

  it("returns null for a SHA-pinned repo-backed link (prefixed route)", () => {
    expect(checkRepoBackedPin(`https://karasu-nest.example/r/o/repo@${SHA}`, HOSTS)).toBeNull();
  });

  it("returns null for a SHA-pinned bare route with a deep anchor", () => {
    // The `@<sha>` sits in the pathname; the `#krs-…` anchor lives in the hash
    // and must not be mistaken for the ref.
    expect(
      checkRepoBackedPin(`https://karasu-nest.example/o/repo@${SHA}#krs-system-x`, HOSTS),
    ).toBeNull();
  });

  it("warns on a ref-less repo-backed link (mutable default branch)", () => {
    expect(checkRepoBackedPin("https://karasu-nest.example/r/o/repo", HOSTS)).toMatch(
      /not pinned to a commit SHA/,
    );
  });

  it("warns on a branch/tag ref", () => {
    expect(checkRepoBackedPin("https://karasu-nest.example/r/o/repo@main", HOSTS)).toMatch(
      /mutable ref/,
    );
  });

  it("warns on an abbreviated SHA (collision-prone, not immutable)", () => {
    expect(checkRepoBackedPin("https://karasu-nest.example/r/o/repo@abc1234", HOSTS)).toMatch(
      /not pinned/,
    );
  });

  it("ignores a link whose host is not in the allowlist (e.g. a taka short link)", () => {
    expect(checkRepoBackedPin("https://taka.example/AbC", HOSTS)).toBeNull();
  });

  it("is inert when the allowlist is empty", () => {
    expect(checkRepoBackedPin(`https://karasu-nest.example/r/o/repo@main`, [])).toBeNull();
  });

  it("detects by host regardless of route form (bare vs /r/ prefix)", () => {
    // Same non-pinned verdict whether or not the route carries a `/r/` prefix.
    expect(checkRepoBackedPin("https://karasu-nest.example/o/repo@main", HOSTS)).toMatch(
      /not pinned/,
    );
    expect(checkRepoBackedPin("https://karasu-nest.example/r/o/repo@main", HOSTS)).toMatch(
      /not pinned/,
    );
  });
});

describe("evaluatePermalinksForAdr — repo-backed @<sha> recommendation", () => {
  const SHA = "a".repeat(40);
  const cfg: AdrConfig = {
    ...TEST_CONFIG,
    permalink: { kind: "krs", repoBackedHosts: ["karasu-nest.example"] },
  };

  it("warns (non-fatal) on a non-pinned repo-backed short", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs", short: "https://karasu-nest.example/r/o/repo@main" }]),
      tmp,
      cfg,
    );
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("warn");
    expect(r[0].message).toMatch(/@<40-hex-sha>/);
  });

  it("passes (ok) a SHA-pinned repo-backed short", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs", short: `https://karasu-nest.example/r/o/repo@${SHA}` }]),
      tmp,
      cfg,
    );
    expect(r[0].status).toBe("ok");
  });

  it("leaves a non-repo-backed short (taka) untouched", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs", short: "https://taka.example/AbC" }]),
      tmp,
      cfg,
    );
    expect(r[0].status).toBe("ok");
  });

  it("does not run the pin check when no repoBackedHosts are configured", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs", short: "https://karasu-nest.example/r/o/repo@main" }]),
      tmp,
      TEST_CONFIG, // no permalink.repoBackedHosts
    );
    expect(r[0].status).toBe("ok");
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

  it("fails a deep anchor when no resolver is configured", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs#krs-system-X" }]),
      tmp,
      TEST_CONFIG, // no permalink.kind
    );
    expect(r[0].status).toBe("fail");
    expect(r[0].message).toMatch(/no `permalink.kind` resolver/);
  });

  it("fails an unknown `view` via the resolver", async () => {
    writeFileSync(join(tmp, "sys.krs"), "system S {}");
    const r = await evaluatePermalinksForAdr(
      fakeAdr([{ source: "sys.krs", view: "sytem" }]),
      tmp,
      KRS_CONFIG,
      {
        resolver: createKrsResolver(async () => ({
          buildAllViewsSvgProject: async () => ({ svg: "" }),
        })),
      },
    );
    expect(r[0].status).toBe("fail");
    expect(r[0].message).toMatch(/unknown view/);
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

  it("does NOT accept a bare `krs-<view>` as whole-view — it is membership-checked", async () => {
    // `krs-system` is not a whole-view tab (deploy/matrix/org-tree are); a
    // truncated deep anchor must be caught, not auto-passed.
    const r = createKrsResolver(fakeCore(["krs-system-root", "krs-system-Payments"]));
    expect((await r.resolveAnchor("/x/sys.krs", "krs-system")).ok).toBe(false);
  });

  it("renders each source only once across repeated anchors (memoized)", async () => {
    let renders = 0;
    const r = createKrsResolver(async () => ({
      buildAllViewsSvgProject: async () => {
        renders++;
        return { svg: '<g id="krs-system-A"><g id="krs-system-B">' };
      },
    }));
    await r.resolveAnchor("/x/sys.krs", "krs-system-A");
    await r.resolveAnchor("/x/sys.krs", "krs-system-B");
    await r.resolveAnchor("/x/sys.krs", "krs-system-A");
    expect(renders).toBe(1);
  });

  it("validateView accepts known views and rejects unknown", () => {
    const r = createKrsResolver(fakeCore([]));
    expect(r.validateView?.("system")).toBeNull();
    expect(r.validateView?.("entity")).toBeNull();
    expect(r.validateView?.("sytem")).toMatch(/unknown view/);
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
