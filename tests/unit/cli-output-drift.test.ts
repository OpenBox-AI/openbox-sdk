// Drift guard for CLI output.
//
// Invariant: no raw `console.log` / `console.error` / `console.warn` /
// `console.info` anywhere in `ts/src/cli/**/*.ts`, except in the
// implementation file `ts/src/cli/output.ts` itself (the helpers ARE
// the console wrappers). Every command, every infrastructure file
// (config, index, wire-subcommands, non-interactive) must route human
// output through `output.ts` so format stays consistent: prefix,
// stream, color, period, status vocabulary.
//
// Background: before this guard, every site invented its own format
// (capitalization, prefixes, error vs info channel, summary shape).
// The format spec lives in `ts/src/cli/output.ts`; this test makes sure
// nothing slips around it.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const CLI_DIR = join(REPO_ROOT, 'ts', 'src', 'cli');

// `output.ts` is the implementation file that contains the helpers
// themselves; it MUST call console.* directly. Nothing else gets a pass.
const ALLOWED_FILES = new Set<string>([join(CLI_DIR, 'output.ts')]);

// `cli/generated/**` is auto-generated from the spec; the generator
// emits handlers that route through wireSubcommands (no direct console
// calls), but skip them here just in case a future generator change
// adds raw output.
function isGenerated(file: string): boolean {
  return file.includes(`${CLI_DIR}/generated/`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && /\.ts$/.test(full)) out.push(full);
  }
  return out;
}

describe('cli output drift guard', () => {
  it('no console.log / console.error / console.warn / console.info in ts/src/cli/** (except output.ts)', () => {
    const files = walk(CLI_DIR).filter(
      (f) => !ALLOWED_FILES.has(f) && !isGenerated(f),
    );
    const hits: Array<{ file: string; line: number; snippet: string }> = [];
    const re = /console\.(log|error|warn|info)\b/;
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({
            file: relative(REPO_ROOT, file),
            line: i + 1,
            snippet: lines[i].trim(),
          });
        }
      }
    }
    if (hits.length > 0) {
      const detail = hits
        .map((h) => `  ${h.file}:${h.line}  ${h.snippet}`)
        .join('\n');
      throw new Error(
        `Found ${hits.length} raw console.* call(s) in ts/src/cli/. ` +
          `Use helpers from ts/src/cli/output.ts instead (error / warn / ` +
          `note / banner / info / action / success / row / summary / ` +
          `kv / table / output / outputList).\n${detail}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
