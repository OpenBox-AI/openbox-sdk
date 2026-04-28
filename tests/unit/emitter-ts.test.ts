// Snapshot test for the TS emitter output. Re-running `npm run
// specs:compile` regenerates ts/src/env/generated/env-bindings.ts;
// this test asserts that the emitted file contains the load-bearing
// pieces (env-var binding table, API-key validator regex,
// os-path-fields list) and matches a stable shape.
//
// If you change specs/typespec/env/main.tsp on purpose, run
// `npx vitest -u` to update the snapshot. If this test fails when
// you didn't touch the env spec, the emitter regressed.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const generatedPath = resolve(import.meta.dirname, '..', '..', 'ts', 'src', 'env', 'generated', 'env-bindings.ts');

describe('emitter: ts/src/env/generated/env-bindings.ts', () => {
  test('file exists (run `npm run specs:compile` if missing)', () => {
    expect(existsSync(generatedPath)).toBe(true);
  });

  test('content matches snapshot', () => {
    expect(readFileSync(generatedPath, 'utf8')).toMatchSnapshot();
  });

  test('exports the load-bearing surface', () => {
    const src = readFileSync(generatedPath, 'utf8');
    expect(src).toContain('export const ENV_VAR_BINDINGS');
    expect(src).toContain('OPENBOX_API_URL');
    expect(src).toContain('OPENBOX_CORE_URL');
    expect(src).toContain('OPENBOX_PLATFORM_URL');
    expect(src).toContain('export function validateApiKeyFormat');
    expect(src).toContain('/^obx_(?:live|test)_[0-9a-f]{48}$/');
    expect(src).toContain('export const OS_PATH_FIELDS');
  });

  test('AUTO-GENERATED banner is present', () => {
    const src = readFileSync(generatedPath, 'utf8');
    expect(src.startsWith('// AUTO-GENERATED')).toBe(true);
  });
});
