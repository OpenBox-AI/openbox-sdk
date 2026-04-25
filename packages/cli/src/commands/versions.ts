// `openbox versions` - report the deployed commit/tag for each service
// (backend, core, guardrails) in each env (production, staging, local).
//
// Source resolution order per env/service:
//   1. `GET /version` on the service via OpenBoxClient.getVersion().
//      Public endpoint, works for anyone. Currently deployed only on
//      local; prod/staging light up once the patches in
//      openbox-dev-setup (patches/07-backend-version-endpoint.patch
//      and patches/08-core-version-endpoint.patch) ship upstream.
//   2. Local column only: current git HEAD of each service clone under
//      ~/workspace/openbox-repos/openbox-* if it exists.
//
// The previous `gh api` fallback against private OpenBox-AI manifest
// repos was removed - it required maintainer-only access to repos the
// CLI's general user base can't read, and shelling out to `gh` from a
// shipped CLI is bad form regardless. Cells without /version now
// honestly print "(no /version)" instead of pretending coverage.

import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { OpenBoxClient } from '@openbox/client';
import { resolveUrls, type EnvName } from '@openbox/env';

type ServiceName = 'openbox-backend' | 'openbox-core' | 'openbox-guardrails';

const SERVICES: ServiceName[] = ['openbox-backend', 'openbox-core', 'openbox-guardrails'];

const LOCAL_CLONE: Record<ServiceName, string> = {
  'openbox-backend': resolve(homedir(), 'workspace/openbox-repos/openbox-backend'),
  'openbox-core': resolve(homedir(), 'workspace/openbox-repos/openbox-core'),
  'openbox-guardrails': resolve(homedir(), 'workspace/openbox-repos/openbox-guardrails'),
};

// Resolve service URLs per env from the canonical env config (@openbox/env).
// Single source of truth - no hardcoded duplication. Returns empty string for
// services that don't have a registered URL in this env.
function urlFor(env: EnvName, service: ServiceName): string {
  const urls = resolveUrls(env);
  switch (service) {
    case 'openbox-backend':
      return urls.apiUrl ?? '';
    case 'openbox-core':
      return urls.coreUrl ?? '';
    case 'openbox-guardrails':
      // Not in @openbox/env yet; honor OPENBOX_GUARDRAILS_URL if set, else empty.
      return process.env.OPENBOX_GUARDRAILS_URL ?? '';
  }
}

interface VersionCell {
  tag: string;
  source: string;
}

async function liveVersion(baseUrl: string): Promise<VersionCell | null> {
  if (!baseUrl) return null;
  const v = await OpenBoxClient.getVersion(baseUrl, { timeoutMs: 5_000 });
  if (!v) return null;
  const tag = v.commit || v.version || null;
  return tag ? { tag, source: `${baseUrl}/version` } : null;
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

async function cellFor(env: EnvName, service: ServiceName): Promise<VersionCell> {
  const baseUrl = urlFor(env, service);
  // 1. Live /version via OpenBoxClient.getVersion - public endpoint,
  //    works for everyone once envs are redeployed with the patch.
  const live = await liveVersion(baseUrl);
  if (live) return live;

  // 2. Local column: git HEAD of the clone.
  if (env === 'local') return localHead(service);

  // Prod/staging without /version - honest "not available". Users with
  // a clone of the service repo can correlate manually; we don't try to
  // read from private k8s manifest repos (was a maintainer-only path).
  return {
    tag: '(no /version)',
    source: `${baseUrl || service} - /version not deployed`,
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
    .description('Show deployed versions per env via each service /version endpoint.')
    .option('--sources', 'Print where each value was read from')
    .action(async (opts: { sources?: boolean }) => {
      const envs: EnvName[] = ['production', 'staging', 'local'];
      const rows: Record<EnvName, Record<ServiceName, VersionCell>> = {} as Record<
        EnvName,
        Record<ServiceName, VersionCell>
      >;
      // Resolve all cells in parallel - each is an independent network or
      // git read, no point doing them serially across a 3x3 grid.
      const tasks: Promise<void>[] = [];
      for (const env of envs) {
        rows[env] = {} as Record<ServiceName, VersionCell>;
        for (const svc of SERVICES) {
          tasks.push(
            cellFor(env, svc).then((cell) => {
              rows[env][svc] = cell;
            }),
          );
        }
      }
      await Promise.all(tasks);
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
          '  1. GET /version              [live on local today; lights up on\n' +
          '                                 prod/staging once upstream deploys\n' +
          '                                 the version-endpoint patches]\n' +
          '  2. local git HEAD            [local column fallback]',
      );
    });
}
