#!/usr/bin/env node

// src/assumptions.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
var FILE_RE = /^file:\s*(.+)$/;
var SYMBOL_RE = /^symbol:\s*(.+?)\s*::\s*(.+)$/;
var GREP_RE = /^grep:\s*(.+?)\s*::\s*(.+)$/;
var IDENT_RE = /^[A-Za-z_$][\w$]*$/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function evaluateAssumption(adr, assumption, repoRoot) {
  const base = { adrId: adr.id, file: adr.file, assumption };
  const fileMatch = assumption.match(FILE_RE);
  if (fileMatch) {
    const relativePath = fileMatch[1].trim();
    const fullPath = join(repoRoot, relativePath);
    if (existsSync(fullPath)) return { ...base, status: "ok" };
    return { ...base, status: "fail", message: `missing: ${relativePath}` };
  }
  const symbolMatch = assumption.match(SYMBOL_RE);
  if (symbolMatch) {
    const relativePath = symbolMatch[1].trim();
    const name = symbolMatch[2].trim();
    if (!IDENT_RE.test(name)) {
      return {
        ...base,
        status: "fail",
        message: `"${name}" is not a valid identifier; use \`grep:\` for free-form patterns`
      };
    }
    const fileResult = readFileForCheck(base, repoRoot, relativePath);
    if ("error" in fileResult) return fileResult.error;
    const ident = "[A-Za-z0-9_$]";
    const re = new RegExp(`(?<!${ident})${escapeRegExp(name)}(?!${ident})`);
    if (re.test(fileResult.content)) return { ...base, status: "ok" };
    return {
      ...base,
      status: "fail",
      message: `identifier "${name}" not found in ${relativePath}`
    };
  }
  const grepMatch = assumption.match(GREP_RE);
  if (grepMatch) {
    const relativePath = grepMatch[1].trim();
    const pattern = grepMatch[2].trim();
    const fileResult = readFileForCheck(base, repoRoot, relativePath);
    if ("error" in fileResult) return fileResult.error;
    let re;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      return { ...base, status: "fail", message: `bad regex: ${e.message}` };
    }
    if (re.test(fileResult.content)) return { ...base, status: "ok" };
    return { ...base, status: "fail", message: `pattern not found in ${relativePath}` };
  }
  return { ...base, status: "manual" };
}
function readFileForCheck(base, repoRoot, relativePath) {
  const fullPath = join(repoRoot, relativePath);
  if (!existsSync(fullPath)) {
    return {
      error: { ...base, status: "fail", message: `missing file: ${relativePath}` }
    };
  }
  try {
    return { content: readFileSync(fullPath, "utf8") };
  } catch (e) {
    return {
      error: { ...base, status: "fail", message: `read error: ${e.message}` }
    };
  }
}
function evaluateAll(adrs, repoRoot) {
  const results = [];
  for (const adr of adrs) {
    for (const a of adr.fm.assumptions ?? []) {
      results.push(evaluateAssumption(adr, a, repoRoot));
    }
  }
  return results;
}

// src/config.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
var AdrConfigMissingError = class extends Error {
  constructor(path) {
    super(
      `adr.config.json not found at ${path}. Run \`pnpm adr:init\` to generate a starter config.`
    );
    this.name = "AdrConfigMissingError";
  }
};
var AdrConfigInvalidError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AdrConfigInvalidError";
  }
};
var CONFIG_FILENAME = "adr.config.json";
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function requireString(obj, field, ctx) {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new AdrConfigInvalidError(`${ctx}: "${field}" must be a non-empty string`);
  }
  return v;
}
function parseConfig(raw, ctx) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AdrConfigInvalidError(`${ctx}: top-level must be a JSON object`);
  }
  const obj = raw;
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
  const paths = pathsRaw;
  const adrDir = requireString(paths, "adrDir", `${ctx}: paths.adrDir`);
  const outputsRaw = paths.outputs;
  if (!outputsRaw || typeof outputsRaw !== "object" || Array.isArray(outputsRaw)) {
    throw new AdrConfigInvalidError(`${ctx}: "paths.outputs" must be an object`);
  }
  const outputs = outputsRaw;
  const effective = requireString(outputs, "effective", `${ctx}: paths.outputs.effective`);
  const graph = requireString(outputs, "graph", `${ctx}: paths.outputs.graph`);
  const graphByTopic = requireString(outputs, "graphByTopic", `${ctx}: paths.outputs.graphByTopic`);
  return {
    topics: topicsRaw,
    concerns: concernsRaw,
    paths: { adrDir, outputs: { effective, graph, graphByTopic } }
  };
}
function loadConfig(cwd = process.cwd()) {
  const path = join2(cwd, CONFIG_FILENAME);
  let text;
  try {
    text = readFileSync2(path, "utf8");
  } catch {
    throw new AdrConfigMissingError(path);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new AdrConfigInvalidError(`${path}: invalid JSON: ${e.message}`);
  }
  return parseConfig(parsed, path);
}

