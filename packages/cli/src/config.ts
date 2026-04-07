import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { OpenBoxClient } from 'openbox-sdk/client';
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';

function getTokenPath(): string {
  const projectTokens = resolve(process.cwd(), '.tokens');
  if (existsSync(projectTokens)) return projectTokens;
  const homeDir = resolve(process.env.HOME || '~', '.openbox');
  if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true });
  return resolve(homeDir, 'tokens');
}

function loadTokens(): { accessToken: string; refreshToken?: string } {
  const path = getTokenPath();
  if (!existsSync(path)) {
    console.error('No tokens found. Run: openbox auth set-token <token>');
    process.exit(1);
  }
  const content = readFileSync(path, 'utf-8');
  const tokens: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) tokens[m[1]] = m[2];
  }
  if (!tokens.ACCESS_TOKEN) {
    console.error('No ACCESS_TOKEN in tokens file. Run: openbox auth set-token <token>');
    process.exit(1);
  }
  return { accessToken: tokens.ACCESS_TOKEN, refreshToken: tokens.REFRESH_TOKEN || undefined };
}

function saveTokens(accessToken: string, refreshToken?: string) {
  const path = getTokenPath();
  const content = `ACCESS_TOKEN=${accessToken}\nREFRESH_TOKEN=${refreshToken || ''}\nUPDATED_AT=${new Date().toISOString()}\n`;
  writeFileSync(path, content);
}

function getClient(): OpenBoxClient {
  const tokens = loadTokens();
  const apiUrl = process.env.OPENBOX_API_URL || 'https://api.openbox.ai';
  return new OpenBoxClient({
    apiUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    onTokenRefresh: (newTokens) => {
      saveTokens(newTokens.accessToken, newTokens.refreshToken);
      console.error('[token refreshed]');
    },
  });
}

function getCoreClient(): OpenBoxCoreClient {
  const apiKey = process.env.OPENBOX_API_KEY || '';
  if (!apiKey) {
    console.error('No OPENBOX_API_KEY found. Set it in your environment.');
    process.exit(1);
  }
  const apiUrl = process.env.OPENBOX_CORE_URL || 'https://core.openbox.ai';
  return new OpenBoxCoreClient({ apiUrl, apiKey });
}

export { getClient, getCoreClient, saveTokens, loadTokens, getTokenPath };
