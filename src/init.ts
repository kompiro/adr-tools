import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILENAME } from "./config.ts";

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "init.template.json");

export interface InitResult {
  written: boolean;
  path: string;
  message: string;
}

export function runInit(cwd: string = process.cwd()): InitResult {
  const target = join(cwd, CONFIG_FILENAME);
  if (existsSync(target)) {
    return {
      written: false,
      path: target,
      message: `${CONFIG_FILENAME} already exists at ${target}; refusing to overwrite.`,
    };
  }
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  writeFileSync(target, template);
  return {
    written: true,
    path: target,
    message: `Generated ${CONFIG_FILENAME} at ${target}. Edit "topics" and "concerns" for your project.`,
  };
}
