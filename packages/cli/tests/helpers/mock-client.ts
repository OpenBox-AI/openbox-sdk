// Mock OpenBoxClient for unit tests. Records every call so a test can assert
// the CLI action wired the right method with the right args, without any
// network. Mirrors the real client's public surface loosely - add methods as
// needed for coverage.

import { vi } from 'vitest';

export type RecordedCall = {
  method: string;
  args: unknown[];
};

export interface MockClient {
  __calls: RecordedCall[];
  __reset: () => void;
  // Stub response registry. Set before a call to control what the mock returns.
  __responses: Record<string, unknown>;
  [method: string]: any;
}

/**
 * Build a mock client. Every method returns `__responses[methodName]` if set,
 * else a default empty object. Every call is recorded in `__calls`.
 */
export function makeMockClient(responses: Record<string, unknown> = {}): MockClient {
  const client: MockClient = {
    __calls: [],
    __responses: { ...responses },
    __reset() {
      client.__calls = [];
      client.__responses = {};
    },
  } as unknown as MockClient;

  // Proxy so any method access returns a recording stub.
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !prop.startsWith('__') && !(prop in target)) {
        return vi.fn((...args: unknown[]) => {
          target.__calls.push({ method: prop, args });
          const resp = target.__responses[prop];
          return Promise.resolve(resp ?? { ok: true });
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
