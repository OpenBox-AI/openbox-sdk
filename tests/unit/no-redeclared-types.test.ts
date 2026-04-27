// Regression guard: hand-written wrapper modules must NOT redeclare
// types that already live in `<package>/src/generated/`. The previous
// rounds eliminated 19 duplicates from `ts/core-client/src/core-client.ts`
// (each was a copy of a `Verdict` / `SpanData` / `GovernanceEventPayload`
// shape from the spec). This test fails if any of them creep back.
//
// Mechanism: parse the generated file's exported names, then scan the
// hand-written file's `export interface NAME` / `export type NAME`
// declarations. Any overlap is a regression.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

interface Pair {
  packageName: string;
  generatedPath: string;
  handWrittenPath: string;
  /** Names allowed to coexist in both files (e.g. legacy aliases). */
  allowOverlap: ReadonlySet<string>;
}

function exportedNames(source: string): Set<string> {
  const out = new Set<string>();
  const re = /^export (?:interface|type|class|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const m of source.matchAll(re)) out.add(m[1]);
  return out;
}

const repoRoot = resolve(import.meta.dirname, '..', '..');

const pairs: Pair[] = [
  {
    packageName: 'ts/core-client',
    generatedPath: resolve(repoRoot, 'ts/core-client/src/generated/core-types.ts'),
    handWrittenPath: resolve(repoRoot, 'ts/core-client/src/core-client.ts'),
    allowOverlap: new Set<string>(),
  },
  {
    packageName: 'ts/env',
    generatedPath: resolve(repoRoot, 'ts/env/src/generated/env-bindings.ts'),
    handWrittenPath: resolve(repoRoot, 'ts/env/src/environments.ts'),
    allowOverlap: new Set<string>([
      // re-exported under the same name to expose the spec type from the
      // package's public entry. Re-exports with `export type { X } from`
      // don't trip the `export interface/type/class` regex, so this set
      // stays empty under normal authoring; listed here as a placeholder.
    ]),
  },
];

describe.each(pairs)(
  '$packageName: hand-written file does not redeclare generated types',
  ({ generatedPath, handWrittenPath, allowOverlap }) => {
    const generated = exportedNames(readFileSync(generatedPath, 'utf8'));
    const handWritten = exportedNames(readFileSync(handWrittenPath, 'utf8'));

    test('no overlap', () => {
      const overlap = [...handWritten].filter(
        (n) => generated.has(n) && !allowOverlap.has(n),
      );
      expect(
        overlap,
        `hand-written file redeclares ${overlap.join(', ')} which is already exported from the generated file. Drop the local declaration and import from \`./generated/\`.`,
      ).toEqual([]);
    });
  },
);
