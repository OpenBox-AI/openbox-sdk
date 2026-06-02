// Backend auth-header precedence. Single source for every consumer
// that talks to the backend: when both creds are present, X-API-Key
// wins (bypasses Keycloak / JWT path entirely on the backend's
// jwt-auth.guard.ts); otherwise the OAuth Bearer JWT carries auth.
// Used by both the typed BackendClient and the MCP server's lightweight
// fetch wrapper so they can't drift on which credential we send.

/**
 * Build the Authorization-or-X-API-Key header object for a backend
 * request. The shape matches what `fetch`'s `headers` option expects.
 *
 * @returns
 *   - `{ 'X-API-Key': apiKey }` when `apiKey` is set
 *   - `{ Authorization: 'Bearer <token>' }` when only `accessToken` is set
 *   - `{}` when neither is set (caller decides what to do; usually 401)
 */
export function buildAuthHeader(creds: {
  apiKey?: string;
  accessToken?: string;
}): Record<string, string> {
  if (creds.apiKey) return { 'X-API-Key': creds.apiKey };
  if (creds.accessToken) return { Authorization: `Bearer ${creds.accessToken}` };
  return {};
}
