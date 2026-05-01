// `openbox versions`: report the deployed commit or tag for each
// service in each env. Hits the public `/version` endpoint on each
// service URL resolved from `openbox-sdk/env`. No filesystem reads,
// no private-repo lookups; cells without `/version` print
// "(no /version)".

import type { Command } from 'commander';
import { OpenBoxClient } from '../../client/index.js';
import { resolveUrls, type EnvName } from '../../env/index.js';

type ServiceName = 'backend' | 'core' | 'guardrails';

const SERVICES: ServiceName[] = ['backend', 'core', 'guardrails'];

function urlFor(env: EnvName, service: ServiceName): string {
  const urls = resolveUrls(env);
  switch (service) {
    case 'backend':
      return urls.apiUrl ?? '';
    case 'core':
      return urls.coreUrl ?? '';
    case 'guardrails':
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

async function cellFor(env: EnvName, service: ServiceName): Promise<VersionCell> {
  const baseUrl = urlFor(env, service);
  const live = await liveVersion(baseUrl);
  if (live) return live;
  return {
    tag: '(no /version)',
    source: `${baseUrl || service}: /version not deployed`,
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
    });
}
