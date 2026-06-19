#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const generate = spawnSync("node", ["scripts/generate-python-sdk.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "inherit",
});

if (generate.status !== 0) {
  process.exit(generate.status ?? 1);
}

const diff = spawnSync("git", ["diff", "--exit-code", "--", "python/openbox_sdk/generated"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "inherit",
});

if (diff.status !== 0) {
  console.error("Generated Python SDK files are out of date. Run npm run generate:python.");
  process.exit(diff.status ?? 1);
}
