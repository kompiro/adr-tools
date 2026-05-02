/* eslint-disable no-console -- CLI entry point */
import { runInit } from "../init.ts";

export function runInitCli(argv: string[]): number {
  const cwd = argv[0] ?? process.cwd();
  const result = runInit(cwd);
  if (!result.written) {
    console.error(result.message);
    return 1;
  }
  console.log(result.message);
  return 0;
}