// src/validator.ts
import { readdirSync, readFileSync as readFileSync3 } from "fs";
import { basename, join as join3 } from "path";
import { load as parseYaml } from "js-yaml";
var VALID_STATUSES = ["proposed", "accepted", "deprecated", "superseded", "not_adopted"];
var RELATIONSHIP_FIELDS = [
  "supersedes",
  "depends_on",
  "related_to",
  "conflicts_with",
  "refines"
];
var FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
var ID_FROM_FILENAME_RE = /^(\d{8})-(\d{2})-/;
function extractFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { raw: null, body: content };
  return { raw: match[1], body: content.slice(match[0].length) };
}
function idFromFilename(file) {
  const name = basename(file);
  const m = name.match(ID_FROM_FILENAME_RE);
  if (!m) return null;
  return `ADR-${m[1]}-${m[2]}`;
}
function parseFrontmatter(raw, file, errors, topics, concerns) {
  let data;
  try {
    data = parseYaml(raw);
  } catch (e) {
    errors.push(`${file}: YAML parse error: ${e.message}`);
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push(`${file}: frontmatter must be a YAML mapping`);
    return null;
  }
  const fm = data;
  const requireString2 = (field) => {
    const v = fm[field];
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`${file}: "${field}" is required and must be a non-empty string`);
      return null;
    }
    return v;
  };
  const id = requireString2("id");
  const title = requireString2("title");
  const date = fm.date;
  let dateStr = null;
  if (date instanceof Date) {
    dateStr = date.toISOString().slice(0, 10);
  } else if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    dateStr = date;
  } else {
    errors.push(`${file}: "date" is required and must be ISO 8601 (YYYY-MM-DD)`);
  }
  const statusRaw = fm.status;
  if (typeof statusRaw !== "string" || !VALID_STATUSES.includes(statusRaw)) {
    errors.push(
      `${file}: "status" must be one of ${VALID_STATUSES.join(" | ")}, got ${JSON.stringify(statusRaw)}`
    );
  }
  const topicRaw = fm.topic;
  if (typeof topicRaw !== "string") {
    errors.push(`${file}: "topic" is required and must be a string`);
  } else if (topics.length > 0 && !topics.includes(topicRaw)) {
    errors.push(
      `${file}: "topic" must be one of ${topics.join(" | ")}, got ${JSON.stringify(topicRaw)}`
    );
  }
  if (!id || !title || !dateStr || typeof statusRaw !== "string" || typeof topicRaw !== "string")
    return null;
  const stringArray = (field) => {
    const v = fm[field];
    if (v === void 0 || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      errors.push(`${file}: "${field}" must be an array of strings`);
      return [];
    }
    return v;
  };
  const superseded_by = fm.superseded_by;
  if (superseded_by !== void 0 && superseded_by !== null && typeof superseded_by !== "string") {
    errors.push(`${file}: "superseded_by" must be a string or null`);
  }
  let scope;
  if (fm.scope !== void 0 && fm.scope !== null) {
    if (typeof fm.scope !== "object" || Array.isArray(fm.scope)) {
      errors.push(`${file}: "scope" must be a mapping`);
    } else {
      const s = fm.scope;
      if ("domains" in s) {
        errors.push(
          `${file}: "scope.domains" was renamed to "scope.concerns" with a controlled vocabulary; see docs/adr/TEMPLATE.md`
        );
      }
      const pkgs = s.packages;
      const concernsRaw = s.concerns;
      const pkgsOk = pkgs === void 0 || Array.isArray(pkgs) && pkgs.every((x) => typeof x === "string");
      const concernsOk = concernsRaw === void 0 || Array.isArray(concernsRaw) && concernsRaw.every((x) => typeof x === "string");
      if (!pkgsOk) errors.push(`${file}: "scope.packages" must be an array of strings`);
      if (!concernsOk) errors.push(`${file}: "scope.concerns" must be an array of strings`);
      let concernsParsed;
      if (concernsOk && Array.isArray(concernsRaw)) {
        concernsParsed = [];
        for (const v of concernsRaw) {
          if (concerns.length === 0 || concerns.includes(v)) {
            concernsParsed.push(v);
          } else {
            errors.push(
              `${file}: "scope.concerns" contains unknown value ${JSON.stringify(v)}; allowed: ${concerns.join(" | ")}`
            );
          }
        }
      }
      scope = {
        packages: pkgsOk && Array.isArray(pkgs) ? pkgs : void 0,
        concerns: concernsParsed
      };
    }
  }
  return {
    id,
    title,
    status: statusRaw,
    date: dateStr,
    topic: topicRaw,
    authors: stringArray("authors"),
    supersedes: stringArray("supersedes"),
    superseded_by: typeof superseded_by === "string" ? superseded_by : null,
    depends_on: stringArray("depends_on"),
    related_to: stringArray("related_to"),
    conflicts_with: stringArray("conflicts_with"),
    refines: stringArray("refines"),
    scope,
    assumptions: stringArray("assumptions")
  };
}
function extractBodyHeading(body) {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1] : null;
}
function titleFromHeading(heading, id) {
  const prefix = `${id}:`;
  return heading.startsWith(prefix) ? heading.slice(prefix.length).trim() : heading.trim();
}
function validateFile(filePath, content, errors, warnings, topics, concerns) {
  const { raw, body } = extractFrontmatter(content);
  if (raw === null) {
    errors.push(`${filePath}: missing YAML frontmatter (see docs/adr/TEMPLATE.md)`);
    return null;
  }
  const fm = parseFrontmatter(raw, filePath, errors, topics, concerns);
  if (!fm) return null;
  const expectedId = idFromFilename(filePath);
  if (expectedId && fm.id !== expectedId) {
    errors.push(`${filePath}: "id" (${fm.id}) does not match filename-derived id (${expectedId})`);
  }
  if (fm.status === "superseded") {
    if (!fm.superseded_by) {
      errors.push(`${filePath}: status=superseded requires "superseded_by"`);
    }
  } else if (fm.superseded_by) {
    errors.push(
      `${filePath}: "superseded_by" is only allowed when status=superseded (got status=${fm.status})`
    );
  }
  const bodyHeading = extractBodyHeading(body);
  if (bodyHeading) {
    const bodyTitle = titleFromHeading(bodyHeading, fm.id);
    if (bodyTitle !== fm.title) {
      warnings.push(
        `${filePath}: frontmatter title "${fm.title}" does not match body H1 "${bodyTitle}"`
      );
    }
  } else {
    warnings.push(`${filePath}: body has no H1 heading`);
  }
  return { file: filePath, id: fm.id, fm, bodyHeading, body };
}
var ADR_ID_REF_RE = /ADR-\d{8}-\d{2}/g;
function declaredRelations(fm) {
  const out = /* @__PURE__ */ new Set();
  for (const field of RELATIONSHIP_FIELDS) {
    for (const id of fm[field] ?? []) out.add(id);
  }
  if (fm.superseded_by) out.add(fm.superseded_by);
  return out;
}
function crossValidate(parsed, errors, warnings) {
  const byId = /* @__PURE__ */ new Map();
  for (const p of parsed) {
    if (byId.has(p.id)) {
      errors.push(`Duplicate ADR id: ${p.id} (${byId.get(p.id).file} and ${p.file})`);
    }
    byId.set(p.id, p);
  }
  const relationFields = [
    "supersedes",
    "depends_on",
    "related_to",
    "conflicts_with",
    "refines"
  ];
  for (const p of parsed) {
    for (const field of relationFields) {
      const ids = p.fm[field] ?? [];
      for (const ref of ids) {
        if (!byId.has(ref)) {
          warnings.push(
            `${p.file}: ${field} references "${ref}" which is not migrated yet or does not exist`
          );
        }
      }
    }
    if (p.fm.superseded_by && !byId.has(p.fm.superseded_by)) {
      warnings.push(
        `${p.file}: superseded_by references "${p.fm.superseded_by}" which is not migrated yet or does not exist`
      );
    }
    if (p.fm.superseded_by) {
      const target = byId.get(p.fm.superseded_by);
      if (target && !(target.fm.supersedes ?? []).includes(p.id)) {
        errors.push(
          `${p.file}: superseded_by "${p.fm.superseded_by}" but that ADR does not list "${p.id}" in its supersedes`
        );
      }
    }
    for (const supersededId of p.fm.supersedes ?? []) {
      const target = byId.get(supersededId);
      if (!target) continue;
      if (target.fm.superseded_by !== p.id) {
        errors.push(
          `${p.file}: supersedes "${supersededId}" but that ADR's superseded_by is ${JSON.stringify(target.fm.superseded_by)} (expected "${p.id}")`
        );
      }
    }
    if (p.fm.status === "accepted") {
      for (const depId of p.fm.depends_on ?? []) {
        const dep = byId.get(depId);
        if (!dep) continue;
        if (dep.fm.status === "superseded" || dep.fm.status === "deprecated" || dep.fm.status === "not_adopted") {
          errors.push(
            `${p.file}: status=accepted depends_on "${depId}" which has status=${dep.fm.status}`
          );
        }
      }
    }
  }
  for (const p of parsed) {
    const declared = declaredRelations(p.fm);
    const mentioned = /* @__PURE__ */ new Set();
    for (const ref of p.body.match(ADR_ID_REF_RE) ?? []) {
      if (ref === p.id) continue;
      if (!byId.has(ref)) continue;
      mentioned.add(ref);
    }
    for (const ref of mentioned) {
      if (!declared.has(ref)) {
        warnings.push(
          `${p.file}: body mentions "${ref}" but it is not listed in any relationship field (depends_on / related_to / supersedes / refines / conflicts_with / superseded_by)`
        );
      }
    }
    for (const dep of p.fm.depends_on ?? []) {
      if (!byId.has(dep)) continue;
      if (!mentioned.has(dep)) {
        warnings.push(`${p.file}: depends_on "${dep}" is declared but never mentioned in the body`);
      }
    }
  }
  detectCycle(
    parsed,
    (p) => (p.fm.depends_on ?? []).filter((id) => byId.has(id)),
    "depends_on",
    byId,
    errors
  );
  detectCycle(
    parsed,
    (p) => (p.fm.refines ?? []).filter((id) => byId.has(id)),
    "refines",
    byId,
    errors
  );
}
function detectCycle(parsed, edges, label, byId, errors) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (id) => {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const next of edges(node)) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          const cycleStart = stack.indexOf(next);
          const cycle = [...stack.slice(cycleStart), next].join(" -> ");
          errors.push(`${label} cycle detected: ${cycle}`);
          return true;
        }
        if (c === WHITE && visit(next)) return true;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return false;
  };
  for (const p of parsed) {
    if ((color.get(p.id) ?? WHITE) === WHITE) {
      if (visit(p.id)) return;
    }
  }
}
function validateDirectory(dir, config) {
  const errors = [];
  const warnings = [];
  const parsed = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).filter(
    (f) => f !== "README.md" && f !== "TEMPLATE.md" && f !== "graph.md" && f !== "effective.md"
  ).sort();
  for (const f of files) {
    const full = join3(dir, f);
    const content = readFileSync3(full, "utf8");
    const result = validateFile(full, content, errors, warnings, config.topics, config.concerns);
    if (result) parsed.push(result);
  }
  crossValidate(parsed, errors, warnings);
  return { errors, warnings, parsed };
}

