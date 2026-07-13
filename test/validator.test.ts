import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateDirectory } from "../src/validator.ts";
import { TEST_CONFIG } from "./test-helpers.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adr-validator-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  writeFileSync(join(tmp, file), content);
}

const adr = (fm: string, heading = "Sample") => `---
${fm}
---

# ${heading}

body text
`;

describe("validateDirectory", () => {
  it("accepts a minimal valid accepted ADR", () => {
    write(
      "20260101-01-sample.md",
      adr(
        `id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01`,
        "ADR-20260101-01: Sample",
      ),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors).toEqual([]);
    expect(result.parsed).toHaveLength(1);
  });

  it("rejects files without frontmatter", () => {
    write("20260101-01-legacy.md", "# legacy\n\nno frontmatter\n");
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("missing YAML frontmatter"))).toBe(true);
    expect(result.parsed).toHaveLength(0);
  });

  it("rejects invalid status", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: wip
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects invalid topic", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: accepted
topic: nonexistent
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("topic"))).toBe(true);
  });

  it("rejects missing topic", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: accepted
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("topic"))).toBe(true);
  });

  it("rejects unknown scope.concerns value", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01
scope:
  concerns:
    - nonsense`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("scope.concerns") && e.includes("nonsense"))).toBe(
      true,
    );
  });

  it("flags the legacy scope.domains field after the rename", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01
scope:
  domains:
    - parser`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(
      result.errors.some((e) => e.includes("renamed to") && e.includes("scope.concerns")),
    ).toBe(true);
  });

  it("rejects id mismatch with filename", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-99
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("does not match filename"))).toBe(true);
  });

  it("rejects superseded without superseded_by", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: superseded
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("superseded_by"))).toBe(true);
  });

  it("rejects superseded_by on non-superseded status", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01
superseded_by: ADR-20260102-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("only allowed when status=superseded"))).toBe(true);
  });

  it("rejects one-sided supersedes edge", () => {
    write(
      "20260101-01-old.md",
      adr(`id: ADR-20260101-01
title: Old
status: superseded
topic: core-concepts
date: 2026-01-01
superseded_by: ADR-20260102-01`),
    );
    write(
      "20260102-01-new.md",
      adr(`id: ADR-20260102-01
title: New
status: accepted
topic: core-concepts
date: 2026-01-02`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("does not list") && e.includes("supersedes"))).toBe(
      true,
    );
  });

  it("accepts bidirectionally consistent supersedes", () => {
    write(
      "20260101-01-old.md",
      adr(`id: ADR-20260101-01
title: Old
status: superseded
topic: core-concepts
date: 2026-01-01
superseded_by: ADR-20260102-01`),
    );
    write(
      "20260102-01-new.md",
      adr(`id: ADR-20260102-01
title: New
status: accepted
topic: core-concepts
date: 2026-01-02
supersedes:
  - ADR-20260101-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors).toEqual([]);
  });

  it("warns on unknown references", () => {
    write(
      "20260101-01-sample.md",
      adr(`id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01
depends_on:
  - ADR-99999999-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("ADR-99999999-01"))).toBe(true);
  });

  it("detects depends_on cycles", () => {
    write(
      "20260101-01-a.md",
      adr(`id: ADR-20260101-01
title: A
status: accepted
topic: core-concepts
date: 2026-01-01
depends_on:
  - ADR-20260101-02`),
    );
    write(
      "20260101-02-b.md",
      adr(`id: ADR-20260101-02
title: B
status: accepted
topic: core-concepts
date: 2026-01-01
depends_on:
  - ADR-20260101-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("depends_on cycle"))).toBe(true);
  });

  it("detects refines cycles", () => {
    write(
      "20260101-01-a.md",
      adr(`id: ADR-20260101-01
title: A
status: accepted
topic: core-concepts
date: 2026-01-01
refines:
  - ADR-20260101-02`),
    );
    write(
      "20260101-02-b.md",
      adr(`id: ADR-20260101-02
title: B
status: accepted
topic: core-concepts
date: 2026-01-01
refines:
  - ADR-20260101-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors.some((e) => e.includes("refines cycle"))).toBe(true);
  });

  it("errors when accepted depends_on superseded", () => {
    write(
      "20260101-01-old.md",
      adr(`id: ADR-20260101-01
title: Old
status: superseded
topic: core-concepts
date: 2026-01-01
superseded_by: ADR-20260101-02`),
    );
    write(
      "20260101-02-new.md",
      adr(`id: ADR-20260101-02
title: New
status: accepted
topic: core-concepts
date: 2026-01-01
supersedes:
  - ADR-20260101-01`),
    );
    write(
      "20260102-01-user.md",
      adr(`id: ADR-20260102-01
title: User
status: accepted
topic: core-concepts
date: 2026-01-02
depends_on:
  - ADR-20260101-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(
      result.errors.some((e) => e.includes("depends_on") && e.includes("status=superseded")),
    ).toBe(true);
  });

  it("accepts adr-tooling as a valid topic", () => {
    write(
      "20260101-01-sample.md",
      adr(
        `id: ADR-20260101-01
title: Sample
status: accepted
topic: adr-tooling
date: 2026-01-01`,
        "ADR-20260101-01: Sample",
      ),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.errors).toEqual([]);
  });

  it("warns when body mentions an ADR ID not in any relationship field", () => {
    write(
      "20260101-01-referrer.md",
      `---
id: ADR-20260101-01
title: Referrer
status: accepted
topic: core-concepts
date: 2026-01-01
---

# ADR-20260101-01: Referrer

background references ADR-20260101-02 without declaring the dep
`,
    );
    write(
      "20260101-02-target.md",
      adr(`id: ADR-20260101-02
title: Target
status: accepted
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(
      result.warnings.some((w) => w.includes("body mentions") && w.includes("ADR-20260101-02")),
    ).toBe(true);
  });

  it("does not warn when body mention is declared in any relationship field", () => {
    for (const field of ["depends_on", "related_to", "refines", "conflicts_with"]) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = mkdtempSync(join(tmpdir(), "adr-validator-"));
      write(
        "20260101-01-referrer.md",
        `---
id: ADR-20260101-01
title: Referrer
status: accepted
topic: core-concepts
date: 2026-01-01
${field}:
  - ADR-20260101-02
---

# ADR-20260101-01: Referrer

mentions ADR-20260101-02 in body
`,
      );
      write(
        "20260101-02-target.md",
        adr(`id: ADR-20260101-02
title: Target
status: accepted
topic: core-concepts
date: 2026-01-01`),
      );
      const result = validateDirectory(tmp, TEST_CONFIG);
      expect({
        field,
        warned: result.warnings.some(
          (w) => w.includes("body mentions") && w.includes("ADR-20260101-02"),
        ),
      }).toEqual({ field, warned: false });
    }
  });

  it("does not warn when body mention is declared via superseded_by", () => {
    write(
      "20260101-01-old.md",
      `---
id: ADR-20260101-01
title: Old
status: superseded
topic: core-concepts
date: 2026-01-01
superseded_by: ADR-20260102-01
---

# ADR-20260101-01: Old

superseded by ADR-20260102-01
`,
    );
    write(
      "20260102-01-new.md",
      adr(`id: ADR-20260102-01
title: New
status: accepted
topic: core-concepts
date: 2026-01-02
supersedes:
  - ADR-20260101-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(
      result.warnings.some((w) => w.includes("body mentions") && w.includes("ADR-20260102-01")),
    ).toBe(false);
  });

  it("warns when depends_on is declared but body never mentions it", () => {
    write(
      "20260101-01-referrer.md",
      `---
id: ADR-20260101-01
title: Referrer
status: accepted
topic: core-concepts
date: 2026-01-01
depends_on:
  - ADR-20260101-02
---

# ADR-20260101-01: Referrer

body with no reference to the dep
`,
    );
    write(
      "20260101-02-target.md",
      adr(`id: ADR-20260101-02
title: Target
status: accepted
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(
      result.warnings.some(
        (w) =>
          w.includes("depends_on") &&
          w.includes("ADR-20260101-02") &&
          w.includes("never mentioned"),
      ),
    ).toBe(true);
  });

  it("warns when body H1 title differs from frontmatter title", () => {
    write(
      "20260101-01-sample.md",
      adr(
        `id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01`,
        "ADR-20260101-01: Something else",
      ),
    );
    const result = validateDirectory(tmp, TEST_CONFIG);
    expect(result.warnings.some((w) => w.includes("body H1"))).toBe(true);
  });
});

describe("validateDirectory with idFormat: issue-number", () => {
  const ISSUE_CONFIG = { ...TEST_CONFIG, idFormat: "issue-number" as const };

  it("accepts ADR with issue-number id and matching filename", () => {
    write(
      "30-sample.md",
      adr(
        `id: ADR-30
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01`,
        "ADR-30: Sample",
      ),
    );
    const result = validateDirectory(tmp, ISSUE_CONFIG);
    expect(result.errors).toEqual([]);
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0].id).toBe("ADR-30");
  });

  it("rejects mismatch between filename and id", () => {
    write(
      "30-sample.md",
      adr(`id: ADR-31
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, ISSUE_CONFIG);
    expect(
      result.errors.some(
        (e) =>
          e.includes("does not match filename-derived id") &&
          e.includes("ADR-31") &&
          e.includes("ADR-30"),
      ),
    ).toBe(true);
  });

  it("rejects date-sequence filename under issue-number format", () => {
    // `20260101-01-foo.md` should not be recognized — issue-number format
    // expects `<n>-slug.md`. The leading 8-digit number is technically a
    // valid issue number, so this catches the strict-format edge case:
    // the file parses as `ADR-20260101`, which won't match the frontmatter
    // `ADR-20260101-01` that authors write under date-sequence.
    write(
      "20260101-01-legacy.md",
      adr(`id: ADR-20260101-01
title: Legacy
status: accepted
topic: core-concepts
date: 2026-01-01`),
    );
    const result = validateDirectory(tmp, ISSUE_CONFIG);
    expect(
      result.errors.some(
        (e) => e.includes("does not match filename-derived id") && e.includes("ADR-20260101"),
      ),
    ).toBe(true);
  });

  it("supports cross-references with bare ADR-<n> ids", () => {
    write(
      "30-referrer.md",
      `---
id: ADR-30
title: Referrer
status: accepted
topic: core-concepts
date: 2026-01-01
depends_on: [ADR-31]
---

# ADR-30: Referrer

This decision builds on ADR-31.
`,
    );
    write(
      "31-target.md",
      adr(
        `id: ADR-31
title: Target
status: accepted
topic: core-concepts
date: 2026-01-01`,
        "ADR-31: Target",
      ),
    );
    const result = validateDirectory(tmp, ISSUE_CONFIG);
    expect(result.errors).toEqual([]);
    // ADR-31 is both declared and mentioned, so no "declared but never mentioned" warning.
    expect(result.warnings.some((w) => w.includes("ADR-31") && w.includes("never mentioned"))).toBe(
      false,
    );
  });

  it("does not greedy-match ADR-3 inside ADR-30 in body references", () => {
    write(
      "3-short.md",
      `---
id: ADR-3
title: Short
status: accepted
topic: core-concepts
date: 2026-01-01
---

# ADR-3: Short

See ADR-30 for follow-up.
`,
    );
    write(
      "30-followup.md",
      adr(
        `id: ADR-30
title: Followup
status: accepted
topic: core-concepts
date: 2026-01-01`,
        "ADR-30: Followup",
      ),
    );
    const result = validateDirectory(tmp, ISSUE_CONFIG);
    // ADR-3's body mentions ADR-30 (not ADR-3 itself), so it should warn
    // about an undeclared reference to ADR-30. If \b weren't enforced, the
    // regex would either eat the trailing "0" into ADR-3 or match overlapping.
    expect(
      result.warnings.some(
        (w) =>
          w.includes("body mentions") &&
          w.includes("ADR-30") &&
          w.includes("not listed in any relationship field"),
      ),
    ).toBe(true);
  });

  describe("permalink schema", () => {
    const withPermalink = (permalinkYaml: string) =>
      adr(
        `id: ADR-20260101-01
title: Sample
status: accepted
topic: core-concepts
date: 2026-01-01
${permalinkYaml}`,
        "ADR-20260101-01: Sample",
      );

    it("parses a valid permalink entry onto the frontmatter", () => {
      write(
        "20260101-01-sample.md",
        withPermalink(`permalink:
  - short: https://taka.example/AbC
    source: examples/system.krs#krs-system-X
    view: system`),
      );
      const result = validateDirectory(tmp, TEST_CONFIG);
      expect(result.errors).toEqual([]);
      expect(result.parsed[0].fm.permalink).toEqual([
        {
          short: "https://taka.example/AbC",
          source: "examples/system.krs#krs-system-X",
          view: "system",
        },
      ]);
    });

    it("rejects a permalink entry missing source", () => {
      write(
        "20260101-01-sample.md",
        withPermalink(`permalink:
  - short: https://taka.example/AbC`),
      );
      const result = validateDirectory(tmp, TEST_CONFIG);
      expect(result.errors.some((e) => e.includes("permalink[0].source"))).toBe(true);
    });

    it("rejects a non-array permalink", () => {
      write(
        "20260101-01-sample.md",
        withPermalink(`permalink:
  source: a.krs`),
      );
      const result = validateDirectory(tmp, TEST_CONFIG);
      expect(result.errors.some((e) => e.includes('"permalink" must be an array'))).toBe(true);
    });
  });
});
