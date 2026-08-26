import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdrConfigInvalidError, AdrConfigMissingError, loadConfig } from "../src/config.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adr-config-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function write(content: string): void {
  writeFileSync(join(tmp, "adr.config.json"), content);
}

const VALID = {
  topics: ["a", "b"],
  concerns: ["c"],
  paths: { adrDir: "docs/adr", outputs: { effective: "e.md", graph: "g.md", graphByTopic: "gt/" } },
};

describe("loadConfig", () => {
  it("loads a valid adr.config.json", () => {
    write(JSON.stringify(VALID));
    const cfg = loadConfig(tmp);
    expect(cfg.topics).toEqual(["a", "b"]);
    expect(cfg.concerns).toEqual(["c"]);
    expect(cfg.paths.adrDir).toBe("docs/adr");
    expect(cfg.paths.outputs.effective).toBe("e.md");
  });

  it("throws AdrConfigMissingError when file absent", () => {
    expect(() => loadConfig(tmp)).toThrow(AdrConfigMissingError);
  });

  it("missing-error message points the user at adr:init", () => {
    expect(() => loadConfig(tmp)).toThrow(/adr:init/);
  });

  it("throws AdrConfigInvalidError for invalid JSON", () => {
    write("{not json");
    expect(() => loadConfig(tmp)).toThrow(AdrConfigInvalidError);
  });

  it("throws AdrConfigInvalidError when topics is missing", () => {
    const { topics: _t, ...rest } = VALID;
    write(JSON.stringify(rest));
    expect(() => loadConfig(tmp)).toThrow(/topics/);
  });

  it("throws AdrConfigInvalidError when paths.outputs.graph is missing", () => {
    write(
      JSON.stringify({
        ...VALID,
        paths: { ...VALID.paths, outputs: { effective: "e.md", graphByTopic: "gt/" } },
      }),
    );
    expect(() => loadConfig(tmp)).toThrow(/graph/);
  });

  it("accepts empty arrays for topics and concerns", () => {
    write(JSON.stringify({ ...VALID, topics: [], concerns: [] }));
    const cfg = loadConfig(tmp);
    expect(cfg.topics).toEqual([]);
    expect(cfg.concerns).toEqual([]);
  });

  it("rejects non-string elements in topics", () => {
    write(JSON.stringify({ ...VALID, topics: ["a", 1] }));
    expect(() => loadConfig(tmp)).toThrow(/topics/);
  });

  it("defaults idFormat to date-sequence when omitted", () => {
    write(JSON.stringify(VALID));
    const cfg = loadConfig(tmp);
    expect(cfg.idFormat).toBe("date-sequence");
  });

  it("accepts idFormat: issue-number", () => {
    write(JSON.stringify({ ...VALID, idFormat: "issue-number" }));
    const cfg = loadConfig(tmp);
    expect(cfg.idFormat).toBe("issue-number");
  });

  it("rejects unknown idFormat value", () => {
    write(JSON.stringify({ ...VALID, idFormat: "weekly" }));
    expect(() => loadConfig(tmp)).toThrow(/idFormat/);
  });

  it("rejects non-string idFormat value", () => {
    write(JSON.stringify({ ...VALID, idFormat: 1 }));
    expect(() => loadConfig(tmp)).toThrow(/idFormat/);
  });

  it("omits permalink when not configured", () => {
    write(JSON.stringify(VALID));
    expect(loadConfig(tmp).permalink).toBeUndefined();
  });

  it("accepts permalink.kind: krs", () => {
    write(JSON.stringify({ ...VALID, permalink: { kind: "krs" } }));
    expect(loadConfig(tmp).permalink).toEqual({ kind: "krs" });
  });

  it("rejects an unknown permalink.kind", () => {
    write(JSON.stringify({ ...VALID, permalink: { kind: "mermaid" } }));
    expect(() => loadConfig(tmp)).toThrow(/permalink.kind/);
  });

  it("rejects a non-object permalink", () => {
    write(JSON.stringify({ ...VALID, permalink: "krs" }));
    expect(() => loadConfig(tmp)).toThrow(/permalink/);
  });

  it("accepts permalink.repoBackedHosts as a string array", () => {
    write(
      JSON.stringify({
        ...VALID,
        permalink: { kind: "krs", repoBackedHosts: ["nest.example", "nest2.example"] },
      }),
    );
    expect(loadConfig(tmp).permalink).toEqual({
      kind: "krs",
      repoBackedHosts: ["nest.example", "nest2.example"],
    });
  });

  it("rejects a non-string-array permalink.repoBackedHosts", () => {
    write(JSON.stringify({ ...VALID, permalink: { kind: "krs", repoBackedHosts: [1, 2] } }));
    expect(() => loadConfig(tmp)).toThrow(/repoBackedHosts/);
  });
});

describe("assumptions.rangePin", () => {
  it("defaults to absent so the validator applies its own default", () => {
    write(JSON.stringify(VALID));
    expect(loadConfig(tmp).assumptions).toBeUndefined();
  });

  it("accepts each severity", () => {
    for (const rangePin of ["off", "warn", "error"] as const) {
      write(JSON.stringify({ ...VALID, assumptions: { rangePin } }));
      expect(loadConfig(tmp).assumptions).toEqual({ rangePin });
    }
  });

  it("rejects an unknown severity", () => {
    write(JSON.stringify({ ...VALID, assumptions: { rangePin: "fatal" } }));
    expect(() => loadConfig(tmp)).toThrow(AdrConfigInvalidError);
  });

  it("rejects a non-object assumptions block", () => {
    write(JSON.stringify({ ...VALID, assumptions: "error" }));
    expect(() => loadConfig(tmp)).toThrow(AdrConfigInvalidError);
  });
});
