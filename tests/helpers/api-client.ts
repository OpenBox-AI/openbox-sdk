export interface ApiResponse<T = any> {
  status: number;
  data: T;
  message?: string;
}

interface HttpClient {
  get(path: string): Promise<{ data: any; status: number }>;
  post(path: string, data?: any): Promise<{ data: any; status: number }>;
  put(path: string, data?: any): Promise<{ data: any; status: number }>;
  patch(path: string, data?: any): Promise<{ data: any; status: number }>;
  delete(path: string, data?: any): Promise<{ data: any; status: number }>;
}

async function makeRequest(
  method: string,
  url: string,
  token: string,
  data?: any,
): Promise<{ data: any; status: number }> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Openbox-Client': 'openbox-cli',
    },
    signal: AbortSignal.timeout(25000),
  };
  if (data) opts.body = JSON.stringify(data);

  const response = await fetch(url, opts);
  const contentType = response.headers.get('content-type');

  let body: any;
  if (contentType?.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  // Return in same shape tests expect: { data: body, status: response.status }
  return { data: body, status: response.status };
}

// dogfood. The e2e suite drives every backend call through
// the public OpenBoxClient code path (auth-header injection, error
// wrapping, retry-eligible paths, response parsing) so pushing the
// suite green also gates the SDK transport layer. Previously these
// tests used raw `fetch`, which left ts/src/client/* essentially
// uncovered.
//
// Tests stay shape-identical (`client.get`/`post`/etc. return
// `{ status, data }`); the wrapper translates OpenBoxClient's
// "throw on non-2xx" model into a never-throws envelope so existing
// `expect(body.status).toBe(422)` style tests still work.
import { OpenBoxClient, OpenBoxApiError } from '../../ts/src/client';

/**
 * Subclass that exposes OpenBoxClient's `protected` HTTP methods to the
 * test harness. Production callers go through the typed wrappers
 * (createAgent, listAgents, ...) so the protected boundary stays a
 * production guarantee; only the test build pierces it.
 */
class TestOpenBoxClient extends OpenBoxClient {
  publicGet<T>(p: string, q?: any): Promise<T> { return this.httpGet<T>(p, q); }
  publicPost<T>(p: string, d?: unknown): Promise<T> { return this.httpPost<T>(p, d); }
  publicPut<T>(p: string, d?: unknown, q?: any): Promise<T> { return this.httpPut<T>(p, d, q); }
  publicPatch<T>(p: string, d?: unknown): Promise<T> { return this.httpPatch<T>(p, d); }
  publicDelete<T>(p: string, d?: unknown): Promise<T> { return this.httpDelete<T>(p, d); }
}

async function viaSdk<T>(call: () => Promise<T>): Promise<{ data: any; status: number }> {
  // OpenBoxClient.request() unwraps the backend's `{ status, data }`
  // envelope before returning; callers normally see only the inner
  // `data`. The e2e suite (and `fullResponse(response)`) expects the
  // ENVELOPE: `body.status === 200` reads the backend's semantic
  // status, `body.data.<x>` reads the payload. Re-wrap so existing
  // assertions work without touching every test file.
  try {
    const inner = await call();
    return { data: { status: 200, data: inner }, status: 200 };
  } catch (err) {
    if (err instanceof OpenBoxApiError) {
      // err.body is the backend's full envelope on errors. If it's
      // already shaped { status, ... }, pass it through; otherwise
      // synthesize one so `body.status` is always defined.
      const body =
        err.body && typeof err.body === 'object' && 'status' in (err.body as Record<string, unknown>)
          ? err.body
          : { status: err.status, message: err.message, data: err.body };
      return { data: body as any, status: err.status };
    }
    throw err;
  }
}

/** Backend API client. Routes through OpenBoxClient so tests dogfood
 *  the SDK transport layer end-to-end. Uses X-API-Key auth: every
 *  non-mobile surface (CLI, MCP, IDE extension, MCP server, hooks)
 *  consumes the org X-API-Key from `~/.openbox/tokens`, so the SDK's
 *  own e2e tests do too. JWT auth is the mobile-only path; SDK tests
 *  must not depend on a session token to run. */
export function getBackendClient(): HttpClient {
  const baseURL = process.env.OPENBOX_API_URL || 'https://api.openbox.ai';
  const apiKey = process.env.OPENBOX_BACKEND_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'No OPENBOX_BACKEND_API_KEY found. Set the backend X-API-Key, ' +
        'e.g. `export OPENBOX_BACKEND_API_KEY=$(grep ^API_KEY= ~/.openbox/tokens | cut -d= -f2)`; ' +
        "or let tests/setup-creds.ts populate it from your tokens file.",
    );
  }

  const sdk = new TestOpenBoxClient({
    apiUrl: baseURL,
    apiKey,
    clientName: 'openbox-e2e',
  });

  return {
    async get(path: string) {
      return viaSdk(() => sdk.publicGet(path));
    },
    async post(path: string, data?: any) {
      return viaSdk(() => sdk.publicPost(path, data));
    },
    async put(path: string, data?: any) {
      return viaSdk(() => sdk.publicPut(path, data));
    },
    async patch(path: string, data?: any) {
      return viaSdk(() => sdk.publicPatch(path, data));
    },
    async delete(path: string, data?: any) {
      return viaSdk(() => sdk.publicDelete(path, data));
    },
  };
}

/** Core governance API client (core.openbox.ai) */
export function getCoreClient(apiKey?: string): HttpClient {
  const baseURL = process.env.OPENBOX_CORE_URL || 'https://core.openbox.ai';
  const key = apiKey || process.env.OPENBOX_API_KEY || '';

  return {
    async get(path: string) {
      return makeRequest('GET', baseURL + path, key);
    },
    async post(path: string, data?: any) {
      return makeRequest('POST', baseURL + path, key, data);
    },
    async put(path: string, data?: any) {
      return makeRequest('PUT', baseURL + path, key, data);
    },
    async patch(path: string, data?: any) {
      return makeRequest('PATCH', baseURL + path, key, data);
    },
    async delete(path: string, data?: any) {
      return makeRequest('DELETE', baseURL + path, key, data);
    },
  };
}

/** Unwrap the { status, data } envelope and return just data */
export function unwrap<T = any>(response: { data: ApiResponse<T> }): T {
  return response.data.data;
}

/** Get the full response including status */
export function fullResponse<T = any>(response: { data: ApiResponse<T> }): ApiResponse<T> {
  return response.data;
}

/** Get the org ID. Populated by tests/setup-creds.ts from
 *  /auth/profile (the backend tells us what org the authenticated
 *  principal belongs to). No env-name derivation: backend is the
 *  source of truth, so a misconfigured token surfaces as an explicit
 *  error rather than a wrong-host orgId silently 403'ing every
 *  org-scoped endpoint. */
export function getOrgId(): string {
  const id = process.env.OPENBOX_ORG_ID;
  if (!id) {
    throw new Error(
      'OPENBOX_ORG_ID is not populated. tests/setup-creds.ts should have ' +
        'fetched it from /auth/profile during setup; confirm OPENBOX_API_URL ' +
        'and OPENBOX_BACKEND_API_KEY were set before the suite started.',
    );
  }
  return id;
}

/** Get the team IDs the user has access to */
export async function getTeamIds(): Promise<string[]> {
  const client = getBackendClient();
  const orgId = getOrgId();
  const res = await client.get(`/organization/${orgId}/teams`);
  const teams = res.data?.data?.data || [];
  return teams.map((t: any) => t.id);
}