// src/extractor.ts
function effectiveSet(parsed) {
  return parsed.filter((p) => p.fm.status === "accepted" && !p.fm.superseded_by);
}
function scopeSlice(parsed, filter) {
  const packages = filter.packages ?? [];
  const concerns = filter.concerns ?? [];
  const topics = filter.topics ?? [];
  if (packages.length === 0 && concerns.length === 0 && topics.length === 0) {
    throw new Error("slice requires at least one --package, --concern, or --topic filter");
  }
  const directlyMatched = parsed.filter((p) => {
    const topicOk = topics.length === 0 || topics.includes(p.fm.topic);
    const scope = p.fm.scope;
    const pkgOk = packages.length === 0 || scope !== void 0 && (scope.packages ?? []).some((pk) => packages.includes(pk));
    const concernOk = concerns.length === 0 || scope !== void 0 && (scope.concerns ?? []).some((c) => concerns.includes(c));
    return topicOk && pkgOk && concernOk;
  });
  return expandClosure(
    parsed,
    directlyMatched.map((p) => p.id)
  );
}
function closure(parsed, startId) {
  const byId = new Map(parsed.map((p) => [p.id, p]));
  if (!byId.has(startId)) {
    throw new Error(`ADR id "${startId}" not found`);
  }
  return expandClosure(parsed, [startId]);
}
function expandClosure(parsed, seeds) {
  const byId = new Map(parsed.map((p) => [p.id, p]));
  const visited = /* @__PURE__ */ new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === void 0 || visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const dep of node.fm.depends_on ?? []) queue.push(dep);
  }
  return parsed.filter((p) => visited.has(p.id));
}
function loadParsed(dir, config) {
  return validateDirectory(dir, config).parsed;
}
function format(adrs, fmt) {
  const sorted = [...adrs].sort((a, b) => a.id.localeCompare(b.id));
  if (fmt === "json") {
    return JSON.stringify(
      sorted.map((p) => ({
        id: p.id,
        title: p.fm.title,
        status: p.fm.status,
        date: p.fm.date,
        file: p.file,
        scope: p.fm.scope ?? null,
        depends_on: p.fm.depends_on ?? [],
        superseded_by: p.fm.superseded_by ?? null
      })),
      null,
      2
    ) + "\n";
  }
  if (fmt === "markdown") {
    const lines = sorted.map((p) => `- [${p.id}](${p.file.split("/").pop()}) \u2014 ${p.fm.title}`);
    return lines.join("\n") + "\n";
  }
  return sorted.map((p) => `${p.id}	${p.fm.status}	${p.fm.title}`).join("\n") + "\n";
}

