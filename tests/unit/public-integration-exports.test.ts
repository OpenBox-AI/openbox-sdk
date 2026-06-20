import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as anthropicAgentSdk from '../../ts/src/anthropic-agent-sdk/index.js';
import * as copilotkit from '../../ts/src/copilotkit/index.js';
import {
  PUBLIC_INTEGRATION_SUPPORT,
  type OpenBoxProviderId,
} from '../../ts/src/governance/capability-matrix.js';
import * as openaiAgentsSdk from '../../ts/src/openai-agents-sdk/index.js';
import * as n8n from '../../ts/src/runtime/n8n/index.js';

type PublicModule = Record<string, unknown>;
type PackageExportTarget = { types: string; import: string };

interface SdkTargetsFixture {
  packageSurface: {
    exports: Array<{
      subpath: string;
      types: string;
      importPath: string;
    }>;
  };
}

const PUBLIC_INTEGRATION_MODULES: Partial<Record<OpenBoxProviderId, PublicModule>> = {
  'openai-agents-sdk': openaiAgentsSdk,
  'anthropic-agent-sdk': anthropicAgentSdk,
  copilotkit,
  n8n,
};

function readPackageJson(): { exports?: Record<string, PackageExportTarget> } {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    exports?: Record<string, PackageExportTarget>;
  };
}

function readSdkTargetsFixture(): SdkTargetsFixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'codegen/fixtures/sdk-targets.json'), 'utf-8'),
  ) as SdkTargetsFixture;
}

describe('public SDK integration exports', () => {
  it('declares package subpaths for every public integration', () => {
    const packageJson = readPackageJson();
    const packageExports = packageJson.exports ?? {};
    const missingSubpaths = PUBLIC_INTEGRATION_SUPPORT
      .map((entry) => entry.packageSubpath)
      .filter((subpath) => !(subpath in packageExports));

    expect(missingSubpaths).toEqual([]);
  });

  it('keeps governance integration subpaths in the SDK package surface spec', () => {
    const packageJson = readPackageJson();
    const packageSurface = new Map(
      readSdkTargetsFixture().packageSurface.exports.map((entry) => [entry.subpath, entry]),
    );

    for (const entry of PUBLIC_INTEGRATION_SUPPORT) {
      const packageTarget = packageJson.exports?.[entry.packageSubpath];
      const specTarget = packageSurface.get(entry.packageSubpath);
      expect(specTarget, `${entry.integration} missing SDK package surface`).toBeDefined();
      expect(packageTarget, `${entry.integration} missing package export`).toEqual({
        types: specTarget!.types,
        import: specTarget!.importPath,
      });
    }
  });

  it('matches the TypeSpec-generated support matrix', () => {
    const missingImporters = PUBLIC_INTEGRATION_SUPPORT
      .map((entry) => entry.integration)
      .filter((integration) => !PUBLIC_INTEGRATION_MODULES[integration]);
    expect(missingImporters).toEqual([]);

    for (const entry of PUBLIC_INTEGRATION_SUPPORT) {
      const module = PUBLIC_INTEGRATION_MODULES[entry.integration];
      expect(module, `no public module importer for ${entry.integration}`).toBeDefined();
      const missingExports = entry.exports.filter(
        (exportName) => !(exportName in module!),
      );
      expect(missingExports, `${entry.integration} missing public exports`).toEqual([]);
    }
  });
});
