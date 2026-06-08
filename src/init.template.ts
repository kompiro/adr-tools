// Source of truth for the `adr init` starter config. Kept as an inline string
// (rather than a companion JSON file read at runtime) so the bundled output —
// including the Bun-compiled standalone binary — is self-contained and needs no
// file on disk next to the executable.
export const INIT_TEMPLATE = `{
  "$schema": "./node_modules/@kompiro/adr-tools/dist/config.schema.json",
  "idFormat": "date-sequence",
  "topics": ["architecture", "infrastructure", "process"],
  "concerns": ["security", "performance", "ci"],
  "paths": {
    "adrDir": "docs/adr",
    "outputs": {
      "effective": "effective.md",
      "graph": "graph.md",
      "graphByTopic": "graph/"
    }
  }
}
`;
