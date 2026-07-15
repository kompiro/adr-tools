import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdrConfig } from "./config.ts";
import type { ParsedAdr } from "./validator.ts";

export type { PermalinkEntry } from "./validator.ts";

type PermalinkStatus = "ok" | "fail" | "warn";

export interface PermalinkResult {
  adrId: string;
  file: string;
  /** `permalink[<index>]` locator within the ADR. */
  at: string;
  /**
   * `ok` — nothing to report. `fail` — a hard error (counts toward the exit
   * code). `warn` — a non-fatal recommendation (e.g. a repo-backed permalink
   * that is not `@<sha>`-pinned); reported but never fails the check.
   */
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
  /**
   * Optional: validate the `view` field against the kind's vocabulary. Returns
   * an error message, or null when valid. `view` semantics are kind-specific,
   * so the generic layer delegates here.
   */
  validateView?(view: string): string | null;
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
  // Reject a `#s=<payload>` fragment share specifically (the fragment never
  // reaches the server, so its unfurl dies). Match the fragment form, not any
  // hash that merely contains `s=` (e.g. `#tips=1` is fine).
  if (/^#?s=/.test(url.hash)) {
    return `\`short\` points at a \`#s=\` fragment share; use the server-visible query form so the link unfurls: ${short}`;
  }
  return null;
}

/** A full git commit SHA (the only form that immutably pins a repo-backed link). */
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Recommend `@<sha>` pinning for a repo-backed permalink `short`.
 *
 * Returns a **non-fatal** warning message when `short` is served by one of the
 * configured `repoBackedHosts` (a karasu-nest resolver URL of the form
 * `…/<owner>/<repo>[/<path>][@<ref>]`) but is **not** pinned to a full commit
 * SHA — i.e. it is ref-less (mutable default branch) or carries a mutable
 * `@HEAD` / `@branch` / `@tag` / abbreviated-SHA ref. Returns `null` when the
 * link is SHA-pinned, is not repo-backed (host not in the allowlist), or the
 * allowlist is empty.
 *
 * The check is offline: it inspects the URL shape only and never resolves the
 * ref over the network. Keying on host (not URL path shape) keeps it
 * independent of the resolver's route form (bare vs prefixed).
 *
 * `short` is assumed to have passed {@link validateShort} (a parseable http(s)
 * URL); callers should run that first.
 */
export function checkRepoBackedPin(short: string, repoBackedHosts: string[]): string | null {
  if (repoBackedHosts.length === 0) return null;
  let url: URL;
  try {
    url = new URL(short);
  } catch {
    return null; // not a URL — validateShort owns that failure
  }
  if (!repoBackedHosts.includes(url.hostname)) return null;

  // The `@<ref>` (if any) trails the last path segment; the deep anchor lives
  // in `url.hash`, so only `url.pathname` matters here. An `@` with no ref, or
  // a ref that is not a full 40-hex SHA, is mutable.
  const atIdx = url.pathname.lastIndexOf("@");
  const ref = atIdx === -1 ? null : url.pathname.slice(atIdx + 1);
  if (ref !== null && FULL_SHA.test(ref)) return null;

  const detail =
    ref === null
      ? "it has no `@<ref>`, so it resolves the mutable default branch"
      : `\`@${ref}\` is a mutable ref (branch/tag/HEAD/abbreviated SHA)`;
  return `repo-backed permalink is not pinned to a commit SHA — ${detail}. Recommend \`@<40-hex-sha>\` so the ADR points at the structure as of the decision: ${short}`;
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
  // Emitted-anchor set per source path — one render serves every anchor into
  // the same `.krs` (and across every ADR, since the resolver is created once
  // by evaluateAllPermalinks).
  const anchorCache = new Map<string, Set<string>>();

  async function emittedAnchors(sourceAbsPath: string): Promise<Set<string> | { error: string }> {
    const cached = anchorCache.get(sourceAbsPath);
    if (cached) return cached;
    let core: KarasuCore;
    try {
      core = await loadCore();
    } catch {
      return { error: `permalink kind "krs" needs @karasu-tools/core installed` };
    }
    let svg: string;
    try {
      ({ svg } = await core.buildAllViewsSvgProject(sourceAbsPath, new ReadOnlyNodeFs()));
    } catch (e) {
      return { error: `could not render source to resolve anchor: ${(e as Error).message}` };
    }
    const emitted = new Set<string>();
    for (const m of svg.matchAll(/id="(krs-[^"]+)"/g)) emitted.add(m[1]);
    anchorCache.set(sourceAbsPath, emitted);
    return emitted;
  }

  return {
    validateView(view: string): string | null {
      return KRS_KNOWN_VIEWS.has(view)
        ? null
        : `unknown view "${view}" (known: ${[...KRS_KNOWN_VIEWS].join(", ")})`;
    },

    async resolveAnchor(sourceAbsPath, fragment): Promise<AnchorResolution> {
      const wanted = normalizeKrsAnchor(fragment);
      const viewToken = wanted.split("-")[1];
      if (!viewToken || !KRS_KNOWN_VIEWS.has(viewToken)) {
        return {
          ok: false,
          message: `anchor \`#${fragment}\` uses unknown view \`${viewToken ?? ""}\` (known: ${[...KRS_KNOWN_VIEWS].join(", ")})`,
        };
      }
      // Only the single-level whole-view fragments carry no `<id>` and are
      // outside the element-anchor grammar (deploy/matrix tabs, org tree
      // mode). A bare `krs-system`/`krs-org`/`krs-entity` is NOT such a form
      // (their roots are `krs-<view>-root`), so it must still be checked for
      // membership — otherwise a truncated/typo'd deep anchor passes silently.
      if (KRS_WHOLE_VIEW_ANCHORS.has(wanted)) {
        return { ok: true };
      }

      const emitted = await emittedAnchors(sourceAbsPath);
      if ("error" in emitted) {
        return { ok: false, message: `${emitted.error} (anchor \`#${fragment}\`)` };
      }
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

    // Collect this entry's failures; emit a single "ok" only if nothing failed.
    const entryResults: PermalinkResult[] = [];

    if (typeof entry.short === "string") {
      const shortErr = validateShort(entry.short);
      if (shortErr) {
        entryResults.push({ ...base, status: "fail", message: shortErr });
      } else if (config.permalink?.repoBackedHosts?.length) {
        // Only meaningful once `short` is a valid URL. Non-fatal: a repo-backed
        // link that isn't `@<sha>`-pinned is a recommendation, not an error.
        const pinWarn = checkRepoBackedPin(entry.short, config.permalink.repoBackedHosts);
        if (pinWarn) entryResults.push({ ...base, status: "warn", message: pinWarn });
      }
    }

    if (typeof entry.view === "string" && resolver?.validateView) {
      const viewErr = resolver.validateView(entry.view);
      if (viewErr) entryResults.push({ ...base, status: "fail", message: viewErr });
    }

    if (fragment !== null) {
      if (!resolver) {
        // A deep anchor with no configured resolver can't be checked. Fail
        // (not silently pass): declaring an anchor means opting into a
        // `permalink.kind` that can resolve it.
        entryResults.push({
          ...base,
          status: "fail",
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
  // Resolve the resolver once so its per-source render cache spans every ADR.
  const resolver = options.resolver !== undefined ? options.resolver : createResolver(config);
  const results: PermalinkResult[] = [];
  for (const adr of adrs) {
    results.push(...(await evaluatePermalinksForAdr(adr, repoRoot, config, { resolver })));
  }
  return results;
}
