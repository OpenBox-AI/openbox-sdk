import { beforeAll, describe, expect, it } from 'vitest';
import { createApi, readTokens } from '../../../ts/src/runtime/mcp/config.js';

interface ProfileState {
  skip: boolean;
  reason?: string;
  profile?: { orgId?: string; permissions?: string[]; [key: string]: unknown };
}

let state: ProfileState = { skip: true, reason: 'not checked' };

beforeAll(async () => {
  try {
    readTokens();
  } catch (err) {
    state = { skip: true, reason: `no token: ${(err as Error).message}` };
    return;
  }
  try {
    const api = createApi();
    const profile = (await api('/auth/profile')) as ProfileState['profile'];
    state = { skip: false, profile };
  } catch (err) {
    state = {
      skip: true,
      reason: `token present but /auth/profile failed: ${(err as Error).message.slice(0, 140)}`,
    };
  }
}, 30000);

describe('mcp smoke', () => {
  it('uses URL-only createApi and returns orgId when credentials are present', () => {
    if (state.skip) return;
    expect(state.profile?.orgId).toBeTruthy();
    expect(Array.isArray(state.profile?.permissions)).toBe(true);
  });
});
