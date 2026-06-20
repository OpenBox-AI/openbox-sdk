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
  codegenBuild: {
    steps: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  sdkGeneration: {
    steps: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  specCommands: {
    commands: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  rootPipelines: {
    pipelines: Array<{
      id: string;
      label: string;
      steps: Array<{
        id: string;
        label: string;
        command: string;
        args?: string[];
        workingDirectory: string;
        env?: Record<string, string>;
      }>;
    }>;
  };
  testSuites: {
    defaultSuites: string[];
    suites: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  bundleBuild: {
    steps: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  qualityCommands: {
    commands: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  generatedChecks: {
    commands: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
    }>;
  };
  packageSurface: {
    packageName: string;
    bin: Array<{
      name: string;
      path: string;
    }>;
    files: string[];
    exports: Array<{
      subpath: string;
      types: string;
      importPath: string;
    }>;
  };
  cleanArtifacts: {
    paths: string[];
    nestedNames: Array<{
      root: string;
      names: string[];
    }>;
    filePatterns: Array<{
      root: string;
      prefix: string;
      suffix: string;
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
  localCi: {
    steps: Array<{
      id: string;
      label: string;
      command: string;
      args?: string[];
      workingDirectory: string;
      env?: Record<string, string>;
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

  test('declares the codegen build pipeline without package-script workspace lists', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['build:codegen']).toBe('node scripts/build-codegen.mjs');
    expect(packageJson.scripts['build:codegen']).not.toContain('-w typespec-');
    expect(fixture.codegenBuild.steps).toEqual([
      {
        id: 'typespec-env',
        label: 'TypeSpec env library',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-env'],
        workingDirectory: '.',
      },
      {
        id: 'typespec-cli',
        label: 'TypeSpec CLI library',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-cli'],
        workingDirectory: '.',
      },
      {
        id: 'typespec-workflow',
        label: 'TypeSpec workflow library',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-workflow'],
        workingDirectory: '.',
      },
      {
        id: 'typespec-emitter',
        label: 'OpenBox TypeSpec emitter',
        command: 'npm',
        args: ['run', 'build', '-w', 'typespec-emitter'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares SDK generation stages outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['generate:sdks']).toBe('node scripts/run-sdk-generation.mjs');
    expect(fixture.sdkGeneration.steps).toEqual([
      {
        id: 'build-codegen',
        label: 'Codegen package build',
        command: 'npm',
        args: ['run', 'build:codegen'],
        workingDirectory: '.',
      },
      {
        id: 'specs-compile',
        label: 'TypeSpec contract compile',
        command: 'npm',
        args: ['run', 'specs:compile'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares TypeSpec commands outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['specs:compile']).toBe(
      'node scripts/run-spec-command.mjs compile',
    );
    expect(packageJson.scripts['specs:watch']).toBe('node scripts/run-spec-command.mjs watch');
    expect(fixture.specCommands.commands).toEqual([
      {
        id: 'compile',
        label: 'TypeSpec contract compile',
        command: 'npx',
        args: ['tsp', 'compile', 'specs/typespec'],
        workingDirectory: '.',
      },
      {
        id: 'watch',
        label: 'TypeSpec contract watch',
        command: 'npx',
        args: ['tsp', 'compile', 'specs/typespec', '--watch'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares root build and check pipelines outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };
    const pipelines = Object.fromEntries(
      fixture.rootPipelines.pipelines.map((pipeline) => [pipeline.id, pipeline]),
    );

    expect(packageJson.scripts.build).toBe('node scripts/run-root-pipeline.mjs build');
    expect(packageJson.scripts['check:sdks']).toBe(
      'node scripts/run-root-pipeline.mjs check-sdks',
    );
    expect(fixture.rootPipelines.pipelines.map((pipeline) => pipeline.id)).toEqual([
      'build',
      'check-sdks',
    ]);
    expect(pipelines.build?.steps.map((step) => step.id)).toEqual([
      'generate-sdks',
      'bundle-build',
    ]);
    expect(pipelines['check-sdks']?.steps.map((step) => step.id)).toEqual([
      'generate-sdks',
      'validate-targets',
    ]);
    expect(pipelines['check-sdks']?.steps.at(-1)).toEqual({
      id: 'validate-targets',
      label: 'Validate SDK targets',
      command: 'node',
      args: ['scripts/check-sdks.mjs'],
      workingDirectory: '.',
    });
  });

  test('declares root test suite routing outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.test).toBe('node scripts/run-tests.mjs');
    expect(packageJson.scripts['test:unit']).toBe('node scripts/run-tests.mjs unit');
    expect(packageJson.scripts['test:contract']).toBe('node scripts/run-tests.mjs contract');
    expect(packageJson.scripts['test:hook-integration']).toBe(
      'node scripts/run-tests.mjs hook-integration',
    );
    expect(fixture.testSuites.defaultSuites).toEqual([
      'unit',
      'contract',
      'hook-integration',
    ]);
    expect(fixture.testSuites.suites).toEqual([
      {
        id: 'unit',
        label: 'Unit tests',
        command: 'npx',
        args: ['vitest', 'run', '--project', 'unit'],
        workingDirectory: '.',
      },
      {
        id: 'contract',
        label: 'Contract tests',
        command: 'npx',
        args: ['vitest', 'run', '--project', 'contract'],
        workingDirectory: '.',
      },
      {
        id: 'hook-integration',
        label: 'Hook integration tests',
        command: 'npx',
        args: ['vitest', 'run', '--project', 'hook-integration'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares bundle build stages outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['build:bundle']).toBe('node scripts/run-bundle-build.mjs');
    expect(fixture.bundleBuild.steps).toEqual([
      {
        id: 'tsup',
        label: 'TypeScript bundle',
        command: 'npx',
        args: ['tsup'],
        workingDirectory: '.',
      },
      {
        id: 'runtime-assets',
        label: 'Runtime asset sync',
        command: 'node',
        args: ['--experimental-strip-types', 'scripts/sync-runtime-assets.ts'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares quality commands outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.lint).toBe('node scripts/run-quality.mjs lint');
    expect(packageJson.scripts.format).toBe('node scripts/run-quality.mjs format');
    expect(fixture.qualityCommands.commands).toEqual([
      {
        id: 'lint',
        label: 'Root TypeScript lint',
        command: 'npx',
        args: ['eslint', 'ts/src'],
        workingDirectory: '.',
      },
      {
        id: 'format',
        label: 'Root TypeScript format',
        command: 'npx',
        args: ['prettier', '--write', 'ts/src'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares generated checks outside package scripts', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['check:generated-drift']).toBe(
      'node scripts/run-generated-check.mjs drift',
    );
    expect(packageJson.scripts['lint:generated-banners']).toBe(
      'node scripts/run-generated-check.mjs banners',
    );
    expect(fixture.generatedChecks.commands).toEqual([
      {
        id: 'drift',
        label: 'Generated drift',
        command: 'node',
        args: ['--experimental-strip-types', 'scripts/check-generated-drift.ts'],
        workingDirectory: '.',
      },
      {
        id: 'banners',
        label: 'Generated banners',
        command: 'node',
        args: ['--experimental-strip-types', 'scripts/check-generated-banners.ts'],
        workingDirectory: '.',
      },
    ]);
  });

  test('declares root clean artifacts without package-script path lists', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.cleanArtifacts.paths).toEqual([
      'dist',
      'dist-pack',
      'apps/extension/dist',
    ]);
    expect(fixture.cleanArtifacts.nestedNames).toEqual([
      { root: 'codegen', names: ['dist', 'tsconfig.tsbuildinfo'] },
    ]);
    expect(fixture.cleanArtifacts.filePatterns).toEqual([
      { root: 'apps/extension', prefix: 'openbox-', suffix: '.vsix' },
    ]);
  });

  test('declares the root package export surface', () => {
    const fixture = readSdkTargetsFixture();
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      name: string;
      bin: Record<string, string>;
      files: string[];
      exports: Record<string, { types: string; import: string }>;
    };
    const expectedExports = Object.fromEntries(
      fixture.packageSurface.exports.map((entry) => [
        entry.subpath,
        { types: entry.types, import: entry.importPath },
      ]),
    );

    expect(packageJson.name).toBe(fixture.packageSurface.packageName);
    expect(packageJson.bin).toEqual(
      Object.fromEntries(fixture.packageSurface.bin.map((entry) => [entry.name, entry.path])),
    );
    expect(packageJson.files).toEqual(fixture.packageSurface.files);
    expect(packageJson.exports).toEqual(expectedExports);
    expect(fixture.packageSurface.exports.map((entry) => entry.subpath)).toEqual(
      expect.arrayContaining([
        './openai-agents-sdk',
        './anthropic-agent-sdk',
        './copilotkit',
        './runtime/n8n',
      ]),
    );
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

  test('declares local CI as a target-neutral pipeline', () => {
    const fixture = readSdkTargetsFixture();

    expect(fixture.localCi.steps.map((step) => step.id)).toEqual([
      'check-sdks',
      'coverage',
      'build',
      'generated-drift',
      'generated-banners',
      'openapi-lint',
      'npm-audit',
      'security-audit',
    ]);
    expect(fixture.localCi.steps.find((step) => step.id === 'coverage')?.env).toEqual({
      OPENBOX_CLI: './scripts/openbox-cli-dev.mjs',
    });
    expect(fixture.localCi.steps.find((step) => step.id === 'build')?.env).toEqual({
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
    expect(fixture.localCi.steps.every((step) => step.workingDirectory === '.')).toBe(true);
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
