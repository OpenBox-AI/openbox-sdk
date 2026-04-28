/**
 * JWT token utilities for automatic token refresh.
 */

/**
 * Decodes the expiry timestamp from a JWT token without verifying the signature.
 * Returns the expiry time in milliseconds, or null if the token cannot be decoded.
 */
export function decodeJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (typeof parsed.exp === 'number') {
      return parsed.exp * 1000; // convert seconds to milliseconds
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the given JWT token is expired or will expire within the
 * specified buffer (default 60 seconds).
 */
export function isTokenExpired(token: string, bufferMs: number = 60_000): boolean {
  const expiry = decodeJwtExpiry(token);
  if (expiry === null) {
    // If we cannot determine expiry, treat as expired to be safe
    return true;
  }
  return Date.now() + bufferMs >= expiry;
}
