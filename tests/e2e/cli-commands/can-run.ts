// Shared gate for cli-commands e2e files. Each test is a real
// subprocess invocation of the openbox binary; it requires the
// binary to be built and an authenticated backend to talk to.
//
// `tests/setup-creds.ts` populates both credentials and orgId from
// on-disk caches + a /auth/profile probe before any spec file runs;
// the gate below reads what setup-creds left behind. If any piece
// is missing, the suite skips cleanly.

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_BIN = resolve(__dirname, '../../../dist/cli/index.js');

export const CAN_RUN_CLI =
  existsSync(CLI_BIN) &&
  !!process.env.OPENBOX_BACKEND_API_KEY &&
  !!process.env.OPENBOX_ORG_ID;
