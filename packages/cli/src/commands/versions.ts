// `openbox versions` - report the deployed commit/tag for each service
// (backend, core, guardrails) in each env (production, staging, local).
//
// Source resolution order per env/service:
//   1. `GET /version` on the service - works for anyone. Currently not
//      deployed; the patches in the-local-stack-dev-repo add it
//      (patches/07-backend-version-endpoint.patch and
//      patches/08-core-version-endpoint.patch). Once those land
//      upstream and envs redeploy, this path lights up publicly.
//   2. Fallback (maintainer-only): manifest `image.tag:` read via
//      `gh api` from openbox-manifest-k8s-cluster (staging) and
//      openbox-k8s-cluster-prod (production). Both repos are private,
//      so only OpenBox-AI maintainers can use it.
//   3. Local column: current git HEAD of each service clone under
//      the workspace if it exists.
//
// When all three fail for a cell, it prints "(no /version)" and the
// --sources flag shows why.

import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

type EnvName = 'production' | 'staging' | 'local';
type ServiceName = 'the-backend-service' | 'the-core-service' | 'the-guardrails-service';

const SERVICES: ServiceName[] = ['the-backend-service', 'the-core-service', 'the-guardrails-service'];

const MANIFEST_REPO: Record<'production' | 'staging', string> = {
  staging: 'OpenBox-AI/openbox-manifest-k8s-cluster',
  production: 'OpenBox-AI/openbox-k8s-cluster-prod',
};

const LOCAL_CLONE: Record<ServiceName, string> = {
  'the-backend-service': resolve(homedir(), 'workspace/the-workspace/the-backend-service'),
  'the-core-service': resolve(homedir(), 'workspace/the-workspace/the-core-service'),
  'the-guardrails-service': resolve(homedir(), 'workspace/the-workspace/the-guardrails-service'),
};

// URLs per env. Kept in sync with openbox-sdk/packages/cli/src/environments.ts
// - the single source of truth for env URLs. Don't invent these.
const ENV_URLS: Record<EnvName, Record<ServiceName, string>> = {
  production: {
    'the-backend-service': 'https://api.openbox.ai',
    'the-core-service': 'https://core.openbox.ai',
    'the-guardrails-service': '',
  },
  staging: {
    'the-backend-service': 'https://openbox-api.node.lat',
    'the-core-service': 'https://the-core-service.node.lat',
    'the-guardrails-service': '',
  },
  local: {
    'the-backend-service': 'http://localhost:3000',
    'the-core-service': 'http://localhost:8086',
    'the-guardrails-service': '',
  },
};

interface VersionCell {
  tag: string;
  source: string;
}

function liveVersion(baseUrl: string): VersionCell | null {
  if (!baseUrl) return null;
  try {
    const body = execFileSync('curl', ['-sS', '--max-time', '5', `${baseUrl}/version`], {
      encoding: 'utf8',
      timeout: 7000,
    });
    const raw = JSON.parse(body) as Record<string, unknown>;
    // Backend wraps responses in { status, data: {...} }; core returns
    // the payload flat. Handle both without assuming which is which.
    const payload =
      (raw.data && typeof raw.data === 'object'
        ? (raw.data as Record<string, unknown>)
        : raw) ?? {};
    const tag =
      (typeof payload.commit === 'string' && payload.commit) ||
      (typeof payload.version === 'string' && payload.version) ||
      null;
    return tag ? { tag, source: `${baseUrl}/version` } : null;
  } catch {
    return null;
  }
}

function ghReadManifest(repo: string, path: string): string | null {
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
  const m = valuesYaml.match(/^\s+tag:\s+"?([^"\n]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

function manifestVersion(
  env: 'production' | 'staging',
  service: ServiceName,
): VersionCell | null {
  const repo = MANIFEST_REPO[env];
  const content = ghReadManifest(repo, `${service}/values.yaml`);
  if (content === null) return null; // no gh access or private-repo miss
  const tag = extractTag(content);
  if (!tag) return null;
  return { tag, source: `${repo}/${service}/values.yaml (maintainer path)` };
}

function localHead(service: ServiceName): VersionCell {
  const dir = LOCAL_CLONE[service];
  if (!existsSync(dir)) return { tag: '(clone missing)', source: dir };
  try {
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    return { tag: `${sha} (${branch})`, source: `${dir} (git HEAD)` };
  } catch {
    return { tag: '(git read failed)', source: dir };
  }
}

function cellFor(env: EnvName, service: ServiceName): VersionCell {
  // 1. Live /version - future default; all users benefit.
  const live = liveVersion(ENV_URLS[env][service]);
  if (live) return live;

  // 2. Maintainer fallback for prod/staging - private manifest via gh api.
  if (env !== 'local') {
    const manifest = manifestVersion(env, service);
    if (manifest) return manifest;
  }

  // 3. Local fallback - git HEAD of the clone.
  if (env === 'local') return localHead(service);

  // Nothing worked. For prod/staging without maintainer access this is
  // the default state today.
  return {
    tag: '(no /version)',
    source: `${ENV_URLS[env][service] || service} - no /version endpoint deployed; manifest access denied`,
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function renderTable(rows: Record<EnvName, Record<ServiceName, VersionCell>>): string {
  const envs: EnvName[] = ['production', 'staging', 'local'];
  const tagWidth = Math.max(
    10,
    ...envs.flatMap((e) => SERVICES.map((s) => rows[e][s].tag.length + 2)),
  );
  const svcWidth = Math.max(...SERVICES.map((s) => s.length)) + 2;
  const out: string[] = [];
  out.push(pad('service', svcWidth) + envs.map((e) => pad(e, tagWidth)).join(''));
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
    .description(
      "Show deployed versions per env. Tries /version first; falls back to manifest for maintainers.",
    )
    .option('--sources', 'Print where each value was read from')
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
      // Tell users up-front which paths are active vs future-only.
      console.log(
        '\nresolution order:\n' +
          '  1. GET /version                [live on local only today;\n' +
          '                                   DISABLED on prod/staging until\n' +
          '                                   upstream redeploys w/ the patch]\n' +
          '  2. k8s manifest via gh api     [maintainer-only; private repos]\n' +
          '  3. local git HEAD              [local column fallback]',
      );
    });
}
