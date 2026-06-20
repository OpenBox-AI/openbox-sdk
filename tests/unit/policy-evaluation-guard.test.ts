import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { POLICY_EVALUATION_GUARDS } from '../../ts/src/governance/capability-matrix.js';

const repoRoot = resolve(process.cwd());
const ignoredDirs = new Set([
  '.git',
  'coverage',
  'dist',
  'dist-pack',
  'node_modules',
  'specs/generated',
  'ts/src/core-client/generated',
  'ts/src/client/generated',
  'ts/src/governance/generated',
  'python/openbox_sdk/generated',
]);

const disallowedEvaluatorPackages = new Set([
  '@open-policy-agent/opa',
  '@open-policy-agent/opa-wasm',
  '@styra/opa',
  'node-opa',
  'opa-wasm',
  'rego-js',
]);

const forbiddenEvaluatorPatterns: readonly { name: string; pattern: RegExp }[] = [
  { name: 'backend evaluateRego called locally', pattern: /\bevaluateRego\s*\(/ },
  { name: 'Rego evaluator constructed locally', pattern: /\bnew\s+Rego\b/ },
  { name: 'OPA/Rego eval API called locally', pattern: /\b(?:opa|rego)\.eval(?:uate)?\s*\(/i },
  { name: 'OPA WASM policy loaded locally', pattern: /\b(?:loadPolicy|opaWasm|instantiateOpa|compileRego)\b/ },
  { name: 'generic policy evaluator called locally', pattern: /\bevaluatePolicy\s*\(/ },
];

function rel(path: string): string {
  return relative(repoRoot, path).split('\\').join('/');
}

function isIgnored(path: string): boolean {
  const normalized = rel(path);
  if (normalized.split('/').includes('node_modules')) return true;
  return [...ignoredDirs].some((ignored) =>
    normalized === ignored || normalized.startsWith(`${ignored}/`));
}

function walk(dir: string, predicate: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir) || isIgnored(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (isIgnored(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

describe('backend-owned policy evaluation guard', () => {
  it('declares the backend authority for every generated policy guard', () => {
    expect(POLICY_EVALUATION_GUARDS).not.toHaveLength(0);
    for (const guard of POLICY_EVALUATION_GUARDS) {
      expect(guard.authority).toContain('Core/backend');
      expect(guard.sdkResponsibility.length).toBeGreaterThan(20);
      expect(guard.allowedLocalWork).not.toContain('evaluation');
      expect(guard.forbiddenLocalWork).toContain('behavior-rule matching');
    }
  });

  it('does not add OPA/Rego evaluator dependencies to package manifests', () => {
    const packageJsons = walk(repoRoot, (path) => path.endsWith('package.json'));
    const offenders: string[] = [];
    for (const path of packageJsons) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = manifest[section];
        if (!deps || typeof deps !== 'object') continue;
        for (const name of Object.keys(deps)) {
          if (disallowedEvaluatorPackages.has(name)) {
            offenders.push(`${rel(path)}:${section}:${name}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources', () => {
    const sourceFiles = [
      ...walk(join(repoRoot, 'ts/src'), (path) => /\.(?:ts|tsx)$/.test(path)),
      ...walk(join(repoRoot, 'python/openbox_sdk'), (path) => path.endsWith('.py')),
    ];
    const offenders: string[] = [];
    for (const path of sourceFiles) {
      const source = readFileSync(path, 'utf8');
      for (const { name, pattern } of forbiddenEvaluatorPatterns) {
        if (pattern.test(source)) offenders.push(`${rel(path)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
