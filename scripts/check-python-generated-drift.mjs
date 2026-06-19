#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import process from "node:process";

const GENERATED_ROOT = "python/openbox_sdk/generated";

function run(command, args, stdio = "inherit") {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

function generatedFiles() {
  const out = run(
    "git",
    ["ls-files", "-co", "--exclude-standard", "--", GENERATED_ROOT],
    "pipe",
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function fileHash(file) {
  if (!existsSync(file)) return "<missing>";
  const stat = statSync(file);
  if (!stat.isFile()) return "<not-file>";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function snapshot(files) {
  return new Map(files.map((file) => [file, fileHash(file)]));
}

const beforeFiles = generatedFiles();
const before = snapshot(beforeFiles);

run("npm", ["run", "specs:compile"]);

const afterFiles = generatedFiles();
const allFiles = [...new Set([...beforeFiles, ...afterFiles])].sort();
const after = snapshot(allFiles);
const changed = allFiles.filter((file) => before.get(file) !== after.get(file));

if (changed.length > 0) {
  console.error("Generated Python SDK files drift detected. Run npm run specs:compile.");
  for (const file of changed) {
    console.error(`  - ${relative(process.cwd(), file)}`);
  }
  process.exit(1);
}

console.log("OK: generated Python SDK files are current");
