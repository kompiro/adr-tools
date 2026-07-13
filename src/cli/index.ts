#!/usr/bin/env node
/* eslint-disable no-console -- CLI entry point */
import { main as runCheckAssumptions } from "./check-assumptions.ts";
import { main as runCheckPermalinks } from "./check-permalinks.ts";
import { main as runExtract } from "./extract.ts";
import { runInitCli } from "./init.ts";
import { main as runRegenerate } from "./regenerate.ts";
import { main as runValidate } from "./validate.ts";
import { main as runVisualize } from "./visualize.ts";

const HELP = `usage: adr <subcommand> [options]

Subcommands:
  init                  generate a starter adr.config.json in CWD
  validate              schema and cross-reference validation of ADRs
  regenerate            rewrite effective.md, graph.md, and graph/<topic>.md
  extract               query the ADR set (effective, slice, closure)
  visualize             render Markdown / Mermaid views of the ADR set
  check-assumptions     verify file: / symbol: / grep: assumptions in ADRs
  check-permalinks      verify permalink: sources exist and deep anchors resolve

Run \`adr <subcommand> --help\` for subcommand-specific options.`;

function main(): number | Promise<number> {
  const sub = process.argv[2];
  // Reconstruct argv as if the subcommand binary was invoked directly:
  // [node, "adr <sub>", ...args]. Existing handlers do argv.slice(2).
  const subArgv = [process.argv[0] ?? "node", `adr ${sub}`, ...process.argv.slice(3)];
  switch (sub) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      console.log(HELP);
      return sub === undefined ? 1 : 0;
    case "init":
      return runInitCli(process.argv.slice(3));
    case "validate":
      return runValidate(subArgv);
    case "regenerate":
      return runRegenerate(subArgv);
    case "extract":
      return runExtract(subArgv);
    case "visualize":
      return runVisualize(subArgv);
    case "check-assumptions":
      return runCheckAssumptions(subArgv);
    case "check-permalinks":
      return runCheckPermalinks(subArgv);
    default:
      console.error(`unknown subcommand: ${sub}\n\n${HELP}`);
      return 2;
  }
}

Promise.resolve(main()).then((code) => process.exit(code));
