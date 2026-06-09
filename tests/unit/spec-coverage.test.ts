// Spec-coverage drift guards. Each decorator establishes a
// "every op must declare ___" contract. The cheapest enforcement is a
// regex pass over the source; fast, catches the common "added an op,
// forgot the decorator" failure mode without spinning up a TypeSpec
// compiler in the test harness.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const adaptersTsp = readFileSync(resolve(repoRoot, 'specs/typespec/govern/adapters.tsp'), 'utf8');
const cliTsp = readFileSync(resolve(repoRoot, 'specs/typespec/cli/main.tsp'), 'utf8');

/** Pull every @hookEvent op block from adapters.tsp, paired with the
 *  decorator stack above it. Returns each as a single string blob so
 *  the caller can grep for sibling decorators. */
function hookEventBlocks(source: string): { name: string; block: string }[] {
  // Split by lines, then walk: when we hit a line with `@hookEvent`, capture
  // backwards to the previous blank line (start of decorator stack) and
  // forwards to the operation's signature line.
  const lines = source.split('\n');
  const out: { name: string; block: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/@hookEvent\("([^"]+)"\)/);
    if (!m) continue;
    let start = i;
    while (start > 0 && lines[start - 1].trim() !== '' && !lines[start - 1].trim().startsWith('//') && !lines[start - 1].trim().startsWith('/**') && !lines[start - 1].trim().startsWith('*')) {
      start--;
    }
    let end = i;
    while (end < lines.length && !/[a-zA-Z0-9_]+\(input/.test(lines[end])) {
      end++;
    }
    out.push({ name: m[1], block: lines.slice(start, end + 1).join('\n') });
  }
  return out;
}

describe('adapters.tsp: every @hookEvent op declares its payload contract', () => {
  const blocks = hookEventBlocks(adaptersTsp);

  test('parser found at least one @hookEvent op (sanity)', () => {
    expect(blocks.length).toBeGreaterThan(15);
  });

  for (const { name, block } of blocks) {
    test(`@hookEvent("${name}") has @payloadShape OR @noPayload`, () => {
      const hasPayload = /@payloadShape\(/.test(block);
      const hasNoPayload = /@noPayload\b/.test(block);
      expect(hasPayload || hasNoPayload, `@hookEvent("${name}") must carry @payloadShape or @noPayload`).toBe(true);
    });

    test(`@hookEvent("${name}") has @verdictShape`, () => {
      expect(/@verdictShape\(/.test(block), `@hookEvent("${name}") must carry @verdictShape`).toBe(true);
    });
  }
});

describe('adapters.tsp: every @adapter declares @hookTarget', () => {
  // Find every `@adapter("...")` line, check the same decorator stack
  // for @hookTarget within ~15 lines (covers typical multi-line records).
  const re = /@adapter\("([^"]+)"/g;
  for (const m of adaptersTsp.matchAll(re)) {
    const name = m[1];
    const idx = m.index ?? 0;
    const window = adaptersTsp.slice(Math.max(0, idx - 1000), idx + 1000);
    test(`@adapter("${name}") has @hookTarget`, () => {
      expect(/@hookTarget\(/.test(window), `@adapter("${name}") must carry @hookTarget`).toBe(true);
    });
  }
});

describe('cli/main.tsp: lean CLI stays free of generated CRUD command trees', () => {
  test('contains no command interfaces or generated admin decorators', () => {
    expect(cliTsp).not.toMatch(/\binterface\s+\w+\s*\{/);
    expect(cliTsp).not.toMatch(/@cli_calls\(|@cli_recipe\(/);
  });
});