// src/cli/check-assumptions.ts
function parseArgs(argv, defaultDir) {
  const args = argv.slice(2);
  let dir = defaultDir;
  let repoRoot = ".";
  let quiet = false;
  for (const raw of args) {
    if (raw === "--quiet") {
      quiet = true;
    } else if (raw.startsWith("--dir=")) {
      dir = raw.slice("--dir=".length);
    } else if (raw.startsWith("--repo-root=")) {
      repoRoot = raw.slice("--repo-root=".length);
    } else if (raw === "--help" || raw === "-h") {
      return {
        error: `usage: check-assumptions.ts [options]
  --dir=<path>         ADR directory (default: docs/adr)
  --repo-root=<path>   repository root that assumption paths are resolved against (default: .)
  --quiet              suppress OK and MANUAL lines; only show failures`
      };
    } else {
      return { error: `unknown option: ${raw}` };
    }
  }
  return { dir, repoRoot, quiet };
}
function main(argv) {
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
  const parsed = parseArgs(argv, config.paths.adrDir);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const adrs = loadParsed(parsed.dir, config);
  const results = evaluateAll(adrs, parsed.repoRoot);
  const byStatus = { ok: 0, fail: 0, manual: 0 };
  for (const r of results) {
    byStatus[r.status]++;
    if (parsed.quiet && r.status !== "fail") continue;
    const sym = r.status === "ok" ? "\u2713" : r.status === "fail" ? "\u2717" : "?";
    const msg = r.message ? ` \u2014 ${r.message}` : "";
    const line = `  ${sym} ${r.adrId} :: ${r.assumption}${msg}`;
    if (r.status === "fail") console.error(line);
    else console.log(line);
  }
  const total = results.length;
  console.log(
    `
Checked ${total} assumption(s): ${byStatus.ok} OK, ${byStatus.fail} failing, ${byStatus.manual} manual-review.`
  );
  return byStatus.fail > 0 ? 1 : 0;
}

