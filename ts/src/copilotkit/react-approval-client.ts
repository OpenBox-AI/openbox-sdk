import type { OpenBoxApprovalClient } from './react-types.js';

export function createOpenBoxApprovalClient(
  config: {
    endpoint?: string;
    fetcher?: typeof fetch;
  } = {},
): OpenBoxApprovalClient {
  return {
    async decide(request) {
      const endpoint = config.endpoint ?? '/api/openbox/approvals/decide';
      const fetcher = config.fetcher ?? fetch;
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || 'OpenBox approval decision failed.');
      }
      return payload;
    },
  };
}
