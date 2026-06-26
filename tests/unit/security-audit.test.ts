import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const gitleaksConfig = readFileSync(resolve(process.cwd(), '.gitleaks.toml'), 'utf8');
const sdkTargets = JSON.parse(
  readFileSync(resolve(process.cwd(), 'codegen/fixtures/sdk-targets.json'), 'utf8'),
) as {
  securityAudit?: {
    secretScanExcludes?: Array<{ path?: string; reason?: string }>;
  };
};

function expectAnnotatedGitleaksPath(pathRegex: string, rationale: RegExp): void {
  const lines = gitleaksConfig.split('\n');
  const index = lines.findIndex((line) => line.includes(pathRegex));
  expect(index, `${pathRegex} is listed in .gitleaks.toml`).toBeGreaterThanOrEqual(0);

  const nearbyComments = lines
    .slice(Math.max(0, index - 4), index)
    .filter((line) => line.trim().startsWith('#'))
    .join('\n');
  expect(nearbyComments).toMatch(rationale);
}

describe('security audit configuration', () => {
  test('Gitleaks placeholder-key false positives are annotated', () => {
    expect(gitleaksConfig).toContain(
      'description = "OpenBox placeholder keys used by tests and generated contract fixtures"',
    );
    expectAnnotatedGitleaksPath(
      String.raw`^specs/typespec/(cli|env)/main\.tsp$`,
      /canonical TypeSpec fixture literals.*non-secret/is,
    );
  });

  test('local secret-scan excludes mirror Gitleaks fixture/spec false positives with reasons', () => {
    const excludes = sdkTargets.securityAudit?.secretScanExcludes ?? [];
    const byPath = new Map(excludes.map((entry) => [entry.path, entry.reason]));
    for (const file of [
      'codegen/fixtures/cli-auth.json',
      'codegen/fixtures/env-resolution.json',
      'specs/typespec/cli/main.tsp',
      'specs/typespec/env/main.tsp',
    ]) {
      expect(byPath.get(file), `${file} is documented in TypeSpec-emitted securityAudit`).toMatch(
        /non-secret|fixture/i,
      );
    }
    expect(excludes.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 20)).toBe(true);
  });
});
