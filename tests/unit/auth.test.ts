import { describe, it, expect } from 'vitest';
import { decodeJwtExpiry, isTokenExpired } from '../../ts/src/types/auth.js';
import { makeJwt } from '../helpers/jwt';

describe('decodeJwtExpiry', () => {
  it('returns expiry in milliseconds for a valid JWT', () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ exp: expSeconds });
    expect(decodeJwtExpiry(token)).toBe(expSeconds * 1000);
  });

  it('returns null for a JWT without exp claim', () => {
    const token = makeJwt({ sub: 'user-123' });
    expect(decodeJwtExpiry(token)).toBeNull();
  });

  it('returns null for a non-3-part string', () => {
    expect(decodeJwtExpiry('not-a-jwt')).toBeNull();
    expect(decodeJwtExpiry('two.parts')).toBeNull();
    expect(decodeJwtExpiry('')).toBeNull();
  });

  it('returns null for invalid base64 in payload', () => {
    expect(decodeJwtExpiry('header.!!!invalid!!!.sig')).toBeNull();
  });

  it('returns null when exp is not a number', () => {
    const token = makeJwt({ exp: 'not-a-number' });
    expect(decodeJwtExpiry(token)).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('returns false for a token expiring far in the future', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for an already-expired token', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) - 120 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true when token expires within default 60s buffer', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 30 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns false when token expires just outside buffer', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 120 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('respects custom bufferMs parameter', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 90 });
    // With 60s buffer → not expired
    expect(isTokenExpired(token, 60_000)).toBe(false);
    // With 120s buffer → expired
    expect(isTokenExpired(token, 120_000)).toBe(true);
  });

  it('returns true for an invalid/unparseable token', () => {
    expect(isTokenExpired('garbage')).toBe(true);
  });
});
