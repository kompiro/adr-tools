import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdrConfig } from "./config.ts";
import type { ParsedAdr } from "./validator.ts";

export type { PermalinkEntry } from "./validator.ts";

type PermalinkStatus = "ok" | "fail" | "manual";

export interface PermalinkResult {
  adrId: string;
  file: string;
  /** `permalink[<index>]` locator within the ADR. */
  at: string;
  status: PermalinkStatus;
  message?: string;
}

/** Outcome of resolving a deep anchor against its source. */
export type AnchorResolution = { ok: true } | { ok: false; message: string };

/**
 * A kind-specific resolver for the `#fragment` deep anchor a `source` may
 * carry. The generic layer handles schema, source existence, and `short`
 * shape; anchor semantics are domain-specific and delegated here.
 */
export interface PermalinkResolver {
  resolveAnchor(sourceAbsPath: string, fragment: string): Promise<AnchorResolution>;
}

/** Split a `source` value into its file path and optional `#fragment`. */
export function splitSourceAnchor(source: string): { path: string; fragment: string | null } {
  const hashIdx = source.indexOf("#");
  if (hashIdx === -1) return { path: source, fragment: null };
  return { path: source.slice(0, hashIdx), fragment: source.slice(hashIdx + 1) };
}

/**
 * Offline shape check of a `short` URL. Does not resolve it over the network
 * (that would be flaky in CI and would leak the referenced structure to the
 * shortener host on every run). A `#s=` fragment share is rejected because a
 * fragment never reaches the server, so its unfurl/preview dies.
 */
export function validateShort(short: string): string | null {
  let url: URL;
  try {
    url = new URL(short);
  } catch {
    return `\`short\` is not a valid URL: ${short}`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `\`short\` must be http(s): ${short}`;
  }
  if (url.hash.includes("s=")) {
    return `\`short\` points at a \`#s=\` fragment share; use the server-visible query form so the link unfurls: ${short}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Built-in `krs` resolver — resolves a karasu `#krs-<view>-<id>` anchor by
// rendering the .krs and checking membership in the emitted anchor set. It
// lazily imports the public `@karasu-tools/core` so adr-tools carries no hard
// dependency on karasu: the dependency is only needed when a repo opts in with
// `"permalink": { "kind": "krs" }`.
// ---------------------------------------------------------------------------

// Known `<view>` tokens (ShareTargetView + `entity`), and the whole-view
// fragments that carry no `<id>` and are outside the element-anchor grammar.
const KRS_KNOWN_VIEWS = new Set(["system", "deploy", "org", "matrix", "entity"]);
const KRS_WHOLE_VIEW_ANCHORS = new Set(["krs-deploy", "krs-matrix", "krs-org-tree"]);

/** Normalize a krs fragment to the element-anchor id the renderer emits. */
export function normalizeKrsAnchor(fragment: string): string {
  let a = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const colon = a.indexOf(":"); // drop the SPA-only `:<highlight>` focus suffix
  if (colon !== -1) a = a.slice(0, colon);
  return a;
}

// Minimal read-only FileSystemProvider (karasu's import resolver needs
// readFile / readDir / exists; the mutating methods are never called).
class ReadOnlyNodeFs {
  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }
  async readDir(path: string): Promise<{ name: string; kind: "file" | "directory" }[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? ("directory" as const) : ("file" as const),
    }));
  }
  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
  async writeFile(): Promise<void> {
    throw new Error("writeFile not supported");
  }
  async delete(): Promise<void> {
    throw new Error("delete not supported");
  }
  async mkdir(): Promise<void> {
    throw new Error("mkdir not supported");
  }
}

interface KarasuCore {
  buildAllViewsSvgProject(entryPath: string, fs: unknown): Promise<{ svg: string }>;
}

// The specifier is held in a variable and marked `@vite-ignore` so bundlers /
// test runners do not statically rewrite it (Vite otherwise stubs an optional
// peer dependency as a throwing `__vite-optional-peer-dep`). At runtime Node
// resolves `@karasu-tools/core` from the consumer's node_modules as usual.
const KARASU_CORE = "@karasu-tools/core";

