interface AdrConfig {
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
}
declare class AdrConfigMissingError extends Error {
    constructor(path: string);
}
declare class AdrConfigInvalidError extends Error {
    constructor(message: string);
}
declare const CONFIG_FILENAME = "adr.config.json";
declare function loadConfig(cwd?: string): AdrConfig;

declare const VALID_STATUSES: readonly ["proposed", "accepted", "deprecated", "superseded", "not_adopted"];
type Status = (typeof VALID_STATUSES)[number];
type Topic = string;
type Concern = string;
interface Frontmatter {
    id: string;
    title: string;
    status: Status;
    date: string;
    topic: Topic;
    authors?: string[];
    supersedes?: string[];
    superseded_by?: string | null;
    depends_on?: string[];
    related_to?: string[];
    conflicts_with?: string[];
    refines?: string[];
    scope?: {
        packages?: string[];
        concerns?: Concern[];
    };
    assumptions?: string[];
}
interface ParsedAdr {
    file: string;
    id: string;
    fm: Frontmatter;
    bodyHeading: string | null;
    body: string;
}
interface ValidationResult {
    errors: string[];
    warnings: string[];
    parsed: ParsedAdr[];
}
declare function validateDirectory(dir: string, config: AdrConfig): ValidationResult;

type OutputFormat = "list" | "markdown" | "json";
declare function effectiveSet(parsed: ParsedAdr[]): ParsedAdr[];
declare function scopeSlice(parsed: ParsedAdr[], filter: {
    packages?: string[];
    concerns?: string[];
    topics?: string[];
}): ParsedAdr[];
declare function closure(parsed: ParsedAdr[], startId: string): ParsedAdr[];
declare function loadParsed(dir: string, config: AdrConfig): ParsedAdr[];
declare function format(adrs: ParsedAdr[], fmt: OutputFormat): string;

interface InitResult {
    written: boolean;
    path: string;
    message: string;
}
declare function runInit(cwd?: string): InitResult;

interface GeneratedFile {
    /** Path relative to the ADR dir (e.g. "graph.md", "graph/parser.md"). */
    relativePath: string;
    contents: string;
}
/**
 * Compute every file the ADR tooling expects to keep in sync under
 * `docs/adr/`. The caller either writes them to disk (`regenerate`) or
 * compares them against disk state (`check`).
 */
declare function buildGeneratedFiles(adrs: ParsedAdr[], config: AdrConfig): GeneratedFile[];
declare function loadAdrs(dir: string, config: AdrConfig): ParsedAdr[];

interface VisualizeOptions {
    /** Emit `subgraph <topic> ... end` clusters. */
    groupByTopic?: boolean;
}
declare function renderMermaid(adrs: ParsedAdr[], options?: VisualizeOptions): string;
/**
 * Render a per-topic graph. Nodes inside the topic are rendered in full;
 * ADRs that are referenced by (or reference) the topic but belong elsewhere
 * become "ghost" nodes so readers can see cross-topic connections without
 * drowning in unrelated ADRs.
 */
declare function renderMermaidForTopic(allAdrs: ParsedAdr[], topic: string): string;
declare function findDependsOnCycles(adrs: ParsedAdr[]): string[][];
/** Markdown wrapper around a single flat Mermaid graph (legacy / query subsets). */
declare function renderMarkdown(adrs: ParsedAdr[]): string;
/** Overview: topic-grouped graph + links to per-topic detail files. */
declare function renderOverview(adrs: ParsedAdr[], topicLinkBase?: string): string;
/** Markdown wrapper around a single topic's detail graph with ghost nodes. */
declare function renderTopicMarkdown(allAdrs: ParsedAdr[], topic: string): string;
/** Returns the sorted list of topics present in the corpus. */
declare function listTopics(adrs: ParsedAdr[]): string[];

type AssumptionStatus = "ok" | "fail" | "manual";
interface AssumptionResult {
    adrId: string;
    file: string;
    assumption: string;
    status: AssumptionStatus;
    message?: string;
}
declare function evaluateAll(adrs: ParsedAdr[], repoRoot: string): AssumptionResult[];

export { type AdrConfig, AdrConfigInvalidError, AdrConfigMissingError, type AssumptionResult, CONFIG_FILENAME, type Frontmatter, type InitResult, type OutputFormat, type ParsedAdr, buildGeneratedFiles, closure, effectiveSet, evaluateAll, findDependsOnCycles, format, listTopics, loadAdrs, loadConfig, loadParsed, renderMarkdown, renderMermaid, renderMermaidForTopic, renderOverview, renderTopicMarkdown, runInit, scopeSlice, validateDirectory };
