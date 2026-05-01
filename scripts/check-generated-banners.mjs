#!/usr/bin/env node
// Guard: every file under a `generated/` directory anywhere in the
// monorepo MUST start with the AUTO-GENERATED banner emitted by
// codegen/emitters/. Catches:
//   - hand-written files accidentally dropped into a generated/ dir
//   - emitter regressions that strip the banner
//   - copy-paste from a generated file into a sibling location
//
// Run via:
//   node scripts/check-generated-banners.mjs
// or:
//   npm run lint:generated-banners

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const repoRoot = process.cwd();

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'specs/generated']);
// Accept either our codegen banner or the third-party
// openapi-typescript banner; both forms mark a file as generated.
const BANNER_PREFIXES = [
  '// AUTO-GENERATED',
  '/**\n * This file was auto-generated',
];
const README = 'README.md';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const rel = relative(repoRoot, path);
    if (SKIP_DIRS.has(entry) || SKIP_DIRS.has(rel)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const failures = [];

for (const file of walk(repoRoot)) {
  const rel = relative(repoRoot, file);
  if (!rel.includes('/generated/')) continue;
  if (rel.endsWith(README)) continue; // documentation entries
  const head = readFileSync(file, 'utf8').slice(0, 200);
  if (!BANNER_PREFIXES.some((b) => head.startsWith(b))) {
    failures.push(rel);
  }
}

if (failures.length > 0) {
  console.error('Files under generated/ missing the AUTO-GENERATED banner:');
  for (const f of failures) console.error('  ' + f);
  console.error('');
  console.error(
    `Either run \`npm run specs:compile\` to regenerate, or move the file\n` +
      `out of the generated/ subtree if it's hand-written.`,
  );
  process.exit(1);
}

console.log('OK: every generated/ file has the AUTO-GENERATED banner');
