import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// `@karasu-tools/core` is declared as an *optional* peer dependency, which makes
// Vite refuse to resolve the specifier (it stubs optional peers as a throwing
// `__vite-optional-peer-dep`). It is installed as a devDependency for the krs
// integration test, so alias the specifier to its real resolved path — the
// dynamic import resolves normally in Node at runtime for real consumers.
const require = createRequire(import.meta.url);
let corePath: string | null = null;
try {
  corePath = require.resolve("@karasu-tools/core");
} catch {
  corePath = null; // not installed — the integration test will surface it
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    ...(corePath ? { alias: { "@karasu-tools/core": corePath } } : {}),
  },
});
