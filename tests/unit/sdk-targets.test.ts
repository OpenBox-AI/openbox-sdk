import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

interface SdkTargetsFixture {
  generatedBy: string;
  source: string;
  regenerate: string;
  generatedArtifacts: {
    generatedRoots: string[];
    generatedFiles: string[];
    nestedGeneratedFiles: Array<{
      root: string;
      suffixes: string[];
    }>;
  };
  securityAudit: {
    commands: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
    secretScanExcludes: Array<{
      path: string;
      reason: string;
    }>;
  };
  targets: Array<{
    id: string;
    label: string;
    kind?: string;
    workingDirectory: string;
    commands: Array<{
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>;
  }>;
}

function readSdkTargetsFixture(): SdkTargetsFixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'codegen/fixtures/sdk-targets.json'), 'utf8'),
  ) as SdkTargetsFixture;
}

describe('SDK target validation manifest', () => {
  test('is emitted from TypeSpec and covers every target', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.generatedBy).toBe('codegen/emitters/typespec-emitter');
    expect(fixture.source).toBe('specs/typespec/sdk/main.tsp');
    expect(fixture.regenerate).toBe('npm run specs:compile');
    expect(fixture.targets.map((target) => target.id)).toEqual([
      'typescript',
      'python',
      'extension',
      'n8n-custom-node',
    ]);
    expect(fixture.targets.map((target) => target.kind)).toEqual(['sdk', 'sdk', 'app', 'app']);
  });

  test('declares generated artifact cleanup and drift inventory', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.generatedArtifacts.generatedRoots).toEqual([
      'specs/generated',
      'python/openbox_sdk/generated',
      'apps/extension/src/generated',
      'example/n8n/custom-node/src/generated',
    ]);
    expect(fixture.generatedArtifacts.generatedFiles).toEqual([
      'codegen/method-names.json',
      'codegen/method-permissions.json',
      'codegen/fixtures/cli-auth.json',
      'codegen/fixtures/env-resolution.json',
      'codegen/fixtures/govern-protocol.json',
      'codegen/fixtures/provider-capabilities.json',
      'codegen/fixtures/sdk-manifests.json',
      'codegen/fixtures/sdk-targets.json',
    ]);
    expect(fixture.generatedArtifacts.nestedGeneratedFiles).toEqual([
      { root: 'ts/src', suffixes: ['.ts', '.d.ts'] },
    ]);
  });

  test('declares security audit commands and annotated secret-scan excludes', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.securityAudit.commands).toEqual([
      {
        id: 'root-npm-audit',
        label: 'root npm audit',
        command: 'npm',
        args: ['audit'],
        workingDirectory: '.',
      },
      {
        id: 'n8n-npm-audit',
        label: 'n8n npm audit',
        command: 'npm',
        args: ['audit'],
        workingDirectory: 'example/n8n/custom-node',
      },
    ]);
    expect(fixture.securityAudit.secretScanExcludes.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'codegen/fixtures/cli-auth.json',
        'codegen/fixtures/env-resolution.json',
        'specs/typespec/cli/main.tsp',
        'specs/typespec/env/main.tsp',
      ]),
    );
    expect(fixture.securityAudit.secretScanExcludes.every((entry) => entry.reason.length > 20)).toBe(true);
  });

  test('keeps root validation generic while target commands remain native', () => {
    const fixture = readSdkTargetsFixture();
    const byTarget = Object.fromEntries(fixture.targets.map((target) => [target.id, target]));

    expect(byTarget.typescript?.workingDirectory).toBe('.');
    expect(byTarget.typescript?.commands.map((command) => command.command)).toEqual([
      'npm',
      'npx',
      'npm',
    ]);
    expect(byTarget.typescript?.commands.at(-1)?.env).toEqual({
      OPENBOX_CLI: './scripts/openbox-cli-dev.mjs',
    });

    expect(byTarget.python?.workingDirectory).toBe('python');
    expect(byTarget.python?.commands.map((command) => command.command)).toEqual([
      'uv',
      'uv',
      'uv',
      'uv',
    ]);

    expect(byTarget.extension?.workingDirectory).toBe('apps/extension');
    expect(byTarget.extension?.commands).toEqual([
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npm', args: ['run', 'test'] },
    ]);

    expect(byTarget['n8n-custom-node']?.workingDirectory).toBe('example/n8n/custom-node');
    expect(byTarget['n8n-custom-node']?.commands).toEqual([
      { command: 'npm', args: ['ci', '--ignore-scripts'] },
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npm', args: ['run', 'smoke:load'] },
    ]);
  });
});