// src/cli/extract.ts
var VALID_FORMATS = ["list", "markdown", "json"];
function parseArgs2(argv, config) {
  const args = argv.slice(2);
  const sub = args[0];
  if (sub !== "effective" && sub !== "slice" && sub !== "closure") {
    return {
      error: `usage: extract.ts <effective|slice|closure> [options]
  effective               \u2014 list ADRs with status=accepted and no superseded_by
  slice --package X --concern Y --topic Z \u2014 ADRs whose scope matches + transitive depends_on
  closure ADR-YYYYMMDD-NN \u2014 transitive depends_on closure of the given ADR

Options (all subcommands):
  --format=<list|markdown|json>   default: list
  --dir=<path>                    default: docs/adr
  --package=<name>                repeatable or comma-separated (slice only)
  --concern=<name>                repeatable or comma-separated (slice only)
  --topic=<slug>                  repeatable or comma-separated (slice only)`
    };
  }
  let fmt = "list";
  let dir = config.paths.adrDir;
  const packages = [];
  const concerns = [];
  const topics = [];
  let adrId = null;
  for (const raw of args.slice(1)) {
    if (raw.startsWith("--format=")) {
      const v = raw.slice("--format=".length);
      if (!VALID_FORMATS.includes(v)) {
        return {
          error: `invalid --format (got ${v}); expected one of ${VALID_FORMATS.join(", ")}`
        };
      }
      fmt = v;
    } else if (raw.startsWith("--dir=")) {
      dir = raw.slice("--dir=".length);
    } else if (raw.startsWith("--package=")) {
      packages.push(...raw.slice("--package=".length).split(",").filter(Boolean));
    } else if (raw.startsWith("--concern=")) {
      concerns.push(...raw.slice("--concern=".length).split(",").filter(Boolean));
    } else if (raw.startsWith("--topic=")) {
      const values = raw.slice("--topic=".length).split(",").filter(Boolean);
      for (const v of values) {
        if (config.topics.length > 0 && !config.topics.includes(v)) {
          return {
            error: `invalid --topic (got ${JSON.stringify(v)}); expected one of ${config.topics.join(", ")}`
          };
        }
        topics.push(v);
      }
    } else if (raw.startsWith("--")) {
      return { error: `unknown option: ${raw}` };
    } else if (sub === "closure" && adrId === null) {
      adrId = raw;
    } else {
      return { error: `unexpected positional argument: ${raw}` };
    }
  }
  if (sub === "closure" && adrId === null) {
    return { error: "closure requires an ADR id (e.g. ADR-20260422-05)" };
  }
  return { subcommand: sub, format: fmt, dir, packages, concerns, topics, adrId };
}
function main2(argv) {
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
  const parsed = parseArgs2(argv, config);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const adrs = loadParsed(parsed.dir, config);
  try {
    let result;
    if (parsed.subcommand === "effective") {
      result = effectiveSet(adrs);
    } else if (parsed.subcommand === "slice") {
      result = scopeSlice(adrs, {
        packages: parsed.packages,
        concerns: parsed.concerns,
        topics: parsed.topics
      });
    } else {
      result = closure(adrs, parsed.adrId);
    }
    process.stdout.write(format(result, parsed.format));
    return 0;
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 1;
  }
}

// src/init.ts
import { existsSync as existsSync2, readFileSync as readFileSync4, writeFileSync } from "fs";
import { dirname, join as join4 } from "path";
import { fileURLToPath } from "url";
var TEMPLATE_PATH = join4(dirname(fileURLToPath(import.meta.url)), "init.template.json");
function runInit(cwd = process.cwd()) {
  const target = join4(cwd, CONFIG_FILENAME);
  if (existsSync2(target)) {
    return {
      written: false,
      path: target,
      message: `${CONFIG_FILENAME} already exists at ${target}; refusing to overwrite.`
    };
  }
  const template = readFileSync4(TEMPLATE_PATH, "utf8");
  writeFileSync(target, template);
  return {
    written: true,
    path: target,
    message: `Generated ${CONFIG_FILENAME} at ${target}. Edit "topics" and "concerns" for your project.`
  };
}

// src/cli/init.ts
function runInitCli(argv) {
  const cwd = argv[0] ?? process.cwd();
  const result = runInit(cwd);
  if (!result.written) {
    console.error(result.message);
    return 1;
  }
  console.log(result.message);
  return 0;
}

// src/cli/regenerate.ts
import { mkdirSync, readFileSync as readFileSync5, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname2, join as join5 } from "path";

// src/regenerator.ts
import { basename as basename2 } from "path";

