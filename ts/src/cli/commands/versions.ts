// `openbox versions`: report the deployed commit or tag for each
// service against the active env. One row per service; no env names
// surfaced — the active env is whichever the rest of the CLI resolves
// to via `resolveEnv()`. Hits the public `/version` endpoint on each
// service URL; cells without `/version` print "(no /version)".

import type { Command } from 'commander';
import { OpenBoxClient } from '../../client/index.js';
import { resolveEnv, resolveUrls, type EnvName } from '../../env/index.js';
import { table, info } from '../output.js';

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

export function registerVersionsCommand(program: Command): void {
  program
    .command('versions')
    .description('Show deployed versions for each service via /version.')
    .option('--sources', 'Print where each value was read from')
    .action(async (opts: { sources?: boolean }) => {
      const env = resolveEnv();
      const cells: Record<ServiceName, VersionCell> = {} as Record<
        ServiceName,
        VersionCell
      >;
      await Promise.all(
        SERVICES.map((svc) => cellFor(env, svc).then((c) => (cells[svc] = c))),
      );
      table(
        ['service', 'version'],
        SERVICES.map((svc) => [svc, cells[svc].tag]),
      );
      if (opts.sources) {
        info('');
        info('sources:');
        for (const svc of SERVICES) {
          info(`  ${svc}: ${cells[svc].source}`);
        }
      }
    });
}
