import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function optionalOpenBoxCli(): string | undefined {
  const cli = resolve('scripts/openbox-cli-dev.mjs');
  return existsSync(cli) ? cli : undefined;
}

export function requireOpenBoxCli(): string {
  const rawCli = optionalOpenBoxCli();
  if (!rawCli) {
    throw new Error(
      'scripts/openbox-cli-dev.mjs is required for CLI subprocess tests.',
    );
  }
  const cli = rawCli;
  if (!existsSync(cli)) throw new Error(`OpenBox CLI entrypoint not found at ${cli}`);
  return cli;
}
