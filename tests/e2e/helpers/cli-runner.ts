// Spawn the openbox CLI as a subprocess, capture stdout / stderr /
// exit code. Used by e2e tests to drive the real CLI end-to-end against a
// local or remote backend (whichever $OPENBOX_API_URL points at).

import { spawnSync } from 'child_process';
import { requireOpenBoxCli } from '../../helpers/openbox-cli.js';

const CLI_BIN = requireOpenBoxCli();

export type CliResult = {
  status: number;
  stdout: string;
  stderr: string;
};

/**
 * Run `openbox <args>` as a subprocess. Inherits the parent process env so
 * $OPENBOX_API_URL / $OPENBOX_CORE_URL / .tokens discovery all work.
 *
 * Note: unit tests should NOT use this; they should import the action logic
 * directly. This helper is for e2e tests that need to verify the full
 * argv → parse → action → HTTP roundtrip.
 */
export function runCli(args: string[], env: NodeJS.ProcessEnv = {}): CliResult {
  const res = spawnSync(CLI_BIN, args, {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}
