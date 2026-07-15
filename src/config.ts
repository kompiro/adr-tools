import { readFileSync } from "node:fs";
import { join } from "node:path";

export type IdFormat = "date-sequence" | "issue-number";

export const ID_FORMATS = ["date-sequence", "issue-number"] as const satisfies readonly IdFormat[];

export const DEFAULT_ID_FORMAT: IdFormat = "date-sequence";

export type PermalinkKind = "krs";

export const PERMALINK_KINDS = ["krs"] as const satisfies readonly PermalinkKind[];

export interface AdrConfig {
  idFormat: IdFormat;
  topics: readonly string[];
  concerns: readonly string[];
  paths: {
    adrDir: string;
    outputs: {
      effective: string;
      graph: string;
      graphByTopic: string;
    };
  };
  /**
   * Opt-in support for `permalink:` frontmatter that links an ADR to a
   * rendered structure. `kind` selects the resolver for a deep `#fragment`
   * anchor a `source` may carry (`"krs"` resolves karasu `#krs-<view>-<id>`
   * anchors via the optional `@karasu-tools/core` peer dependency).
   */
  permalink?: {
    kind: PermalinkKind;
    /**
     * Hosts that serve repo-backed permalinks (karasu-nest resolver URLs of the
     * form `…/<owner>/<repo>[/<path>][@<ref>]`). A `short` whose URL host matches
     * one of these is checked for `@<sha>` pinning: a non-pinned form (ref-less,
     * branch, tag, or abbreviated SHA) is reported as a non-fatal `warn`
     * recommending a full 40-hex commit SHA. Keying on host — not URL path shape
     * — keeps the check independent of the resolver's route form. Absent or empty
     * disables the check (no behavior change for existing adopters).
     */
    repoBackedHosts?: string[];
  };
}

export class AdrConfigMissingError extends Error {
  constructor(path: string) {
    super(
      `adr.config.json not found at ${path}. Run \`pnpm adr:init\` to generate a starter config.`,
    );
    this.name = "AdrConfigMissingError";
  }
}

export class AdrConfigInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdrConfigInvalidError";
  }
}

export const CONFIG_FILENAME = "adr.config.json";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function requireString(obj: Record<string, unknown>, field: string, ctx: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new AdrConfigInvalidError(`${ctx}: "${field}" must be a non-empty string`);
  }
  return v;
}

function parseConfig(raw: unknown, ctx: string): AdrConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AdrConfigInvalidError(`${ctx}: top-level must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;

  let idFormat: IdFormat = DEFAULT_ID_FORMAT;
  if (obj.idFormat !== undefined) {
    if (
      typeof obj.idFormat !== "string" ||
      !(ID_FORMATS as readonly string[]).includes(obj.idFormat)
    ) {
      throw new AdrConfigInvalidError(
        `${ctx}: "idFormat" must be one of ${ID_FORMATS.join(" | ")}, got ${JSON.stringify(obj.idFormat)}`,
      );
    }
    idFormat = obj.idFormat as IdFormat;
  }

  const topicsRaw = obj.topics;
  if (!isStringArray(topicsRaw)) {
    throw new AdrConfigInvalidError(`${ctx}: "topics" must be an array of strings`);
  }
  const concernsRaw = obj.concerns;
  if (!isStringArray(concernsRaw)) {
    throw new AdrConfigInvalidError(`${ctx}: "concerns" must be an array of strings`);
  }

  const pathsRaw = obj.paths;
  if (!pathsRaw || typeof pathsRaw !== "object" || Array.isArray(pathsRaw)) {
    throw new AdrConfigInvalidError(`${ctx}: "paths" must be an object`);
  }
  const paths = pathsRaw as Record<string, unknown>;
  const adrDir = requireString(paths, "adrDir", `${ctx}: paths.adrDir`);

  const outputsRaw = paths.outputs;
  if (!outputsRaw || typeof outputsRaw !== "object" || Array.isArray(outputsRaw)) {
    throw new AdrConfigInvalidError(`${ctx}: "paths.outputs" must be an object`);
  }
  const outputs = outputsRaw as Record<string, unknown>;
  const effective = requireString(outputs, "effective", `${ctx}: paths.outputs.effective`);
  const graph = requireString(outputs, "graph", `${ctx}: paths.outputs.graph`);
  const graphByTopic = requireString(outputs, "graphByTopic", `${ctx}: paths.outputs.graphByTopic`);

  let permalink: AdrConfig["permalink"];
  if (obj.permalink !== undefined && obj.permalink !== null) {
    if (typeof obj.permalink !== "object" || Array.isArray(obj.permalink)) {
      throw new AdrConfigInvalidError(`${ctx}: "permalink" must be an object`);
    }
    const p = obj.permalink as Record<string, unknown>;
    if (typeof p.kind !== "string" || !(PERMALINK_KINDS as readonly string[]).includes(p.kind)) {
      throw new AdrConfigInvalidError(
        `${ctx}: "permalink.kind" must be one of ${PERMALINK_KINDS.join(" | ")}, got ${JSON.stringify(p.kind)}`,
      );
    }
    let repoBackedHosts: string[] | undefined;
    if (p.repoBackedHosts !== undefined) {
      if (
        !Array.isArray(p.repoBackedHosts) ||
        p.repoBackedHosts.some((h) => typeof h !== "string")
      ) {
        throw new AdrConfigInvalidError(
          `${ctx}: "permalink.repoBackedHosts" must be an array of strings`,
        );
      }
      repoBackedHosts = p.repoBackedHosts as string[];
    }
    permalink = {
      kind: p.kind as PermalinkKind,
      ...(repoBackedHosts ? { repoBackedHosts } : {}),
    };
  }

  return {
    idFormat,
    topics: topicsRaw,
    concerns: concernsRaw,
    paths: { adrDir, outputs: { effective, graph, graphByTopic } },
    permalink,
  };
}

export function loadConfig(cwd: string = process.cwd()): AdrConfig {
  const path = join(cwd, CONFIG_FILENAME);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new AdrConfigMissingError(path);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new AdrConfigInvalidError(`${path}: invalid JSON: ${(e as Error).message}`);
  }
  return parseConfig(parsed, path);
}
