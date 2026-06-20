import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('package scripts', () => {
  test('generated cleanup covers TypeSpec-emitted conformance fixtures', () => {
    const cleanGenerated = packageJson.scripts['clean:generated'];

    expect(cleanGenerated).toContain('codegen/method-permissions.json');
    expect(cleanGenerated).toContain('codegen/fixtures/provider-capabilities.json');
    expect(cleanGenerated).toContain('codegen/fixtures/sdk-manifests.json');
  });

  test('SDK generation stays behind the generic TypeSpec command', () => {
    expect(packageJson.scripts['generate:sdks']).toBe('npm run build:codegen && npm run specs:compile');

    const languageSpecificGenerationCommands = Object.keys(packageJson.scripts).filter((name) =>
      /^(generate|check):(typescript|javascript|python|ts|js|py)$/.test(name),
    );
    expect(languageSpecificGenerationCommands).toEqual([]);
  });
});
