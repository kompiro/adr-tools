import { describe, expect, it } from "vitest";
import { compareAdrIds } from "../src/sort.ts";

const sorted = (ids: string[]): string[] => [...ids].sort(compareAdrIds);

describe("compareAdrIds", () => {
  describe("issue-number ids", () => {
    it("orders unpadded numbers numerically, not lexically", () => {
      // The bug this exists to prevent: a plain string sort yields
      // ADR-1000 < ADR-99 < ADR-999.
      expect(sorted(["ADR-1000", "ADR-99", "ADR-999"])).toEqual(["ADR-99", "ADR-999", "ADR-1000"]);
    });

    it("orders a realistic corpus spanning several magnitudes", () => {
      expect(sorted(["ADR-2083", "ADR-7", "ADR-40", "ADR-525", "ADR-1886", "ADR-9001"])).toEqual([
        "ADR-7",
        "ADR-40",
        "ADR-525",
        "ADR-1886",
        "ADR-2083",
        "ADR-9001",
      ]);
    });

    it("is antisymmetric", () => {
      expect(compareAdrIds("ADR-99", "ADR-1000")).toBeLessThan(0);
      expect(compareAdrIds("ADR-1000", "ADR-99")).toBeGreaterThan(0);
    });

    it("treats an identical id as equal", () => {
      expect(compareAdrIds("ADR-525", "ADR-525")).toBe(0);
    });
  });

  describe("date-sequence ids", () => {
    it("orders chronologically", () => {
      expect(
        sorted(["ADR-20260716-02", "ADR-20260312-01", "ADR-20260716-01", "ADR-20251231-09"]),
      ).toEqual(["ADR-20251231-09", "ADR-20260312-01", "ADR-20260716-01", "ADR-20260716-02"]);
    });

    it("agrees with localeCompare on fixed-width ids, so existing repos are unaffected", () => {
      const corpus = [
        "ADR-20260312-01",
        "ADR-20260312-02",
        "ADR-20260404-08",
        "ADR-20260716-01",
        "ADR-20260716-10",
        "ADR-20261101-03",
      ];
      expect(sorted(corpus)).toEqual([...corpus].sort((a, b) => a.localeCompare(b)));
    });

    it("orders sequence numbers past the 09/10 boundary", () => {
      expect(sorted(["ADR-20260716-10", "ADR-20260716-09", "ADR-20260716-02"])).toEqual([
        "ADR-20260716-02",
        "ADR-20260716-09",
        "ADR-20260716-10",
      ]);
    });
  });

  describe("filenames", () => {
    it("sorts issue-number filenames numerically", () => {
      expect(sorted(["1000-alpha.md", "99-beta.md", "525-gamma.md"])).toEqual([
        "99-beta.md",
        "525-gamma.md",
        "1000-alpha.md",
      ]);
    });

    it("falls back to slug order when the number is equal", () => {
      expect(sorted(["525-zulu.md", "525-alpha.md"])).toEqual(["525-alpha.md", "525-zulu.md"]);
    });
  });

  describe("edge cases", () => {
    it("produces a total order (no cycles) over a mixed corpus", () => {
      const corpus = ["ADR-99", "ADR-20260312-01", "ADR-1000", "ADR-9001", "ADR-7"];
      const once = sorted(corpus);
      // Sorting an already-sorted list, and a reversed one, must agree.
      expect(sorted(once)).toEqual(once);
      expect(sorted([...corpus].reverse())).toEqual(once);
    });

    it("distinguishes zero-padded from bare ids deterministically", () => {
      expect(compareAdrIds("ADR-007", "ADR-7")).not.toBe(0);
      expect(sorted(["ADR-7", "ADR-007"])).toEqual(sorted(["ADR-007", "ADR-7"]));
    });

    it("handles ids with no digits", () => {
      expect(sorted(["ADR-beta", "ADR-alpha"])).toEqual(["ADR-alpha", "ADR-beta"]);
    });
  });
});