// src/visualizer.ts
var STATUS_STYLE = {
  accepted: "fill:#d4edda,stroke:#28a745,color:#155724",
  proposed: "fill:#fff3cd,stroke:#ffc107,color:#856404",
  deprecated: "fill:#f8d7da,stroke:#dc3545,color:#721c24",
  superseded: "fill:#e2e3e5,stroke:#6c757d,color:#383d41",
  not_adopted: "fill:#e2e3e5,stroke:#6c757d,color:#383d41,stroke-dasharray:3 3"
};
var GHOST_STYLE = "fill:#f5f5f5,stroke:#adb5bd,color:#6c757d,stroke-dasharray:2 2";
function truncateTitle(title) {
  return title.length > 50 ? title.slice(0, 47) + "..." : title;
}
function mermaidNodeLabel(p) {
  const escaped = truncateTitle(p.fm.title).replace(/"/g, "&quot;");
  return `"${p.id}<br/>${escaped}"`;
}
function mermaidNodeId(id) {
  return id.replace(/-/g, "_");
}
function collectEdges(sortedNodes, nodeIds) {
  const depends = [];
  const supersedes = [];
  for (const p of sortedNodes) {
    for (const dep of p.fm.depends_on ?? []) {
      if (nodeIds.has(dep)) depends.push([p.id, dep]);
    }
    for (const old of p.fm.supersedes ?? []) {
      if (nodeIds.has(old)) supersedes.push([p.id, old]);
    }
  }
  return { depends, supersedes };
}
function writeStatusClasses(lines, nodes) {
  lines.push("");
  for (const [status, style] of Object.entries(STATUS_STYLE)) {
    lines.push(`  classDef ${status} ${style}`);
  }
  lines.push(`  classDef ghost ${GHOST_STYLE}`);
  for (const p of nodes) {
    lines.push(`  class ${mermaidNodeId(p.id)} ${p.fm.status}`);
  }
}
function renderMermaid(adrs, options = {}) {
  const sortedNodes = [...adrs].sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds = new Set(sortedNodes.map((p) => p.id));
  const lines = ["flowchart TD"];
  if (options.groupByTopic) {
    const byTopic = /* @__PURE__ */ new Map();
    for (const p of sortedNodes) {
      const t = p.fm.topic;
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t).push(p);
    }
    const sortedTopics = [...byTopic.keys()].sort();
    for (const topic of sortedTopics) {
      lines.push(`  subgraph ${topic}["${topic}"]`);
      for (const p of byTopic.get(topic)) {
        lines.push(`    ${mermaidNodeId(p.id)}[${mermaidNodeLabel(p)}]`);
      }
      lines.push(`  end`);
    }
  } else {
    for (const p of sortedNodes) {
      lines.push(`  ${mermaidNodeId(p.id)}[${mermaidNodeLabel(p)}]`);
    }
  }
  const { depends, supersedes } = collectEdges(sortedNodes, nodeIds);
  for (const [from, to] of depends) {
    lines.push(`  ${mermaidNodeId(from)} --> ${mermaidNodeId(to)}`);
  }
  for (const [from, to] of supersedes) {
    lines.push(`  ${mermaidNodeId(from)} -.supersedes.-> ${mermaidNodeId(to)}`);
  }
  writeStatusClasses(lines, sortedNodes);
  return lines.join("\n") + "\n";
}
function renderMermaidForTopic(allAdrs, topic) {
  const inside = allAdrs.filter((p) => p.fm.topic === topic);
  if (inside.length === 0) {
    return `flowchart TD
  empty["(no ADRs in topic: ${topic})"]
`;
  }
  const byId = new Map(allAdrs.map((p) => [p.id, p]));
  const insideIds = new Set(inside.map((p) => p.id));
  const ghostIds = /* @__PURE__ */ new Set();
  for (const p of inside) {
    for (const dep of p.fm.depends_on ?? []) {
      if (!insideIds.has(dep) && byId.has(dep)) ghostIds.add(dep);
    }
    for (const old of p.fm.supersedes ?? []) {
      if (!insideIds.has(old) && byId.has(old)) ghostIds.add(old);
    }
  }
  for (const p of allAdrs) {
    if (insideIds.has(p.id)) continue;
    const referencesInside = (p.fm.depends_on ?? []).some((d) => insideIds.has(d)) || (p.fm.supersedes ?? []).some((d) => insideIds.has(d));
    if (referencesInside) ghostIds.add(p.id);
  }
  const lines = ["flowchart TD"];
  const sortedInside = [...inside].sort((a, b) => a.id.localeCompare(b.id));
  lines.push(`  subgraph ${topic}["${topic}"]`);
  for (const p of sortedInside) {
    lines.push(`    ${mermaidNodeId(p.id)}[${mermaidNodeLabel(p)}]`);
  }
  lines.push(`  end`);
  const sortedGhosts = [...ghostIds].sort().map((id) => byId.get(id));
  for (const p of sortedGhosts) {
    const label = `"${p.id}<br/>[${p.fm.topic}] ${truncateTitle(p.fm.title).replace(/"/g, "&quot;")}"`;
    lines.push(`  ${mermaidNodeId(p.id)}[${label}]`);
  }
  const nodeIds = /* @__PURE__ */ new Set([...insideIds, ...ghostIds]);
  const { depends, supersedes } = collectEdges([...sortedInside, ...sortedGhosts], nodeIds);
  for (const [from, to] of depends) {
    lines.push(`  ${mermaidNodeId(from)} --> ${mermaidNodeId(to)}`);
  }
  for (const [from, to] of supersedes) {
    lines.push(`  ${mermaidNodeId(from)} -.supersedes.-> ${mermaidNodeId(to)}`);
  }
  writeStatusClasses(lines, sortedInside);
  for (const p of sortedGhosts) {
    lines.push(`  class ${mermaidNodeId(p.id)} ghost`);
  }
  return lines.join("\n") + "\n";
}
function findDependsOnCycles(adrs) {
  const byId = new Map(adrs.map((p) => [p.id, p]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = /* @__PURE__ */ new Map();
  const cycles = [];
  const stack = [];
  const visit = (id) => {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const next of node.fm.depends_on ?? []) {
        if (!byId.has(next)) continue;
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          const start = stack.indexOf(next);
          cycles.push([...stack.slice(start), next]);
        } else if (c === WHITE) {
          visit(next);
        }
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const p of adrs) {
    if ((color.get(p.id) ?? WHITE) === WHITE) visit(p.id);
  }
  return cycles;
}
function cycleHeader(cycles) {
  if (cycles.length === 0) return [];
  const lines = ["> **Warning:** `depends_on` cycles detected:"];
  for (const c of cycles) lines.push(`> - ${c.join(" \u2192 ")}`);
  lines.push("");
  return lines;
}
function renderMarkdown(adrs) {
  const cycles = findDependsOnCycles(adrs);
  const header = [
    "# ADR Dependency Graph",
    "",
    `Generated from \`docs/adr/\` (${adrs.length} ADRs). Status colors: accepted (green), superseded / not_adopted (gray), deprecated (red), proposed (yellow). Arrows show \`depends_on\`; dashed arrows show \`supersedes\`.`,
    "",
    ...cycleHeader(cycles)
  ];
  return `${header.join("\n")}\`\`\`mermaid
${renderMermaid(adrs)}\`\`\`
`;
}
function renderOverview(adrs, topicLinkBase = "graph") {
  const cycles = findDependsOnCycles(adrs);
  const byTopic = /* @__PURE__ */ new Map();
  for (const p of adrs) {
    byTopic.set(p.fm.topic, (byTopic.get(p.fm.topic) ?? 0) + 1);
  }
  const sortedTopics = [...byTopic.keys()].sort();
  const legend = [
    "## Per-topic detail",
    "",
    ...sortedTopics.map((t) => `- [\`${t}\`](${topicLinkBase}/${t}.md) \u2014 ${byTopic.get(t)} ADRs`),
    ""
  ];
  const header = [
    "# ADR Dependency Graph \u2014 Overview",
    "",
    `${adrs.length} ADRs across ${sortedTopics.length} topics. Clusters group by \`topic\` frontmatter field. Edges crossing cluster borders are cross-topic dependencies.`,
    "",
    ...cycleHeader(cycles)
  ];
  const mermaid = renderMermaid(adrs, { groupByTopic: true });
  return `${header.join("\n")}\`\`\`mermaid
${mermaid}\`\`\`

${legend.join("\n")}`;
}
function renderTopicMarkdown(allAdrs, topic) {
  const mermaid = renderMermaidForTopic(allAdrs, topic);
  const count = allAdrs.filter((p) => p.fm.topic === topic).length;
  const header = [
    `# ADR Topic: ${topic}`,
    "",
    `${count} ADRs in this topic. Solid nodes belong to \`${topic}\`; gray dashed nodes are ghosts showing cross-topic references to help navigation.`,
    "",
    "Other topics: [overview](../graph.md).",
    ""
  ];
  return `${header.join("\n")}\`\`\`mermaid
${mermaid}\`\`\`
`;
}
function listTopics(adrs) {
  return [...new Set(adrs.map((p) => p.fm.topic))].sort();
}

// src/regenerator.ts
function stripTrailingSlash(p) {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}
function renderEffective(adrs) {
  const effective = effectiveSet(adrs);
  const byTopic = /* @__PURE__ */ new Map();
  for (const p of effective) {
    if (!byTopic.has(p.fm.topic)) byTopic.set(p.fm.topic, []);
    byTopic.get(p.fm.topic).push(p);
  }
  const sortedTopics = [...byTopic.keys()].sort();
  const lines = [
    "# Effective ADR Set",
    "",
    `Auto-generated by \`pnpm adr:regenerate\`. ${effective.length} of ${adrs.length} ADRs are currently \`status: accepted\` with no \`superseded_by\`.`,
    "",
    "Consumers (e.g. AI context pipelines) should read this file instead of scanning `docs/adr/` directly \u2014 it pre-filters out superseded, deprecated, and not-adopted ADRs.",
    "",
    "See also: [dependency graph](graph.md), per-topic detail under [graph/](graph/).",
    ""
  ];
  for (const topic of sortedTopics) {
    lines.push(`## ${topic}`);
    lines.push("");
    const items = [...byTopic.get(topic)].sort((a, b) => a.id.localeCompare(b.id));
    for (const p of items) {
      const filename = basename2(p.file);
      lines.push(`- [${p.id}](${filename}) \u2014 ${p.fm.title}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
function buildGeneratedFiles(adrs, config) {
  const { effective, graph, graphByTopic } = config.paths.outputs;
  const topicDir = stripTrailingSlash(graphByTopic);
  const files = [
    { relativePath: effective, contents: renderEffective(adrs) },
    { relativePath: graph, contents: renderOverview(adrs) }
  ];
  for (const topic of listTopics(adrs)) {
    files.push({
      relativePath: `${topicDir}/${topic}.md`,
      contents: renderTopicMarkdown(adrs, topic)
    });
  }
  return files;
}
function loadAdrs(dir, config) {
  return loadParsed(dir, config);
}

// src/cli/regenerate.ts
function parseArgs3(argv, defaultDir) {
  const args = argv.slice(2);
  let dir = defaultDir;
  let outDir = defaultDir;
  let check = false;
  for (const raw of args) {
    if (raw === "--check") {
      check = true;
    } else if (raw.startsWith("--dir=")) {
      dir = raw.slice("--dir=".length);
    } else if (raw.startsWith("--out-dir=")) {
      outDir = raw.slice("--out-dir=".length);
    } else if (raw === "--help" || raw === "-h") {
      return {
        error: `usage: regenerate.ts [options]
  (no flags)         \u2014 rewrite docs/adr/effective.md, graph.md, and graph/<topic>.md
  --check            \u2014 compare generated output with on-disk files; exit 1 if stale

Options:
  --dir=<path>       input ADR directory (default: docs/adr)
  --out-dir=<path>   output directory      (default: docs/adr)`
      };
    } else {
      return { error: `unknown option: ${raw}` };
    }
  }
  return { dir, outDir, check };
}
function readFileOrNull(path) {
  try {
    return readFileSync5(path, "utf8");
  } catch {
    return null;
  }
}
function main3(argv) {
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
  const parsed = parseArgs3(argv, config.paths.adrDir);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const adrs = loadAdrs(parsed.dir, config);
  const files = buildGeneratedFiles(adrs, config);
  if (parsed.check) {
    const stale = [];
    for (const f of files) {
      const onDisk = readFileOrNull(join5(parsed.outDir, f.relativePath));
      if (onDisk !== f.contents) stale.push(f.relativePath);
    }
    if (stale.length > 0) {
      console.error(
        `ADR generated files are out of date \u2014 run \`pnpm adr:regenerate\` and commit:`
      );
      for (const s of stale) console.error(`  \u2717 ${s}`);
      return 1;
    }
    console.log(`All ${files.length} generated ADR file(s) are up to date.`);
    return 0;
  }
  for (const f of files) {
    const full = join5(parsed.outDir, f.relativePath);
    mkdirSync(dirname2(full), { recursive: true });
    writeFileSync2(full, f.contents);
  }
  console.log(`Wrote ${files.length} file(s) under ${parsed.outDir}/:`);
  for (const f of files) console.log(`  ${f.relativePath}`);
  return 0;
}

// src/cli/validate.ts
function main4(argv) {
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
  const dir = argv[2] ?? config.paths.adrDir;
  const { errors, warnings, parsed } = validateDirectory(dir, config);
  if (warnings.length > 0) {
    console.warn(`${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  \u26A0 ${w}`);
  }
  if (errors.length > 0) {
    console.error(`${errors.length} error(s):`);
    for (const e of errors) console.error(`  \u2717 ${e}`);
  }
  console.log(`Validated ${parsed.length} ADR(s).`);
  return errors.length > 0 ? 1 : 0;
}

// src/cli/visualize.ts
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync3 } from "fs";
import { join as join6 } from "path";
function parseArgs4(argv, defaultDir) {
  const args = argv.slice(2);
  let mode = "all";
  let dir = defaultDir;
  let outDir = defaultDir;
  const packages = [];
  const concerns = [];
  let adrId = null;
  let topic = null;
  for (const raw of args) {
    if (raw === "--effective") {
      mode = "effective";
    } else if (raw.startsWith("--dir=")) {
      dir = raw.slice("--dir=".length);
    } else if (raw.startsWith("--out-dir=")) {
      outDir = raw.slice("--out-dir=".length);
    } else if (raw.startsWith("--package=")) {
      mode = "slice";
      packages.push(...raw.slice("--package=".length).split(",").filter(Boolean));
    } else if (raw.startsWith("--concern=")) {
      mode = "slice";
      concerns.push(...raw.slice("--concern=".length).split(",").filter(Boolean));
    } else if (raw.startsWith("--closure=")) {
      mode = "closure";
      adrId = raw.slice("--closure=".length);
    } else if (raw.startsWith("--topic=")) {
      mode = "topic";
      topic = raw.slice("--topic=".length);
    } else if (raw === "--write-all") {
      mode = "write-all";
    } else if (raw === "--help" || raw === "-h") {
      return {
        error: `usage: visualize.ts [options]
  (no flags)             \u2014 topic-grouped overview to stdout
  --topic=<slug>         \u2014 single topic detail (with ghost nodes)
  --effective            \u2014 limit to ADRs with status=accepted and no superseded_by
  --package=X --concern=Y \u2014 limit to scope slice + transitive depends_on
  --closure=ADR-X        \u2014 limit to one ADR and its transitive depends_on
  --write-all            \u2014 regenerate docs/adr/graph.md and docs/adr/graph/<topic>.md

Options:
  --dir=<path>           default: docs/adr
  --out-dir=<path>       default: docs/adr (only used by --write-all)`
      };
    } else {
      return { error: `unknown option: ${raw}` };
    }
  }
  if (mode === "closure" && adrId === null) {
    return { error: "--closure requires an ADR id" };
  }
  if (mode === "topic" && topic === null) {
    return { error: "--topic requires a topic slug" };
  }
  return { mode, dir, outDir, packages, concerns, adrId, topic };
}
function main5(argv) {
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
  const parsed = parseArgs4(argv, config.paths.adrDir);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const all = loadParsed(parsed.dir, config);
  try {
    if (parsed.mode === "write-all") {
      const { graph, graphByTopic } = config.paths.outputs;
      const topicDir = graphByTopic.endsWith("/") ? graphByTopic.slice(0, -1) : graphByTopic;
      const fullTopicDir = join6(parsed.outDir, topicDir);
      mkdirSync2(fullTopicDir, { recursive: true });
      writeFileSync3(join6(parsed.outDir, graph), renderOverview(all));
      const written = [graph];
      for (const t of listTopics(all)) {
        writeFileSync3(join6(fullTopicDir, `${t}.md`), renderTopicMarkdown(all, t));
        written.push(`${topicDir}/${t}.md`);
      }
      process.stderr.write(`wrote ${written.length} file(s) under ${parsed.outDir}/
`);
      for (const w of written) process.stderr.write(`  ${w}
`);
      return 0;
    }
    if (parsed.mode === "all") {
      process.stdout.write(renderOverview(all));
      return 0;
    }
    if (parsed.mode === "topic") {
      process.stdout.write(renderTopicMarkdown(all, parsed.topic));
      return 0;
    }
    let subset;
    if (parsed.mode === "effective") {
      subset = effectiveSet(all);
    } else if (parsed.mode === "slice") {
      subset = scopeSlice(all, { packages: parsed.packages, concerns: parsed.concerns });
    } else {
      subset = closure(all, parsed.adrId);
    }
    process.stdout.write(renderMarkdown(subset));
    return 0;
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 1;
  }
}

