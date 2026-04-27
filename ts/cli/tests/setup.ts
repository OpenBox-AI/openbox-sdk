// Test setup: load .env + .tokens into process.env so both unit and e2e tests
// can resolve API URLs and auth without hand-piping flags. Same pattern as
// the equivalent setup in sibling repos so contributors
// don't have to learn two conventions.

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const rootDir = resolve(__dirname, '..');

config({ path: resolve(rootDir, '.env') });

const tokensPath = resolve(rootDir, '.tokens');
if (existsSync(tokensPath)) {
  const content = readFileSync(tokensPath, 'utf-8');
  for (const line of content.split('\n')) {
    // Only lift env-namespaced or legacy ACCESS_TOKEN/REFRESH_TOKEN lines -
    // ignore the permissions/features caches (they'd be misread as env vars).
    const match = line.match(/^([A-Z_]+[A-Z0-9_]*)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2];
    }
  }
}
