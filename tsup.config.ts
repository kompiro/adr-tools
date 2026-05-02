import { copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  splitting: false,
  shims: false,
  banner: ({ format: _f }) => ({ js: "" }),
  onSuccess: async () => {
    copyFileSync("src/config.schema.json", "dist/config.schema.json");
    copyFileSync("src/init.template.json", "dist/init.template.json");
  },
});
