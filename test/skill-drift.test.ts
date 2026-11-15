import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELATIONSHIP_FIELDS, VALID_STATUSES } from "../src/validator.ts";

// The adr-search skill tells an agent which commands to run and how to read
// what they print. These checks fail a PR that renames a subcommand or flag
// the skill names, or adds a status or relationship field the skill does not
// mention, without updating the skill (#39). They see names only; a change in
// what a rule means is left to review.

const ROOT = resolve(__dirname, "..");
const read = (path: string): string =>
  readFileSync(resolve(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const SKILL = read("skills/adr-search/SKILL.md");

// Subcommands as the CLI dispatches them: each `case "<name>":` except help.
function subcommands(): string[] {
  return [...read("src/cli/index.ts").matchAll(/case "([a-z][a-z-]*)":/g)]
    .map((m) => m[1] as string)
    .filter((sub) => sub !== "help");
}

const CLI_SOURCE = readdirSync(resolve(ROOT, "src/cli"))
  .map((file) => read(`src/cli/${file}`))
  .join("\n");

const SKILL_SUBCOMMANDS = [
  ...new Set([...SKILL.matchAll(/\badr ([a-z][a-z-]+)/g)].map((m) => m[1])),
];
const SKILL_FLAGS = [...new Set([...SKILL.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]))];

interface SchemaNode {
  properties?: Record<string, SchemaNode>;
}
const SCHEMA = JSON.parse(read("src/config.schema.json")) as SchemaNode;
const SKILL_CONFIG_PATHS = [
  ...new Set([...SKILL.matchAll(/`(paths\.[a-zA-Z.]+)`/g)].map((m) => m[1])),
];

function schemaHas(path: string): boolean {
  let node: SchemaNode | undefined = SCHEMA;
  for (const key of path.split(".")) node = node?.properties?.[key];
  return node !== undefined;
}

describe("adr-search skill", () => {
  it("reads the subcommand list from the CLI dispatcher", () => {
    expect(subcommands()).toEqual(expect.arrayContaining(["search", "refs"]));
  });

  it.each(["search", "refs"])("tells the agent to run adr %s", (sub) => {
    expect(SKILL).toContain(`adr ${sub} `);
  });

  it.each(SKILL_SUBCOMMANDS)("names adr %s, which the CLI dispatches", (sub) => {
    expect(subcommands()).toContain(sub);
  });

  it.each(SKILL_FLAGS)("names %s, which the CLI defines", (flag) => {
    expect(CLI_SOURCE).toContain(flag);
  });

  it.each(SKILL_CONFIG_PATHS)("names %s, which the config schema defines", (path) => {
    expect(schemaHas(path)).toBe(true);
  });

  // A status counts when a code span names it, as `not_adopted` or `status: superseded`.
  const codeSpans = [...SKILL.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string);
  it.each([...VALID_STATUSES])("classifies status %s", (status) => {
    expect(codeSpans.some((span) => new RegExp(`\\b${status}\\b`).test(span))).toBe(true);
  });

  it.each([...RELATIONSHIP_FIELDS])("names relationship field %s in the fallback", (field) => {
    expect(SKILL).toContain(`\`${field}\``);
  });
});

describe("plugin manifest", () => {
  it("has the same version as package.json", () => {
    const plugin = JSON.parse(read(".claude-plugin/plugin.json")) as { version: string };
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(plugin.version).toBe(pkg.version);
  });
});
