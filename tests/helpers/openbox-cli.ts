import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function optionalOpenBoxCli(): string | undefined {
  const cli = process.env.OPENBOX_CLI;
  return cli && cli.length > 0 ? resolve(cli) : undefined;
}

export function requireOpenBoxCli(): string {
  const rawCli = optionalOpenBoxCli();
  if (!rawCli) {
    throw new Error(
      'OPENBOX_CLI is required for CLI subprocess tests. Run through npm scripts or set OPENBOX_CLI explicitly.',
    );
  }
  const cli = rawCli;
  if (!existsSync(cli)) {
    throw new Error(`OPENBOX_CLI entrypoint not found at ${cli}`);
  }
  return cli;
}
