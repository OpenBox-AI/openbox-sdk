// Regression fixture; an integration that does everything right.
// Should produce ZERO findings from `openbox verify`.

import { govern, type HttpTransport } from 'openbox-sdk';

// IDs resolved at runtime, never hardcoded.
async function bootstrap(getTeamId: () => Promise<string>) {
  const teamId = await getTeamId();
  return { teamId };
}

const transport: HttpTransport = async (opts) => {
  const res = await fetch(opts.url, {
    method: opts.method,
    headers: {
      ...opts.headers,
      'X-Openbox-Client': 'acme-vercel-agent',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
};

export async function runGovernedTool(input: { message: string }) {
  return govern(
    transport,
    {
      apiKey: process.env.OPENBOX_API_KEY!,
      activityType: 'ToolCompleted',
      hitlEnabled: true,
      hitlPollInterval: 3,
      hitlMaxWait: 300,
      governancePolicy: 'fail_closed',
    },
    'ToolCall',
    input,
    async (governed) => {
      return { result: `processed: ${governed.message}` };
    },
  );
}
