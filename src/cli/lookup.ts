/* eslint-disable no-console -- CLI helper; reports config errors and skipped ADRs on stderr */
import { existsSync } from "node:fs";
import {
  AdrConfigInvalidError,
  AdrConfigMissingError,
  loadConfig,
  type AdrConfig,
} from "../config.ts";
import { validateDirectory, type ParsedAdr } from "../validator.ts";

/**
 * Shared loading for `search` and `refs`: read the config, parse `dir` (or
 * `paths.adrDir`), and say on stderr when validation errors may have left ADRs
 * out — otherwise `refs` reports an ADR with a bad frontmatter as "not found"
 * and `search` silently skips it. Returns an exit code when it cannot proceed.
 */
export function loadForLookup(
  dir: string | null,
): { adrs: ParsedAdr[]; config: AdrConfig } | { exit: number } {
  let config: AdrConfig;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof AdrConfigMissingError || e instanceof AdrConfigInvalidError) {
      console.error(e.message);
      return { exit: 1 };
    }
    throw e;
  }
  const target = dir ?? config.paths.adrDir;
  if (!existsSync(target)) {
    console.error(`ADR directory not found: ${target}`);
    return { exit: 1 };
  }
  const { errors, parsed } = validateDirectory(target, config);
  if (errors.length > 0) {
    console.error(
      `note: \`adr validate\` reports ${errors.length} error(s) in ${target}; an ADR whose frontmatter does not parse is left out`,
    );
  }
  return { adrs: parsed, config };
}