// src/cli/index.ts
var HELP = `usage: adr <subcommand> [options]

Subcommands:
  init                  generate a starter adr.config.json in CWD
  validate              schema and cross-reference validation of ADRs
  regenerate            rewrite effective.md, graph.md, and graph/<topic>.md
  extract               query the ADR set (effective, slice, closure)
  visualize             render Markdown / Mermaid views of the ADR set
  check-assumptions     verify file: / symbol: / grep: assumptions in ADRs

Run \`adr <subcommand> --help\` for subcommand-specific options.`;
function main6() {
  const sub = process.argv[2];
  const subArgv = [process.argv[0] ?? "node", `adr ${sub}`, ...process.argv.slice(3)];
  switch (sub) {
    case void 0:
    case "--help":
    case "-h":
    case "help":
      console.log(HELP);
      return sub === void 0 ? 1 : 0;
    case "init":
      return runInitCli(process.argv.slice(3));
    case "validate":
      return main4(subArgv);
    case "regenerate":
      return main3(subArgv);
    case "extract":
      return main2(subArgv);
    case "visualize":
      return main5(subArgv);
    case "check-assumptions":
      return main(subArgv);
    default:
      console.error(`unknown subcommand: ${sub}

${HELP}`);
      return 2;
  }
}
process.exit(main6());
//# sourceMappingURL=cli.js.map