export function createKrsResolver(
  loadCore: () => Promise<KarasuCore> = () =>
    import(/* @vite-ignore */ KARASU_CORE) as unknown as Promise<KarasuCore>,
): PermalinkResolver {
  return {
    async resolveAnchor(sourceAbsPath, fragment): Promise<AnchorResolution> {
      const wanted = normalizeKrsAnchor(fragment);
      const viewToken = wanted.split("-")[1];
      if (!viewToken || !KRS_KNOWN_VIEWS.has(viewToken)) {
        return {
          ok: false,
          message: `anchor \`#${fragment}\` uses unknown view \`${viewToken ?? ""}\` (known: ${[...KRS_KNOWN_VIEWS].join(", ")})`,
        };
      }
      // A bare `krs-<view>` or a known whole-view fragment addresses the view
      // itself, not an element — accept without an element-membership check.
      if (wanted === `krs-${viewToken}` || KRS_WHOLE_VIEW_ANCHORS.has(wanted)) {
        return { ok: true };
      }

      let core: KarasuCore;
      try {
        core = await loadCore();
      } catch {
        return {
          ok: false,
          message: `permalink kind "krs" needs @karasu-tools/core installed to resolve anchor \`#${fragment}\``,
        };
      }
      let svg: string;
      try {
        ({ svg } = await core.buildAllViewsSvgProject(sourceAbsPath, new ReadOnlyNodeFs()));
      } catch (e) {
        return {
          ok: false,
          message: `could not render source to resolve anchor: ${(e as Error).message}`,
        };
      }
      const emitted = new Set<string>();
      for (const m of svg.matchAll(/id="(krs-[^"]+)"/g)) emitted.add(m[1]);
      if (emitted.has(wanted)) return { ok: true };
      return {
        ok: false,
        message: `anchor \`#${fragment}\` does not resolve to any element in the source (renamed or removed?)`,
      };
    },
  };
}

/** Resolve the resolver for a config's `permalink.kind`, or null if none. */
export function createResolver(config: AdrConfig): PermalinkResolver | null {
  if (config.permalink?.kind === "krs") return createKrsResolver();
  return null;
}

export interface EvaluateOptions {
  /** Override the resolver (defaults to the one for `config.permalink.kind`). */
  resolver?: PermalinkResolver | null;
}

/** Validate one ADR's `permalink:` entries against the working tree. */
export async function evaluatePermalinksForAdr(
  adr: ParsedAdr,
  repoRoot: string,
  config: AdrConfig,
  options: EvaluateOptions = {},
): Promise<PermalinkResult[]> {
  const entries = adr.fm.permalink ?? [];
  const resolver = options.resolver !== undefined ? options.resolver : createResolver(config);
  const results: PermalinkResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const at = `permalink[${i}]`;
    const base = { adrId: adr.id, file: adr.file, at };

    const { path: srcPath, fragment } = splitSourceAnchor(entry.source);
    const srcAbs = resolve(repoRoot, srcPath);
    if (!existsSync(srcAbs)) {
      results.push({ ...base, status: "fail", message: `source does not exist: ${srcPath}` });
      continue;
    }

    // Collect this entry's checks; emit a single "ok" only if nothing failed
    // and nothing was deferred to manual review.
    const entryResults: PermalinkResult[] = [];

    if (typeof entry.short === "string") {
      const shortErr = validateShort(entry.short);
      if (shortErr) entryResults.push({ ...base, status: "fail", message: shortErr });
    }

    if (fragment !== null) {
      if (!resolver) {
        // A deep anchor with no configured resolver can't be checked — flag it
        // for human review rather than silently passing.
        entryResults.push({
          ...base,
          status: "manual",
          message: `source has a deep anchor \`#${fragment}\` but no \`permalink.kind\` resolver is configured`,
        });
      } else {
        const res = await resolver.resolveAnchor(srcAbs, fragment);
        if (!res.ok) entryResults.push({ ...base, status: "fail", message: res.message });
      }
    }

    if (entryResults.length === 0) results.push({ ...base, status: "ok" });
    else results.push(...entryResults);
  }
  return results;
}

/** Validate every ADR's `permalink:` entries. */
export async function evaluateAllPermalinks(
  adrs: ParsedAdr[],
  repoRoot: string,
  config: AdrConfig,
  options: EvaluateOptions = {},
): Promise<PermalinkResult[]> {
  const results: PermalinkResult[] = [];
  for (const adr of adrs) {
    results.push(...(await evaluatePermalinksForAdr(adr, repoRoot, config, options)));
  }
  return results;
}
