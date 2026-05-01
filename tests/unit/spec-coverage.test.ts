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

/** Pull every operation from the CLI spec; anything inside an
 *  interface body that ends with `(...): void`. Returns the decorator
 *  stack string per op so the caller can grep. */
function cliOpBlocks(source: string): { name: string; block: string }[] {
  const lines = source.split('\n');
  const out: { name: string; block: string }[] = [];
  let inInterface = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^interface\s+\w+\s*\{/.test(l)) inInterface = true;
    else if (l.trim() === '}') inInterface = false;
    if (!inInterface) continue;

    const m = l.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\(/);
    if (!m) continue;
    const opName = m[1];
    // Walk back to top of decorator stack; stop at the previous blank
    // line OR the line that opens the enclosing interface (`{` at line
    // end with NO preceding `#` for TypeSpec record literals). Plain
    // `{` from `interface Foo {` ends a line; record literals look
    // like `impact: #{` which also ends with `{` and would falsely
    // truncate the walk.
    let start = i;
    while (start > 0) {
      const prev = lines[start - 1];
      const trimmed = prev.trim();
      if (trimmed === '') break;
      if (trimmed.endsWith('{') && !trimmed.endsWith('#{') && !/[a-z_]+:\s*[#]?\{$/.test(trimmed)) break;
      start--;
    }
    out.push({ name: opName, block: lines.slice(start, i + 1).join('\n') });
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

describe('adapters.tsp: every @adapter declares @installTarget', () => {
  // Find every `@adapter("...")` line, check the same decorator stack
  // for @installTarget within ~15 lines (covers typical multi-line records).
  const re = /@adapter\("([^"]+)"/g;
  for (const m of adaptersTsp.matchAll(re)) {
    const name = m[1];
    const idx = m.index ?? 0;
    const window = adaptersTsp.slice(Math.max(0, idx - 1000), idx + 1000);
    test(`@adapter("${name}") has @installTarget`, () => {
      expect(/@installTarget\(/.test(window), `@adapter("${name}") must carry @installTarget`).toBe(true);
    });
  }
});

describe('cli/main.tsp: every interface op carries @cli_calls or @cli_output_kind("custom")', () => {
  const blocks = cliOpBlocks(cliTsp);

  test('parser found at least one CLI op (sanity)', () => {
    expect(blocks.length).toBeGreaterThan(50);
  });

  for (const { name, block } of blocks) {
    test(`op '${name}' has @cli_calls or @cli_output_kind("custom")`, () => {
      const hasCalls = /@cli_calls\(/.test(block);
      const customOutput = /@cli_output_kind\("custom"\)/.test(block);
      expect(
        hasCalls || customOutput,
        `op '${name}' must carry @cli_calls(...) or @cli_output_kind("custom")`,
      ).toBe(true);
    });
  }
});
