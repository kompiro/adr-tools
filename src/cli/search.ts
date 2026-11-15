/* eslint-disable no-console -- CLI entry point; stdout/stderr reporting is the whole job */
import { formatSearchJson, formatSearchText, normalizeTerms, searchAdrs } from "../finder.ts";
import { loadForLookup } from "./lookup.ts";

const DEFAULT_LIMIT = 20;

const USAGE = `usage: adr search <term> [<term> ...] [options]

Find ADRs by words in their title, filename or body. Each term is a
case-insensitive substring; terms that differ only in case count once.

Ranked by: distinct terms matched, then terms hitting the title or filename,
then matching body lines; ties go to the newer ADR.

One line per ADR:
  <rank>  <id>  <status>[→<successor>...]  <date>  <title>  [<term>[*](<lines>) ...]
  * marks a hit in the title or filename; <lines> counts matching body lines.

Options:
  -n <N>, --limit=<N>        show at most N ADRs (default: ${DEFAULT_LIMIT})
  --format=<text|json>       default: text
  --dir=<path>               default: paths.adrDir from adr.config.json
  --                         treat every later argument as a term

Exit status: 0 when something matched, 1 when nothing did, 2 on bad usage.`;

interface Args {
  terms: string[];
  limit: number;
  format: "text" | "json";
  dir: string | null;
}

function parseLimit(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

export function parseSearchArgs(args: string[]): Args | { error: string } | { help: true } {
  const out: Args = { terms: [], limit: DEFAULT_LIMIT, format: "text", dir: null };
  let onlyTerms = false;
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    if (onlyTerms) {
      out.terms.push(raw);
    } else if (raw === "--") {
      onlyTerms = true;
    } else if (raw === "--help" || raw === "-h") {
      return { help: true };
    } else if (raw === "-n" || raw.startsWith("--limit=") || raw.startsWith("-n=")) {
      const v = raw === "-n" ? args[++i] : raw.slice(raw.indexOf("=") + 1);
      if (v === undefined) return { error: "-n requires a value" };
      const n = parseLimit(v);
      if (n === null)
        return { error: `invalid -n / --limit (got ${v}); expected a positive integer` };
      out.limit = n;
    } else if (raw.startsWith("--format=")) {
      const v = raw.slice("--format=".length);
      if (v !== "text" && v !== "json") {
        return { error: `invalid --format (got ${v}); expected one of text, json` };
      }
      out.format = v;
    } else if (raw.startsWith("--dir=")) {
      out.dir = raw.slice("--dir=".length);
      if (out.dir === "") return { error: "--dir requires a path" };
    } else if (raw.startsWith("-") && raw.length > 1) {
      return { error: `unknown option: ${raw} (use -- before a term that starts with "-")` };
    } else {
      out.terms.push(raw);
    }
  }
  if (normalizeTerms(out.terms).length === 0) {
    return { error: "search requires at least one non-empty term" };
  }
  return out;
}

export function main(argv: string[]): number {
  const args = parseSearchArgs(argv.slice(2));
  if ("help" in args) {
    console.log(USAGE);
    return 0;
  }
  if ("error" in args) {
    console.error(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  const loaded = loadForLookup(args.dir);
  if ("exit" in loaded) return loaded.exit;
  const adrs = loaded.adrs;
  const hits = searchAdrs(adrs, args.terms, { limit: args.limit });
  process.stdout.write(args.format === "json" ? formatSearchJson(hits) : formatSearchText(hits));
  if (hits.length === 0) {
    console.error(`no ADR matched: ${normalizeTerms(args.terms).join(", ")}`);
    return 1;
  }
  return 0;
}
