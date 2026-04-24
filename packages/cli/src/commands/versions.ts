// `openbox versions` - report the deployed commit/tag for each service
// (backend, core, guardrails) in each env (production, staging, local).
//
// Source resolution order per env/service:
//   1. Live `/version` endpoint on the service (works for everyone; the
//      deployed response carries the commit SHA and build time).
//   2. Fallback: read `image.tag:` from the k8s manifest repo via
//      `gh api` (openbox-manifest-k8s-cluster for staging,
//      openbox-k8s-cluster-prod for production). Those repos are
//      PRIVATE - so this fallback only works for OpenBox-AI
//      maintainers with `gh auth login` + repo access. Public users
//      get a targeted "no /version on this deployment yet; file an
//      issue upstream" message.
//   3. For the `local` column: read the current HEAD of each service
//      clone if ~/workspace/openbox-repos/openbox-* exists.
//
// Status: no deployed openbox service currently exposes /version.
// Adding those endpoints is tracked as a follow-up PR on openbox-backend
// + openbox-core. Until then, public users will see "no /version; ask
// upstream" for prod/staging; maintainers see the manifest tag.

import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

type EnvName = 'production' | 'staging' | 'local';
type ServiceName = 'openbox-backend' | 'openbox-core' | 'openbox-guardrails';

const SERVICES: ServiceName[] = ['openbox-backend', 'openbox-core', 'openbox-guardrails'];

// Which manifest repo owns each env's deployment.
const MANIFEST_REPO: Record<'production' | 'staging', string> = {
  staging: 'OpenBox-AI/openbox-manifest-k8s-cluster',
  production: 'OpenBox-AI/openbox-k8s-cluster-prod',
};

// Local clone paths for the `local` column. Tag = current git HEAD.
const LOCAL_CLONE: Record<ServiceName, string> = {
  'openbox-backend': resolve(homedir(), 'workspace/openbox-repos/openbox-backend'),
  'openbox-core': resolve(homedir(), 'workspace/openbox-repos/openbox-core'),
  'openbox-guardrails': resolve(homedir(), 'workspace/openbox-repos/openbox-guardrails'),
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
    // Private repo; most users will land here. Make the message actionable.
    return {
      tag: '(no /version; manifest private)',
      source: `${repo}/${service}/values.yaml (requires gh auth + repo access)`,
    };
  }
  const tag = extractTag(content);
  return {
    tag: tag ?? '(no tag: field found)',
    source: `${repo}/${service}/values.yaml`,
  };
}

// Try /version on the service first. Works for anyone once the
// endpoint is added upstream. Today it always 404s - we fall back to
// the manifest read.
function liveVersion(baseUrl: string): VersionCell | null {
  try {
    const raw = execFileSync(
      'curl',
      ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', `${baseUrl}/version`],
      { encoding: 'utf8', timeout: 7000 },
    ).trim();
    if (raw !== '200') return null;
    const body = execFileSync(
      'curl',
      ['-sS', '--max-time', '5', `${baseUrl}/version`],
      { encoding: 'utf8', timeout: 7000 },
    );
    const parsed = JSON.parse(body) as { commit?: string; version?: string };
    const tag = parsed.commit ?? parsed.version;
    return tag ? { tag, source: `${baseUrl}/version` } : null;
  } catch {
    return null;
  }
}

const ENV_URLS: Record<'production' | 'staging', Record<ServiceName, string>> = {
  production: {
    'openbox-backend': 'https://api.openbox.ai',
    'openbox-core': 'https://core.openbox.ai',
    'openbox-guardrails': '',
  },
  staging: {
    'openbox-backend': 'https://openbox-api.node.lat',
    'openbox-core': 'https://openbox-core.node.lat',
    'openbox-guardrails': '',
  },
};

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
  // Resolution order: /version endpoint (works for anyone) -> manifest
  // (maintainer-only fallback).
  const baseUrl = ENV_URLS[env][service];
  if (baseUrl) {
    const live = liveVersion(baseUrl);
    if (live) return live;
  }
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
        '\nresolution order:\n' +
          '  1. live /version endpoint on the service (works for anyone once deployed)\n' +
          '  2. manifest tag via `gh api` (maintainer-only; private repos)\n' +
          '  3. local HEAD of the service clone\n' +
          '\nno deployed service exposes /version today - follow-up: PR to add\n' +
          'GET /version on openbox-backend + openbox-core. Until then public\n' +
          'users will see "no /version" for production + staging columns.',
      );
    });
}
