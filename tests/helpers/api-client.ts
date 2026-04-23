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

/** Backend API client (api.openbox.ai) */
export function getBackendClient(): HttpClient {
  const baseURL = process.env.OPENBOX_API_URL || 'https://api.openbox.ai';
  const token = process.env.ACCESS_TOKEN || '';
  if (!token) throw new Error('No ACCESS_TOKEN found. Run scripts/set-token.sh first.');

  return {
    async get(path: string) {
      return makeRequest('GET', baseURL + path, token);
    },
    async post(path: string, data?: any) {
      return makeRequest('POST', baseURL + path, token, data);
    },
    async put(path: string, data?: any) {
      return makeRequest('PUT', baseURL + path, token, data);
    },
    async patch(path: string, data?: any) {
      return makeRequest('PATCH', baseURL + path, token, data);
    },
    async delete(path: string, data?: any) {
      return makeRequest('DELETE', baseURL + path, token, data);
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

/** Get the org ID from env or token */
export function getOrgId(): string {
  if (process.env.OPENBOX_ORG_ID) return process.env.OPENBOX_ORG_ID;
  // Decode JWT to get orgId from iss claim
  const token = process.env.ACCESS_TOKEN || '';
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    // issuer is like https://identity.openbox.ai/realms/openbox.ai
    const realm = payload.iss?.split('/realms/')[1];
    if (realm) return realm;
  } catch {
    // Token may be invalid or missing - fall through to default
  }
  return 'openbox.ai';
}

/** Get the team IDs the user has access to */
export async function getTeamIds(): Promise<string[]> {
  const client = getBackendClient();
  const orgId = getOrgId();
  const res = await client.get(`/organization/${orgId}/teams`);
  const teams = res.data?.data?.data || [];
  return teams.map((t: any) => t.id);
}
