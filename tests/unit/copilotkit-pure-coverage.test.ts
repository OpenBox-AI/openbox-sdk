import React from 'react';
import { describe, expect, it } from 'vitest';

import {
  createCoreClientResolver,
  getAgentIdentity,
  getApprovalBackendApiKey,
  getRuntimeApiKey,
} from '../../ts/src/copilotkit/config-utils.ts';
import {
  asNode,
  asRecord,
  buttonClass,
  parseToolResult,
  rendererStyle,
  resolveTheme,
  textValue,
} from '../../ts/src/copilotkit/react-utils.ts';
import { verdictFromResult } from '../../ts/src/copilotkit/react-governance-decision.ts';

function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('CopilotKit pure utility coverage', () => {
  it('resolves runtime, backend, and signed-agent config branches', () => {
    withEnv(
      {
        OPENBOX_API_KEY: 'obx_test_from_env',
        OPENBOX_BACKEND_API_KEY: 'obx_key_from_env',
        OPENBOX_AGENT_DID: 'did:openbox:agent:env',
        OPENBOX_AGENT_PRIVATE_KEY: 'private-env',
      },
      () => {
        expect(getRuntimeApiKey({})).toBe('obx_test_from_env');
        expect(getRuntimeApiKey({ apiKey: 'obx_live_explicit' })).toBe(
          'obx_live_explicit',
        );
        expect(getApprovalBackendApiKey({})).toBe('obx_key_from_env');
        expect(getApprovalBackendApiKey({ backendApiKey: 'obx_key_explicit' })).toBe(
          'obx_key_explicit',
        );
        expect(getAgentIdentity({})).toEqual({
          did: 'did:openbox:agent:env',
          privateKey: 'private-env',
        });
        expect(
          getAgentIdentity({
            agentIdentity: {
              did: 'did:openbox:agent:explicit',
              privateKey: 'private-explicit',
            },
          }),
        ).toEqual({
          did: 'did:openbox:agent:explicit',
          privateKey: 'private-explicit',
        });
      },
    );

    withEnv(
      {
        OPENBOX_API_KEY: undefined,
        OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
      },
      () => {
        expect(() => createCoreClientResolver({})()).toThrow(
          'runtime API key is not configured',
        );
      },
    );
    withEnv(
      {
        OPENBOX_API_KEY: 'plain-key',
        OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
      },
      () => {
        expect(() => createCoreClientResolver({})()).toThrow(
          'must be an obx_live_* or obx_test_* key',
        );
      },
    );
    withEnv(
      {
        OPENBOX_API_KEY: 'obx_test_runtime',
        OPENBOX_CORE_URL: undefined,
      },
      () => {
        expect(() => createCoreClientResolver({})()).toThrow(
          'Core URL is not configured',
        );
      },
    );
  });

  it('caches Core clients until the runtime cache key changes', () => {
    withEnv(
      {
        OPENBOX_API_KEY: 'obx_test_runtime',
        OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
        OPENBOX_AGENT_DID: undefined,
        OPENBOX_AGENT_PRIVATE_KEY: undefined,
      },
      () => {
        const resolver = createCoreClientResolver({});
        const first = resolver();
        const second = resolver();
        expect(second).toBe(first);

        process.env.OPENBOX_AGENT_DID = 'did:openbox:agent:new';
        process.env.OPENBOX_AGENT_PRIVATE_KEY = 'private-new';
        const third = resolver();
        expect(third).not.toBe(first);
      },
    );
  });

  it('covers React renderer utility branches without rendering components', () => {
    expect(buttonClass('primary')).toContain('text-white');
    expect(buttonClass('secondary')).toContain('border');
    expect(parseToolResult('{"ok":true}')).toEqual({ ok: true });
    expect(parseToolResult('"plain"')).toEqual({});
    expect(parseToolResult('bad json')).toEqual({});
    expect(parseToolResult(null)).toEqual({});
    expect(parseToolResult({ ok: true })).toEqual({ ok: true });
    expect(asRecord(false)).toEqual({});
    expect(asRecord({ ok: true })).toEqual({ ok: true });
    expect(textValue(null)).toBe('');
    expect(textValue('text')).toBe('text');
    expect(textValue(42)).toBe('42');
    expect(textValue(true)).toBe('true');
    expect(textValue({})).toBe('');

    expect(resolveTheme(undefined, '/logo.svg')).toMatchObject({
      mode: 'auto',
      density: 'comfortable',
      logoSrc: '/logo.svg',
    });
    expect(resolveTheme({ logoSrc: '/custom.svg', density: 'compact' })).toMatchObject({
      logoSrc: '/custom.svg',
      density: 'compact',
    });
    expect(rendererStyle({ accentColor: '#111', radius: 4, density: 'compact' })).toMatchObject({
      '--obx-accent': '#111',
      '--obx-radius': '4px',
      '--obx-density-scale': '0.82',
    });
    expect(rendererStyle({ radius: '12px' })).toMatchObject({
      '--obx-radius': '12px',
      '--obx-density-scale': '1',
    });

    const node = React.createElement('span', null, 'ok');
    expect(asNode(node)).toBe(node);
    expect(asNode('ok')).toBe('ok');
    expect(asNode(1)).toBe(1);
    expect(asNode(null)).toBeUndefined();
    expect(asNode({})).toBeUndefined();
  });

  it('maps governance result verdicts for every UI branch', () => {
    const scenario = {
      action: 'demo_action',
      title: 'Demo',
      reason: 'Evaluate the action.',
      capability: 'Runtime governance',
      verdict: 'allow' as const,
    };

    expect(verdictFromResult({ status: 'approval_required' }, scenario)).toBe(
      'approval',
    );
    expect(verdictFromResult({ status: 'rejected' }, scenario)).toBe('rejected');
    expect(verdictFromResult({ status: 'error' }, scenario)).toBe('error');
    expect(verdictFromResult({ verdict: 'error' }, scenario)).toBe('error');
    expect(verdictFromResult({ status: 'halted' }, scenario)).toBe('halt');
    expect(verdictFromResult({ verdict: 'halt' }, scenario)).toBe('halt');
    expect(verdictFromResult({ status: 'constrained' }, scenario)).toBe(
      'constrain',
    );
    expect(verdictFromResult({ verdict: 'constrain' }, scenario)).toBe(
      'constrain',
    );
    expect(
      verdictFromResult(
        { status: 'executed', redactionSummary: 'OpenBox redacted field.' },
        scenario,
      ),
    ).toBe('constrain');
    expect(verdictFromResult({ status: 'executed' }, scenario)).toBe('allow');
    expect(verdictFromResult({ verdict: 'allow' }, scenario)).toBe('allow');
    expect(verdictFromResult({ status: 'blocked' }, scenario)).toBe('block');
    expect(verdictFromResult({ status: 'approval_pending' }, scenario)).toBe(
      'block',
    );
    expect(verdictFromResult({ verdict: 'block' }, scenario)).toBe('block');
    expect(verdictFromResult({ verdict: 'require_approval' }, scenario)).toBe(
      'approval',
    );
    expect(verdictFromResult({}, scenario)).toBe('reviewing');
  });
});
