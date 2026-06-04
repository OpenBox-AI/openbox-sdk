#!/usr/bin/env node
/**
 * Regression test for `openbox verify`. For each fixture, runs `openbox verify
 * --json <fixture>` and checks which rules fired against the expected list in
 * expected.json. Fails (exit 1) if any expected rule didn't fire, or if the
 * clean fixture produces ANY findings.
 *
 * Run: node test-fixtures/verify/run.mjs
 * Or via: npm run test:verify (wired in package.json)
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(resolve(here, 'expected.json'), 'utf-8'));
const binary = resolve(here, '..', '..', 'dist', 'index.js');

let failures = 0;

function runVerify(fixture) {
  const fixturePath = resolve(here, fixture);
  let stdout = '';
  try {
    stdout = execFileSync('node', [binary, 'verify', fixturePath, '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // verify exits non-zero when findings are at or above --fail-on threshold.
    // That's expected for the bad fixtures; capture stdout anyway.
    stdout = err.stdout?.toString() ?? '';
  }
  return JSON.parse(stdout);
}

function assertFires(fixture, spec) {
  const mustFire = spec.must_fire;
  const mustFireAtLine = spec.must_fire_at_line || {};
  const result = runVerify(fixture);
  const fired = new Set(result.findings.map((f) => f.rule));
  const missing = mustFire.filter((r) => !fired.has(r));
  if (missing.length > 0) {
    console.error(`\x1b[31m✗ ${fixture}\x1b[0m; expected rule(s) did not fire:`);
    for (const r of missing) console.error(`    - ${r}`);
    console.error(`  actually fired: ${[...fired].join(', ') || '(none)'}`);
    failures += 1;
    return;
  }
  // Verify line-number accuracy for rules that specify must_fire_at_line.
  // This catches regressions where comment-stripping shifts line indices.
  const lineMismatches = [];
  for (const [rule, expectedLine] of Object.entries(mustFireAtLine)) {
    const hit = result.findings.find((f) => f.rule === rule);
    if (hit && hit.line !== expectedLine) {
      lineMismatches.push(`${rule}: expected line ${expectedLine}, got ${hit.line}`);
    }
  }
  if (lineMismatches.length > 0) {
    console.error(`\x1b[31m✗ ${fixture}\x1b[0m; line-number drift:`);
    for (const m of lineMismatches) console.error(`    - ${m}`);
    failures += 1;
    return;
  }
  console.log(`\x1b[32m✓ ${fixture}\x1b[0m; all ${mustFire.length} expected rule(s) fired${Object.keys(mustFireAtLine).length > 0 ? ' (line numbers verified)' : ''}`);
}

function assertClean(fixture) {
  const result = runVerify(fixture);
  if (result.findings.length > 0) {
    console.error(`\x1b[31m✗ ${fixture}\x1b[0m; expected ZERO findings but got:`);
    for (const f of result.findings) console.error(`    - ${f.rule} at L${f.line}`);
    failures += 1;
    return;
  }
  console.log(`\x1b[32m✓ ${fixture}\x1b[0m; zero findings, as expected`);
}

console.log('openbox verify; regression suite\n');

for (const [fixture, spec] of Object.entries(expected)) {
  if (spec.must_not_fire_any) assertClean(fixture);
  else assertFires(fixture, spec);
}

console.log();
if (failures > 0) {
  console.error(`\x1b[31m${failures} fixture(s) failed\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mall regressions pass\x1b[0m`);
