// `openbox versions` - report the deployed commit/tag for each service
// (backend, core, guardrails) in each env (production, staging, local).
//
// Source of truth: the k8s manifest repos owned by OpenBox-AI.
//   openbox-manifest-k8s-cluster   - staging deployment
//   openbox-k8s-cluster-prod       - production deployment
//
// Each has per-service values.yaml with an `image.tag:` pinned to a
// git SHA or release tag. We read both via `gh api contents/<path>`
// (requires the user to be `gh auth login`-ed with read access). If
// gh isn't available or access is denied, the column prints the
// reason instead of a value.
//
// For the `local` column, we report the current dev/local-patches HEAD
// of the local clone (the workspace) - that IS
// the "pinned version" of local dev.
//
// Future: once the-backend-service + the-core-service expose a /version
// endpoint, this command can probe /version on each env and cross-check
// against the manifest tag. Today that endpoint doesn't exist on any
// deployed service, so manifest is the only source.

import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

type EnvName = 'production' | 'staging' | 'local';
type ServiceName = 'the-backend-service' | 'the-core-service' | 'the-guardrails-service';

const SERVICES: ServiceName[] = ['the-backend-service', 'the-core-service', 'the-guardrails-service'];

// Which manifest repo owns each env's deployment.
const MANIFEST_REPO: Record<'production' | 'staging', string> = {
  staging: 'OpenBox-AI/openbox-manifest-k8s-cluster',
  production: 'OpenBox-AI/openbox-k8s-cluster-prod',
};

// Local clone paths for the `local` column. Tag = current git HEAD.
const LOCAL_CLONE: Record<ServiceName, string> = {
  'the-backend-service': resolve(homedir(), 'workspace/the-workspace/the-backend-service'),
  'the-core-service': resolve(homedir(), 'workspace/the-workspace/the-core-service'),
  'the-guardrails-service': resolve(homedir(), 'workspace/the-workspace/the-guardrails-service'),
};

interface VersionCell {
  tag: string;
  source: string; // how we got it, for debugging
}

function ghRead(repo: string, path: string): string | null {
  try {
    const raw = execFileSync(
      'gh',
      ['api', `repos/${repo}/contents/${path}`, '--jq', '.content'],
      { encoding: 'utf8', timeout: 10000 },
    );
    return Buffer.from(raw.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function extractTag(valuesYaml: string): string | null {
  // Crude parse - no YAML dep. The tag line is always `  tag: "<value>"`
  // right under `image:`. Good enough for values.yaml written by our
  // templates. If the format diverges, we return null and print "unknown".
  const m = valuesYaml.match(/^\s+tag:\s+"?([^"\n]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

function manifestVersion(env: 'production' | 'staging', service: ServiceName): VersionCell {
  const repo = MANIFEST_REPO[env];
  const content = ghRead(repo, `${service}/values.yaml`);
  if (content === null) {
    return { tag: '(gh api failed)', source: `${repo}/${service}/values.yaml` };
  }
  const tag = extractTag(content);
  return {
    tag: tag ?? '(no tag: field found)',
    source: `${repo}/${service}/values.yaml`,
  };
}

function localHead(service: ServiceName): VersionCell {
  const dir = LOCAL_CLONE[service];
  if (!existsSync(dir)) {
    return { tag: '(clone missing)', source: dir };
  }
  try {
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    return { tag: `${sha} (${branch})`, source: dir };
  } catch {
    return { tag: '(git read failed)', source: dir };
  }
}

function cellFor(env: EnvName, service: ServiceName): VersionCell {
  if (env === 'local') return localHead(service);
  return manifestVersion(env, service);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function renderTable(rows: Record<EnvName, Record<ServiceName, VersionCell>>): string {
  const envs: EnvName[] = ['production', 'staging', 'local'];
  const headers = ['service', ...envs];
  const tagWidth = Math.max(
    10,
    ...envs.flatMap((e) => SERVICES.map((s) => rows[e][s].tag.length + 2)),
  );
  const svcWidth = Math.max(...SERVICES.map((s) => s.length)) + 2;
  const out: string[] = [];
  out.push(
    pad(headers[0], svcWidth) +
      envs.map((e) => pad(e, tagWidth)).join(''),
  );
  out.push('-'.repeat(svcWidth + tagWidth * envs.length));
  for (const service of SERVICES) {
    out.push(
      pad(service, svcWidth) +
        envs.map((e) => pad(rows[e][service].tag, tagWidth)).join(''),
    );
  }
  return out.join('\n');
}

export function registerVersionsCommand(program: Command): void {
  program
    .command('versions')
    .description('Show deployed pinned versions per env (backend, core, guardrails)')
    .option('--sources', 'Print where each value was read from (for debugging)')
    .action((opts: { sources?: boolean }) => {
      const envs: EnvName[] = ['production', 'staging', 'local'];
      const rows: Record<EnvName, Record<ServiceName, VersionCell>> = {} as Record<
        EnvName,
        Record<ServiceName, VersionCell>
      >;
      for (const env of envs) {
        rows[env] = {} as Record<ServiceName, VersionCell>;
        for (const svc of SERVICES) {
          rows[env][svc] = cellFor(env, svc);
        }
      }
      console.log(renderTable(rows));
      if (opts.sources) {
        console.log('\nsources:');
        for (const env of envs) {
          for (const svc of SERVICES) {
            console.log(`  ${env}/${svc}: ${rows[env][svc].source}`);
          }
        }
      }
      console.log(
        '\nnote: production + staging read from k8s manifest repos via `gh api`.\n' +
          '      local reads the current git HEAD of each service clone.\n' +
          '      no deployed service exposes /version today - file an issue to add it.',
      );
    });
}
