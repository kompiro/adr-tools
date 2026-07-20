export {
  AdrConfigInvalidError,
  AdrConfigMissingError,
  CONFIG_FILENAME,
  loadConfig,
  PERMALINK_KINDS,
  type AdrConfig,
  type PermalinkKind,
} from "./config.ts";
export {
  closure,
  effectiveSet,
  format,
  loadParsed,
  scopeSlice,
  type OutputFormat,
} from "./extractor.ts";
export { runInit, type InitResult } from "./init.ts";
export { compareAdrIds } from "./sort.ts";
export { buildGeneratedFiles, loadAdrs } from "./regenerator.ts";
export {
  validateDirectory,
  type Frontmatter,
  type ParsedAdr,
  type PermalinkEntry,
} from "./validator.ts";
export {
  findDependsOnCycles,
  listTopics,
  renderMarkdown,
  renderMermaid,
  renderMermaidForTopic,
  renderOverview,
  renderTopicMarkdown,
} from "./visualizer.ts";
export { evaluateAll, type AssumptionResult } from "./assumptions.ts";
export {
  checkRepoBackedPin,
  createKrsResolver,
  createResolver,
  evaluateAllPermalinks,
  evaluatePermalinksForAdr,
  normalizeKrsAnchor,
  splitSourceAnchor,
  validateShort,
  type AnchorResolution,
  type PermalinkResolver,
  type PermalinkResult,
} from "./permalink.ts";
