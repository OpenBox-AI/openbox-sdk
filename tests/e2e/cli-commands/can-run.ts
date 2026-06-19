// Shared gate for cli-commands e2e files. Each test is a real
// subprocess invocation of the openbox binary; it requires the
// CLI entrypoint and an authenticated backend to talk to.
//
// `tests/setup-creds.ts` populates both credentials and orgId from
// on-disk caches + a /auth/profile probe before any spec file runs;
// the gate below reads what setup-creds left behind. If any piece
// is missing, the suite skips cleanly.

import { existsSync } from 'fs';
import { optionalOpenBoxCli } from '../../helpers/openbox-cli.js';
import { hasOrgId } from '../../helpers/api-client';

const CLI_BIN = optionalOpenBoxCli();

export const CAN_RUN_CLI =
  !!CLI_BIN &&
  existsSync(CLI_BIN) &&
  !!process.env.OPENBOX_BACKEND_API_KEY &&
  hasOrgId();
