// src/config.ts
import { readFileSync } from "fs";
import { join } from "path";
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
  const path = join(cwd, CONFIG_FILENAME);
  let text;
  try {
    text = readFileSync(path, "utf8");
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
import { readdirSync, readFileSync as readFileSync2 } from "fs";
import { basename, join as join2 } from "path";
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
    const full = join2(dir, f);
    const content = readFileSync2(full, "utf8");
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

// src/init.ts
import { existsSync, readFileSync as readFileSync3, writeFileSync } from "fs";
import { dirname, join as join3 } from "path";
import { fileURLToPath } from "url";
var TEMPLATE_PATH = join3(dirname(fileURLToPath(import.meta.url)), "init.template.json");
function runInit(cwd = process.cwd()) {
  const target = join3(cwd, CONFIG_FILENAME);
  if (existsSync(target)) {
    return {
      written: false,
      path: target,
      message: `${CONFIG_FILENAME} already exists at ${target}; refusing to overwrite.`
    };
  }
  const template = readFileSync3(TEMPLATE_PATH, "utf8");
  writeFileSync(target, template);
  return {
    written: true,
    path: target,
    message: `Generated ${CONFIG_FILENAME} at ${target}. Edit "topics" and "concerns" for your project.`
  };
}

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

// src/assumptions.ts
import { existsSync as existsSync2, readFileSync as readFileSync4 } from "fs";
import { join as join4 } from "path";
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
    const fullPath = join4(repoRoot, relativePath);
    if (existsSync2(fullPath)) return { ...base, status: "ok" };
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
  const fullPath = join4(repoRoot, relativePath);
  if (!existsSync2(fullPath)) {
    return {
      error: { ...base, status: "fail", message: `missing file: ${relativePath}` }
    };
  }
  try {
    return { content: readFileSync4(fullPath, "utf8") };
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
export {
  AdrConfigInvalidError,
  AdrConfigMissingError,
  CONFIG_FILENAME,
  buildGeneratedFiles,
  closure,
  effectiveSet,
  evaluateAll,
  findDependsOnCycles,
  format,
  listTopics,
  loadAdrs,
  loadConfig,
  loadParsed,
  renderMarkdown,
  renderMermaid,
  renderMermaidForTopic,
  renderOverview,
  renderTopicMarkdown,
  runInit,
  scopeSlice,
  validateDirectory
};
//# sourceMappingURL=index.js.map