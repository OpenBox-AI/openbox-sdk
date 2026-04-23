import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const rootDir = resolve(__dirname, '..');

// Load .env
config({ path: resolve(rootDir, '.env') });

// Load .tokens if exists
const tokensPath = resolve(rootDir, '.tokens');
if (existsSync(tokensPath)) {
  const content = readFileSync(tokensPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2];
    }
  }
}

// Set defaults
if (!process.env.OPENBOX_API_URL) {
  process.env.OPENBOX_API_URL = 'https://api.openbox.ai';
}
if (!process.env.OPENBOX_CORE_URL) {
  process.env.OPENBOX_CORE_URL = 'https://core.openbox.ai';
}
