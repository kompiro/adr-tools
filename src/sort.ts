/**
 * Ordering helpers for ADR ids.
 *
 * Generated outputs (effective.md, graph.md, graph/*.md) list ADRs in id order.
 * A plain `localeCompare` is only correct while ids are fixed-width: the
 * `date-sequence` format (`ADR-20260716-01`) pads every segment, so string
 * order and numeric order agree. The `issue-number` format (`ADR-<n>`, no zero
 * padding) breaks that assumption — string order yields
 * `ADR-1000` < `ADR-99` < `ADR-999`, scrambling every index.
 *
 * `compareAdrIds` splits an id into digit and non-digit runs and compares digit
 * runs numerically. For `date-sequence` ids this produces exactly the same
 * order as `localeCompare` (equal-width numeric segments compare identically),
 * so existing repos see no change.
 */

const SEGMENT_RE = /\d+|\D+/g;

const isDigitRun = (s: string): boolean => s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57;

/**
 * Natural-order comparison of two ADR ids.
 *
 * Digit runs compare as numbers, non-digit runs as strings, left to right.
 * When one id is a prefix of the other the shorter sorts first.
 */
export function compareAdrIds(a: string, b: string): number {
  if (a === b) return 0;

  const as = a.match(SEGMENT_RE) ?? [];
  const bs = b.match(SEGMENT_RE) ?? [];
  const shared = Math.min(as.length, bs.length);

  for (let i = 0; i < shared; i++) {
    const x = as[i]!;
    const y = bs[i]!;
    const xNum = isDigitRun(x);
    const yNum = isDigitRun(y);

    if (xNum && yNum) {
      // Compare as numbers. ADR segments are far below Number.MAX_SAFE_INTEGER
      // (8-digit dates, issue numbers), so this is exact.
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      // Equal value but different width ("01" vs "1"): fall through so a
      // later segment decides, and disambiguate by width only at the end.
      continue;
    }

    // A digit run sorts before a non-digit run at the same position.
    if (xNum !== yNum) return xNum ? -1 : 1;

    const diff = x.localeCompare(y);
    if (diff !== 0) return diff;
  }

  if (as.length !== bs.length) return as.length - bs.length;

  // Same segments, same values — differ only in zero padding. Keep it
  // deterministic rather than declaring them equal.
  return a.localeCompare(b);
}
