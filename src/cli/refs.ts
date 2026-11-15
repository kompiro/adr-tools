/* eslint-disable no-console -- CLI entry point; stdout/stderr reporting is the whole job */
import { AdrConfigInvalidError, AdrConfigMissingError, loadConfig } from "../config.ts";
import { loadParsed } from "../extractor.ts";
import { adrRefs, formatRefsJson, formatRefsText, type AdrRefs } from "../finder.ts";

const USAGE = `usage: adr refs <id> [<id> ...] [options]

Show, for each ADR, whether it is still in force and what points at it:

  - status, date, title, file, and its own relationship fields
  - the superseded_by chain followed to its end
  - referenced by: every ADR whose relationship fields (supersedes,
    superseded_by, depends_on, related_to, conflicts_with, refines) point at it
  - mentioned only in body: ADRs that name it in the body but in no
    relationship field

Referrers are listed newest first; "← NEWER" marks one later than the ADR
(by date, then by id on the same date).

Options:
  --format=<text|json>       default: text
  --dir=<path>               default: paths.adrDir from adr.config.json

Exit status: 0 when every id was found, 1 when any was not, 2 on bad usage.`;

interface Args {
  ids: string[];
  format: "text" | "json";
  dir: string | null;
}

export function parseRefsArgs(args: string[]): Args | { error: string } | { help: true } {
  const out: Args = { ids: [], format: "text", dir: null };
  for (const raw of args) {
    if (raw === "--help" || raw === "-h") {
      return { help: true };
    } else if (raw.startsWith("--format=")) {
      const v = raw.slice("--format=".length);
      if (v !== "text" && v !== "json") {
        return { error: `invalid --format (got ${v}); expected one of text, json` };
      }
      out.format = v;
    } else if (raw.startsWith("--dir=")) {
      out.dir = raw.slice("--dir=".length);
    } else if (raw.startsWith("-")) {
      return { error: `unknown option: ${raw}` };
    } else if (!out.ids.includes(raw)) {
      out.ids.push(raw);
    }
  }
  if (out.ids.length === 0) return { error: "refs requires at least one ADR id" };
  return out;
}

export function main(argv: string[]): number {
  const args = parseRefsArgs(argv.slice(2));
  if ("help" in args) {
    console.log(USAGE);
    return 0;
  }
  if ("error" in args) {
    console.error(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof AdrConfigMissingError || e instanceof AdrConfigInvalidError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  const adrs = loadParsed(args.dir ?? config.paths.adrDir, config);
  const results: AdrRefs[] = [];
  let missing = 0;
  for (const id of args.ids) {
    try {
      results.push(adrRefs(adrs, id, config.idFormat));
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      missing++;
    }
  }
  process.stdout.write(args.format === "json" ? formatRefsJson(results) : formatRefsText(results));
  return missing > 0 ? 1 : 0;
}
