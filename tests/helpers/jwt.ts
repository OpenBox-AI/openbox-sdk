/**
 * JWT test utilities for creating tokens with controlled expiry.
 */

export function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.test-signature`;
}

export function makeValidToken(): string {
  return makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
}

export function makeExpiredToken(): string {
  return makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
}
